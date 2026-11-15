import { createHash, randomBytes } from 'node:crypto';
import { type LimitChecker, type LimitDecision, limitReachedText } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { prepareAgentName } from '../domain/agents.js';
import { PRINT_PAIRING_CODE_LENGTH, pairingCodeFromBytes, pairingExpiry } from '../domain/pairing.js';
import { prepareReceiptSettings } from '../domain/receipt-printers.js';
import { PRINT_LIMIT, PRINT_LIMIT_REGISTRY } from '../feature-keys.js';
import { PrintWriteError, refusalError } from './print.errors.js';
import type { PrintWriteClient } from './print.repository.js';
import type { PrintScope } from './print.service.js';
import { PRINT_LIMIT_CHECKER, PRINT_PRISMA_WRITE } from './print.tokens.js';

/**
 * What is stored for a code or a secret: SHA-256, hex.
 *
 * ⚠ Both are bearer credentials, so neither is ever stored raw — the
 * invitation-token rule, and the queue's display pass. Unsalted on purpose: a
 * secret is 256 random bits and a code lives ten minutes, so there is no
 * dictionary to slow down, and the lookup must be BY the hash.
 */
export function hashPrintCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface CreatedPairingCode {
  /** The raw code. Returned once, to the person who asked, and never stored. */
  code: string;
  expiresAt: Date;
}

/**
 * Every write a PERSON makes: a code for a computer, and taking a computer away.
 *
 * What a COMPUTER writes is in `PrintAgentService`, kept apart so no method
 * here can be reached without an actor and no method there with one.
 */
@Injectable()
export class PrintWriteService {
  constructor(
    @Inject(PRINT_PRISMA_WRITE) private readonly prisma: PrintWriteClient,
    /** Unbound: the declared default cap — see `PRINT_LIMIT_CHECKER`. */
    @Optional() @Inject(PRINT_LIMIT_CHECKER) private readonly limits?: LimitChecker,
  ) {}

