import { randomBytes } from 'node:crypto';
import { anonymousAdmission } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { cleanReportedText } from '../domain/agents.js';
import {
  isAgentSecretShaped,
  isPairingCodeUsable,
  normalisePairingCode,
  PRINT_AGENT_SECRET_BYTES,
  PRINT_AGENT_SECRET_PARAM,
} from '../domain/pairing.js';
import { planPrinterReport, prepareReportedPrinters } from '../domain/printers.js';
import type { PrintAgentJob } from '../types.js';
import { refusalError } from './print.errors.js';
import type { PrintPrinterValues, PrintWriteClient } from './print.repository.js';
import { PRINT_PRISMA_WRITE } from './print.tokens.js';
import { PrintRelayService } from './print-relay.service.js';
import { hashPrintCredential, PrintWriteService } from './print-write.service.js';

/**
 * What a socket admitted by an agent's secret carries, under module-kit's
 * `ANONYMOUS_ADMISSION_KEY`. ⚠ Not an identity: see that key.
 *
 * `kind` is checked on the way back out, so an admission some OTHER module's
 * hook produced — a queue display's — can never be read as a computer's.
 */
export interface PrintAgentAdmission {
  kind: 'print-agent';
  agentId: string;
  /** What the app's socket limiter counts against: one computer, a couple of sockets. */
  connectionKey: string;
  organizationId: string;
  workspaceId: string;
}

/** The agent admission on a request, or null for anything else — a signed-in socket and an HTTP request included. */
export function readPrintAgentAdmission(request: unknown): PrintAgentAdmission | null {
  const admission = anonymousAdmission<Partial<PrintAgentAdmission>>(request);
  if (admission?.kind !== 'print-agent') return null;
  const { agentId, organizationId, workspaceId } = admission;
  return typeof agentId === 'string' && typeof organizationId === 'string' && typeof workspaceId === 'string'
    ? { kind: 'print-agent', agentId, organizationId, workspaceId, connectionKey: `print-agent:${agentId}` }
    : null;
}

/** Whether a socket's `connectionParams` are a computer presenting a secret — how the host routes its handshake. */
export function isPrintAgentHandshake(connectionParams: Readonly<Record<string, unknown>>): boolean {
  return PRINT_AGENT_SECRET_PARAM in connectionParams;
}

export interface PairedAgent {
  /** The raw secret. Returned once, to the computer, and never stored. */
  secret: string;
  agentId: string;
  name: string;
}

/**
 * Everything a COMPUTER does: pair, connect, say it is still there, and report
 * its printers.
 *
 * ⚠ GUESSING HAPPENS IN `pair`, OVER HTTP, NEVER AT THE SOCKET. The mutation
 * that calls it is marked a credential surface, so the app points its tightest
 * rate limit at it; the socket handshake later takes the 256-bit secret, which
 * cannot be guessed and needs no limiter.
 *
 * ⚠ EVERY METHOD AFTER `admit` CHECKS THE ROW AGAIN. An admission is a fact
 * about the handshake; a computer can be revoked a second later, and its
 * socket stays open.
 */
@Injectable()
export class PrintAgentService {
  constructor(
    @Inject(PRINT_PRISMA_WRITE) private readonly prisma: PrintWriteClient,
    private readonly writes: PrintWriteService,
    private readonly relay: PrintRelayService,
  ) {}

