import { createHash, randomBytes } from 'node:crypto';
import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { prepareAgentName } from '../domain/agents.js';
import { PRINT_PAIRING_CODE_LENGTH, pairingCodeFromBytes, pairingExpiry } from '../domain/pairing.js';
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
          `This workspace can have ${decision.limit} paired computers — revoke one first`,
          { limit: decision.limit },
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
