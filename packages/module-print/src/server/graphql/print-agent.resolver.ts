import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import { Args, Context, Mutation, Resolver, Subscription } from '@nestjs/graphql';
import type { PrintAgentJob } from '../../types.js';
import { PRINT_AGENT_REFUSED_MESSAGE, PrintWriteError } from '../print.errors.js';
import { type PrintAgentAdmission, PrintAgentService, readPrintAgentAdmission } from '../print-agent.service.js';
import { PrintAgentJobType, PrintAgentPairingType, PrintReportedPrinterInputType } from './print.types.js';

/**
 * The printing side's PUBLIC surface: a computer exchanging a code for a
 * secret, and then speaking over the socket that secret opened.
 *
 * ## Why this is its own resolver
 *
 * `PrintResolver` declares workspace scope on its class, and every operation
 * there needs a signed-in person with a key. These are reached by a program
 * nobody signs in to. Keeping them in a separate class means no public marker
 * can ever sit on the workspace class, and no workspace scope on this one —
 * `surface-coverage.test.ts` checks both. Every method here must be public,
 * which is also what makes a method added without a marker fail loudly:
 * `JwtAuthGuard` refuses it "Not signed in".
 *
 * ## ⚠ PUBLIC, BUT NOT OPEN
 *
 * "Public" lets an operation past authentication, because a computer has no
 * session. Past `pairPrintAgent`, what admits a computer is the secret it
 * presented at the socket HANDSHAKE, which the app's `admitAnonymous` hook
 * exchanged for an admission on the socket. With no admission — an HTTP
 * request, a signed-in socket, a queue display — each of these refuses before
 * doing anything. None takes a workspace or an agent id: both come from the
 * admission, so a computer cannot speak for another.
 */
@Resolver()
export class PrintAgentResolver {
  constructor(private readonly agents: PrintAgentService) {}

  /**
   * ⚠ NULL IS THE ONLY REFUSAL, whatever the reason. See `PrintAgentService.pair`.
   *
   * ⚠ A CREDENTIAL SURFACE: a program sending a code is guessing a secret, so
   * the app points its tightest rate limit here. This module may not depend on
   * the throttler, so it declares the fact and the app applies the policy.
   */
  @SetMetadata(PUBLIC_SURFACE_METADATA, 'A computer being paired has no session; the pairing code is the authorisation')
  @SetMetadata(CREDENTIAL_SURFACE_METADATA, 'A program sending a pairing code is guessing a secret')
  @Mutation(() => PrintAgentPairingType, { name: 'pairPrintAgent', nullable: true })
  async pair(
    @Args('code') code: string,
    @Args('hostName', { type: () => String, nullable: true }) hostName?: string | null,
    @Args('agentVersion', { type: () => String, nullable: true }) agentVersion?: string | null,
  ): Promise<PrintAgentPairingType | null> {
    return this.agents.pair(code, hostName, agentVersion);
  }

  /**
   * "Still here", every `PRINT_AGENT_HEARTBEAT_SECONDS`. False means the
   * computer is no longer paired; the agent stops.
   *
   * Not a credential surface: nothing is guessed here, the socket already
   * proved a 256-bit secret.
   */
  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'A computer admitted at the socket handshake by its secret; nobody is signed in',
  )
  @Mutation(() => Boolean, { name: 'printAgentHeartbeat' })
  async heartbeat(@Context() gql: { req?: unknown }): Promise<boolean> {
    return this.agents.heartbeat(this.admitted(gql.req));
  }

  /** Everything the computer has installed. A whole list every time; see `PrintAgentService.reportPrinters`. */
  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'A computer admitted at the socket handshake by its secret; nobody is signed in',
  )
  @Mutation(() => Boolean, { name: 'reportPrintAgentPrinters' })
  async reportPrinters(
    @Context() gql: { req?: unknown },
    @Args('printers', { type: () => [PrintReportedPrinterInputType] }) printers: PrintReportedPrinterInputType[],
  ): Promise<boolean> {
    await this.agents.reportPrinters(this.admitted(gql.req), printers);
    return true;
  }

  /**
   * The jobs this computer is asked to print. It says WHAT to print; the file
   * is fetched from the relay's route, with the secret again.
   *
   * `resolve` is required: without it the payload is looked for under the
   * field's name and the computer is told `null`.
   */
  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'A computer admitted at the socket handshake by its secret; nobody is signed in',
  )
  @Subscription(() => PrintAgentJobType, {
    name: 'printAgentJobs',
    resolve: (payload: PrintAgentJobType) => payload,
  })
  jobs(@Context() gql: { req?: unknown }): Promise<AsyncIterableIterator<PrintAgentJob>> {
    return this.agents.jobs(this.admitted(gql.req));
  }

  /** How the printing of one job went. False when the job is not this computer's, or is no longer waiting to hear. */
  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'A computer admitted at the socket handshake by its secret; nobody is signed in',
  )
  @Mutation(() => Boolean, { name: 'reportPrintAgentJob' })
  async reportJob(
    @Context() gql: { req?: unknown },
    @Args('jobId') jobId: string,
    @Args('printed') printed: boolean,
    @Args('message', { type: () => String, nullable: true }) message?: string | null,
  ): Promise<boolean> {
    return this.agents.reportJob(this.admitted(gql.req), jobId, printed, message);
  }

  private admitted(request: unknown): PrintAgentAdmission {
    const admission = readPrintAgentAdmission(request);
    if (!admission) throw new PrintWriteError('not_permitted', PRINT_AGENT_REFUSED_MESSAGE);
    return admission;
  }
}