  /**
   * A secret for this computer, or null.
   *
   * ⚠ NULL FOR EVERY FAILURE — not a code, wrong, used, expired, or the
   * workspace already has all the computers it may — so a computer running
   * through codes learns nothing from the answers. The person who made the
   * code sees why on their own screen: the computer does not appear.
   *
   * ⚠ THE CLAIM IS ONE STATEMENT (`updateMany` on `usedAt: null`), so two
   * computers typing the same code at once cannot both pair. A code refused
   * for the cap is NOT claimed: the count is taken first, so the person can
   * revoke a computer and use the code they already have.
   *
   * Timing is not equalised: a code that is not shaped like one answers
   * without a query, a real one after a transaction. The exchange is rate
   * limited per address, and what a timing probe could learn — that some
   * ten-symbol string is a live code — is the thing it would have to guess
   * first.
   */
  async pair(typed: unknown, hostName: unknown, agentVersion: unknown): Promise<PairedAgent | null> {
    const code = normalisePairingCode(typed);
    if (!code) return null;

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.printPairingCode.findUnique({ where: { codeHash: hashPrintCredential(code) } });
      if (!isPairingCodeUsable(row, now) || !row) return null;

      const scope = { organizationId: row.organizationId, workspaceId: row.workspaceId };
      const current = await tx.printAgent.count({ where: { ...scope, revokedAt: null } });
      const decision = await this.writes.checkCap(scope, row.createdById, current);
      if (!decision.allowed) return null;

      const claimed = await tx.printPairingCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;

      const secret = randomBytes(PRINT_AGENT_SECRET_BYTES).toString('base64url');
      const agent = await tx.printAgent.create({
        data: {
          ...scope,
          name: row.name,
          hostName: cleanReportedText(hostName),
          agentVersion: cleanReportedText(agentVersion),
          secretHash: hashPrintCredential(secret),
          pairedById: row.createdById,
          // Null until it connects: pairing over HTTP is not being online.
          lastSeenAt: null,
        },
      });
      return { secret, agentId: agent.id, name: agent.name };
    });
  }

  /**
   * The socket handshake's hook: a secret in `connectionParams`, an admission out.
   *
   * Wired by the app into `admitAnonymous`, for sockets `isPrintAgentHandshake`
   * says are a computer's. Null refuses the socket as 4403, which the agent
   * treats as final: it was revoked, and it stops. A database fault THROWS, so
   * the socket closes 4500 and the agent retries.
   *
   * ⚠ NO ATTEMPT LIMITER, and none is needed: the secret is 256 random bits.
   * Anything not shaped like one is refused before a query.
   */
  async admit(connectionParams: Readonly<Record<string, unknown>>): Promise<PrintAgentAdmission | null> {
    const admission = await this.admitSecret(connectionParams[PRINT_AGENT_SECRET_PARAM]);
    if (!admission) return null;

    // Connecting counts as being there: the page shows it online without waiting a heartbeat.
    await this.prisma.printAgent.updateMany({
      where: { id: admission.agentId, revokedAt: null },
      data: { lastSeenAt: new Date() },
    });
    return admission;
  }

  /**
   * Which computer a secret is, or null — not shaped like one, unknown, or
   * revoked. The one lookup behind the socket handshake and the request that
   * fetches a job's file, so "paired" means the same thing at both.
   *
   * ⚠ IT WRITES NOTHING. Fetching a file is not a heartbeat.
   */
  async admitSecret(secret: unknown): Promise<PrintAgentAdmission | null> {
    if (!isAgentSecretShaped(secret)) return null;
    const agent = await this.prisma.printAgent.findUnique({ where: { secretHash: hashPrintCredential(secret) } });
    if (!agent || agent.revokedAt !== null) return null;
    return {
      kind: 'print-agent',
      agentId: agent.id,
      connectionKey: `print-agent:${agent.id}`,
      organizationId: agent.organizationId,
      workspaceId: agent.workspaceId,
    };
  }

  /**
   * The jobs for this computer: those waiting, then each as it is opened.
   *
   * Throws `agent_revoked` for a computer no longer paired — checked when it
   * subscribes. ⚠ A computer revoked while subscribed still hears of a job
   * opened in the next heartbeat's time; it cannot fetch it, because the
   * fetch presents the secret again.
   */
  async jobs(admission: PrintAgentAdmission): Promise<AsyncIterableIterator<PrintAgentJob>> {
    if (!(await this.heartbeat(admission))) throw refusalError('agent_revoked');
    return this.relay.watch(admission.agentId);
  }

  /**
   * How the printing of one job went. False for a job that is not this
   * computer's, or is not waiting to hear — a second report, or one that
   * arrives after the job timed out.
   */
  async reportJob(admission: PrintAgentAdmission, jobId: string, printed: boolean, message: unknown): Promise<boolean> {
    if (!(await this.heartbeat(admission))) throw refusalError('agent_revoked');
    return this.relay.report(jobId, admission.agentId, printed, message);
  }

  /**
   * "Still here." False when the computer is no longer paired, which the agent
   * treats as final and stops on.
   *
   * ⚠ ONE STATEMENT, and it is the revocation check too: the update names
   * `revokedAt: null`, so a revoked computer writes nothing and learns it was
   * revoked from the same answer.
   */
  async heartbeat(admission: PrintAgentAdmission): Promise<boolean> {
    const touched = await this.prisma.printAgent.updateMany({
      where: { id: admission.agentId, revokedAt: null },
      data: { lastSeenAt: new Date() },
    });
    return touched.count === 1;
  }

  /**
   * Everything this computer has installed, replacing what was known.
   *
   * ⚠ A REPORT IS A WHOLE LIST, never a change: a printer it leaves out is
   * marked gone. So the computer sends all of them every time, and a report
   * lost on the way is put right by the next one.
   *
   * Throws `agent_revoked` for a computer no longer paired, and
   * `invalid_printers` for a list that is not one.
   */
  async reportPrinters(admission: PrintAgentAdmission, reported: unknown): Promise<void> {
    const prepared = prepareReportedPrinters(reported);
    if ('refused' in prepared) throw refusalError(prepared.refused);

    const now = new Date();
    const scope = { organizationId: admission.organizationId, workspaceId: admission.workspaceId };
    await this.prisma.$transaction(async (tx) => {
      // ⚠ First, and inside the transaction: nothing is written for a revoked computer.
      const alive = await tx.printAgent.updateMany({
        where: { id: admission.agentId, revokedAt: null },
        data: { lastSeenAt: now },
      });
      if (alive.count !== 1) throw refusalError('agent_revoked');

      const known = await tx.printPrinter.findMany({
        where: { agentId: admission.agentId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        // Every row this computer ever reported, gone ones included; bounded by what one report may hold, many times over.
        take: 1000,
      });
      const plan = planPrinterReport(
        known.filter((printer) => printer.goneAt === null).map((printer) => printer.name),
        prepared.printers,
      );

      // Sequential on purpose: one transaction is one connection, and it runs one statement at a time.
      for (const printer of plan.write) {
        const values: PrintPrinterValues = {
          driver: printer.driver,
          isDefault: printer.isDefault,
          status: printer.status,
          papers: printer.papers,
          settings: printer.settings,
          reportedAt: now,
          goneAt: null,
        };
        await tx.printPrinter.upsert({
          where: { agentId_name: { agentId: admission.agentId, name: printer.name } },
          create: { ...scope, agentId: admission.agentId, name: printer.name, ...values },
          update: values,
        });
      }
      if (plan.gone.length > 0) {
        await tx.printPrinter.updateMany({
          where: { agentId: admission.agentId, name: { in: [...plan.gone] }, goneAt: null },
          data: { goneAt: now },
        });
      }
    });
  }
}
