import { Inject, Injectable } from '@nestjs/common';
import { isAgentOnline } from '../domain/agents.js';
import { prepareJobOptions } from '../domain/jobs.js';
import { preparePapers, prepareSettings } from '../domain/printers.js';
import { refusalError } from './print.errors.js';
import type { PrintPrismaClient } from './print.repository.js';
import type { PrintScope } from './print.service.js';
import { PRINT_PRISMA } from './print.tokens.js';
import { type OpenedJob, type PrintJobView, PrintRelayService } from './print-relay.service.js';

/** What a person sends to print. Every field is checked here; the resolver passes them as they came. */
export interface StartPrintJobInput {
  printerId: unknown;
  paperName: unknown;
  copies: unknown;
  size: unknown;
  /** One of the printer's paper types and qualities, by id. Left out: as the printer is set. */
  mediaType?: unknown;
  quality?: unknown;
}

/**
 * What a PERSON does with a job: open one for a printer, and read how it went.
 *
 * It decides whether a job MAY be opened — the printer is this workspace's,
 * still there, on a computer that is paired and online — and hands the rest
 * to the relay. No file passes through here.
 */
@Injectable()
export class PrintJobService {
  constructor(
    @Inject(PRINT_PRISMA) private readonly prisma: PrintPrismaClient,
    private readonly relay: PrintRelayService,
  ) {}

  /**
   * ⚠ REFUSED, NOT QUEUED, when the computer is offline (`agent_offline`). A
   * job cannot wait for a computer that is switched off, because waiting
   * means holding the file (PLAN §13, 2026-10-07). The person tries again, or
   * downloads the file as before.
   *
   * ⚠ `not_found` for a printer in another workspace, exactly as for one that
   * does not exist: the lookup names the workspace.
   */
  async start(scope: PrintScope, actorId: string, input: StartPrintJobInput): Promise<OpenedJob> {
    if (typeof input.printerId !== 'string') throw refusalError('not_found');
    const printer = await this.prisma.printPrinter.findFirst({ where: { ...scope, id: input.printerId } });
    if (!printer) throw refusalError('not_found');
    if (printer.goneAt !== null) throw refusalError('printer_gone');

    const agent = await this.prisma.printAgent.findFirst({ where: { ...scope, id: printer.agentId } });
    // A revoked computer's printers are listed nowhere; one named by id anyway is not found.
    if (!agent || agent.revokedAt !== null) throw refusalError('not_found');
    if (!isAgentOnline(agent, new Date())) throw refusalError('agent_offline');

    const options = prepareJobOptions(input, preparePapers(printer.papers) ?? [], prepareSettings(printer.settings));
    if ('refused' in options) throw refusalError(options.refused);

    return this.relay.open({ ...scope, agentId: agent.id, actorId, printerName: printer.name, options });
  }

  /** How one of this person's jobs stands, or null — forgotten, somebody else's, or never a job. */
  status(scope: PrintScope, actorId: string, jobId: string): PrintJobView | null {
    return this.relay.view(scope, actorId, jobId);
  }
}