  /**
   * A one-time code for one computer, named now.
   *
   * ⚠ THE CAP IS CHECKED HERE AND AGAIN WHEN THE CODE IS USED. Here so a
   * person is told "revoke one first" on the screen they are looking at; there
   * because the count that matters is the one at the moment a computer is
   * actually added, ten minutes and another code later.
   *
   * The workspace's used and expired codes are removed in the same
   * transaction. They are credentials with nothing left to prove — who paired
   * what is on the `PrintAgent` row — and nothing else would ever clear them.
   */
  async createPairingCode(scope: PrintScope, actorId: string, name: unknown): Promise<CreatedPairingCode> {
    const prepared = prepareAgentName(name);
    if ('refused' in prepared) throw refusalError(prepared.refused);

    const now = new Date();
    const code = pairingCodeFromBytes(randomBytes(PRINT_PAIRING_CODE_LENGTH));
    const expiresAt = pairingExpiry(now);

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.printAgent.count({ where: { ...scope, revokedAt: null } });
      const decision = await this.checkCap(scope, actorId, current);
      if (!decision.allowed) {
        throw new PrintWriteError(
          'limit_reached',
          `${limitReachedText(decision, { one: 'paired computer', many: 'paired computers' })} Revoke one to pair another.`,
          { limit: decision.limit, raise: decision.raise },
        );
      }
      await tx.printPairingCode.deleteMany({
        where: { ...scope, OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
      });
      await tx.printPairingCode.create({
        data: { ...scope, codeHash: hashPrintCredential(code), name: prepared.name, createdById: actorId, expiresAt },
      });
    });
    return { code, expiresAt };
  }

  /**
   * Take a computer away. Its secret stops working at once for a new socket,
   * and on its next heartbeat for one already open.
   *
   * ⚠ NOT INSTANT FOR AN OPEN SOCKET. A socket is admitted once, at the
   * handshake, so a revoked computer stays connected for up to one heartbeat
   * (`PRINT_AGENT_HEARTBEAT_SECONDS`). Every operation it makes in between is
   * refused, because each one checks the row again.
   *
   * Revoking twice is not an error: the second person to press the button
   * wanted the same thing and has it.
   */
  async revokeAgent(scope: PrintScope, actorId: string, agentId: string): Promise<void> {
    const agent = await this.prisma.printAgent.findFirst({ where: { ...scope, id: agentId } });
    if (!agent) throw refusalError('not_found');
    if (agent.revokedAt !== null) return;
    await this.prisma.printAgent.updateMany({
      where: { ...scope, id: agentId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actorId },
    });
  }

  /**
   * Marks a printer as a receipt printer with its settings, or (`null`)
   * makes it a document printer again (#144, R4).
   *
   * ⚠ Unmarking the workspace's default receipt printer clears the default
   * too, in the same transaction: a default that is not a receipt printer
   * would send every receipt to a printer that refuses them.
   */
  async setReceiptPrinter(
    scope: PrintScope,
    actorId: string,
    printerId: string,
    raw: { label?: unknown; paperWidth: unknown; cutter: unknown; drawer: unknown; qr: unknown } | null,
  ): Promise<void> {
    const printer = await this.prisma.printPrinter.findFirst({ where: { ...scope, id: printerId } });
    if (!printer) throw refusalError('not_found');
    if (raw === null) {
      // The default pointing here goes with it, by the database's cascade.
      await this.prisma.printReceiptPrinter.deleteMany({ where: { ...scope, printerId } });
      return;
    }
    const settings = prepareReceiptSettings(raw);
    if ('refused' in settings) throw refusalError(settings.refused);
    // Marked only while it can print: a gone printer, or a revoked computer's, would be a receipt printer nobody can use.
    await this.requireLive(scope, printer);
    const values = { ...settings, updatedById: actorId };
    await this.prisma.printReceiptPrinter.upsert({
      where: { printerId },
      create: { ...scope, printerId, ...values },
      update: values,
    });
  }

  /** Sets the workspace's default receipt printer, which must be one; `null` clears it. */
  async setReceiptDefault(scope: PrintScope, actorId: string, printerId: string | null): Promise<void> {
    if (printerId === null) {
      await this.prisma.printReceiptDefault.deleteMany({ where: { workspaceId: scope.workspaceId } });
      return;
    }
    // A printer of another workspace reads as not found, as everywhere.
    const printer = await this.prisma.printPrinter.findFirst({ where: { ...scope, id: printerId } });
    if (!printer) throw refusalError('not_found');
    const receipt = await this.prisma.printReceiptPrinter.findFirst({ where: { ...scope, printerId } });
    if (!receipt) throw refusalError('not_a_receipt_printer');
    await this.requireLive(scope, printer);
    try {
      await this.prisma.printReceiptDefault.upsert({
        where: { workspaceId: scope.workspaceId },
        create: { ...scope, printerId, updatedById: actorId },
        update: { printerId, updatedById: actorId },
      });
    } catch (error) {
      // ⚠ Unmarked between the check and here: the foreign key refused it (P2003), and it is what it says.
      if (isForeignKeyViolation(error)) throw refusalError('not_a_receipt_printer');
      throw error;
    }
  }

  /** Refuses a printer that cannot print: gone from its computer's report, or on a revoked computer. */
  private async requireLive(scope: PrintScope, printer: { agentId: string; goneAt: Date | null }): Promise<void> {
    if (printer.goneAt !== null) throw refusalError('printer_gone');
    const agent = await this.prisma.printAgent.findFirst({ where: { ...scope, id: printer.agentId } });
    if (!agent || agent.revokedAt !== null) throw refusalError('not_found');
  }

  /**
   * The cap for this workspace, as a decision on `current`.
   *
   * ⚠ Shared with `PrintAgentService.pair`, which is why it is public: the two
   * checks must resolve the same number the same way, and two copies of "what
   * unbound means" would be the second one drifting.
   */
  async checkCap(scope: PrintScope, actorId: string, current: number): Promise<LimitDecision> {
    if (this.limits) return this.limits.check({ actorId, key: PRINT_LIMIT.agents, current, ...scope });
    // ⚠ Unbound is the declared default, never unlimited.
    const cap = PRINT_LIMIT_REGISTRY.find((entry) => entry.key === PRINT_LIMIT.agents)?.defaultValue ?? 0;
    return { allowed: current < cap, limit: cap, current, remaining: Math.max(cap - current, 0) };
  }
}

/** A foreign key refused the write (Prisma's P2003), found structurally: this module never imports Prisma. */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2003';
}
