import { declareScope, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { Inject, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { isAgentOnline } from '../../domain/agents.js';
import { formatPairingCode } from '../../domain/pairing.js';
import { preparePapers, prepareSettings, toPrinterStatus } from '../../domain/printers.js';
import { PrintWriteError } from '../print.errors.js';
import type { PrintModuleOptions } from '../print.options.js';
import type { PrintPrinterRow } from '../print.repository.js';
import { type PrintAgentWithPrinters, PrintService } from '../print.service.js';
import { PRINT_OPTIONS } from '../print.tokens.js';
import { PrintJobService } from '../print-job.service.js';
import { PrintWriteService } from '../print-write.service.js';
import {
  PrintAgentType,
  PrintJobStartType,
  PrintJobType,
  PrintPairingCodeType,
  type PrintPrinterType,
} from './print.types.js';

/**
 * What a signed-in PERSON does with a workspace's printing: see the paired
 * computers, pair one, revoke one, and open a print job and read how it went.
 *
 * ⚠ A JOB'S FILE DOES NOT PASS THROUGH HERE. `startPrintJob` answers with a
 * ticket, and the file goes to the relay's own route with it
 * (`http/print-relay.controller.ts`).
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `print:*` key is WORKSPACE level. A resolver has no path, so without a
 * declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key grants nothing to everybody, silently (§12.13).
 * Declared on the CLASS so an operation added later cannot forget it;
 * `surface-coverage.test.ts` fails if it goes. Every operation therefore takes
 * `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `PRINT_FEATURE_REGISTRY`.
 *
 * ## What a computer does is NOT here
 *
 * A computer has no session and no key. Its operations are public surfaces in
 * `PrintAgentResolver`, kept in a separate class so no public marker can ever
 * sit on this one.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class PrintResolver {
  constructor(
    private readonly print: PrintService,
    private readonly writes: PrintWriteService,
    private readonly jobs: PrintJobService,
    @Inject(PRINT_OPTIONS) private readonly options: PrintModuleOptions,
  ) {}

  /** The workspace's paired computers, by name, each with its printers. */
  @Query(() => [PrintAgentType], { name: 'printAgents' })
  async agents(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<PrintAgentType[]> {
    const now = new Date();
    const agents = await this.print.agents({ organizationId, workspaceId });
    return agents.map((entry) => renderAgent(entry, now));
  }

  /**
   * A one-time code to type on the computer being paired.
   *
   * ⚠ The code is returned HERE and stored only as a hash. A person who closes
   * the page before typing it makes another.
   */
  @Mutation(() => PrintPairingCodeType, { name: 'createPrintPairingCode' })
  async createPairingCode(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('name') name: string,
  ): Promise<PrintPairingCodeType> {
    const created = await this.writes.createPairingCode({ organizationId, workspaceId }, this.actor(gql.req), name);
    return { code: formatPairingCode(created.code), expiresAt: created.expiresAt.toISOString() };
  }

  /** Take a computer away. True also when it was already revoked. */
  @Mutation(() => Boolean, { name: 'revokePrintAgent' })
  async revokeAgent(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('agentId') agentId: string,
  ): Promise<boolean> {
    await this.writes.revokeAgent({ organizationId, workspaceId }, this.actor(gql.req), agentId);
    return true;
  }

  /**
   * Open a job for one printer. Refused, never queued, when its computer is
   * offline — see `PrintJobService.start`.
   */
  @Mutation(() => PrintJobStartType, { name: 'startPrintJob' })
  async startJob(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('printerId') printerId: string,
    @Args('copies', { type: () => Int }) copies: number,
    @Args('size', { type: () => Int }) size: number,
    @Args('paperName', { type: () => String, nullable: true }) paperName?: string | null,
    @Args('mediaType', { type: () => String, nullable: true }) mediaType?: string | null,
    @Args('quality', { type: () => String, nullable: true }) quality?: string | null,
  ): Promise<PrintJobStartType> {
    return this.jobs.start({ organizationId, workspaceId }, this.actor(gql.req), {
      printerId,
      paperName,
      copies,
      size,
      mediaType,
      quality,
    });
  }

  /** How one of the caller's own jobs stands. Null once forgotten, and for anybody else's. */
  @Query(() => PrintJobType, { name: 'printJob', nullable: true })
  job(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('jobId') jobId: string,
  ): PrintJobType | null {
    return this.jobs.status({ organizationId, workspaceId }, this.actor(gql.req), jobId);
  }

  /** The guard has already proven a principal; this only narrows it to an id. */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new PrintWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

function renderAgent({ agent, printers }: PrintAgentWithPrinters, now: Date): PrintAgentType {
  return {
    id: agent.id,
    name: agent.name,
    hostName: agent.hostName,
    agentVersion: agent.agentVersion,
    online: isAgentOnline(agent, now),
    lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
    pairedAt: agent.createdAt.toISOString(),
    printers: printers.map(renderPrinter),
  };
}

function renderPrinter(row: PrintPrinterRow): PrintPrinterType {
  return {
    id: row.id,
    name: row.name,
    driver: row.driver,
    isDefault: row.isDefault,
    status: toPrinterStatus(row.status),
    gone: row.goneAt !== null,
    // ⚠ A `Json` column, read through the same check a report passes. A row that no longer reads has no papers, not a crash.
    papers: preparePapers(row.papers) ?? [],
    ...prepareSettings(row.settings),
  };
}
