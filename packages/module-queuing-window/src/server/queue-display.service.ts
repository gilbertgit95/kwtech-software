import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { DISPLAY_PASS_BYTES, evaluateCodeExchange } from '../domain/session.js';
import type { QueueWorkspaceLocator } from './ports.js';
import type { QueueWriteClient } from './queue.repository.js';
import { QUEUE_PRISMA_WRITE, QUEUE_WORKSPACE_LOCATOR } from './queue.tokens.js';

/**
 * What is stored for a pass: SHA-256, hex.
 *
 * ⚠ The pass is a bearer credential on a device in a public room, so it follows
 * the invitation-token rule and is never stored raw. Nobody ever needs to read
 * one back.
 */
export function hashDisplayPass(pass: string): string {
  return createHash('sha256').update(pass).digest('hex');
}

/** More than any code, formatted or not. Anything longer is refused unread. */
const MAX_TYPED_CODE = 32;

export interface OpenedDisplay {
  /** The raw pass. Returned once, to the TV, and never stored. */
  pass: string;
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
}

/**
 * Admitting a display: a typed code in, a pass out.
 *
 * ⚠ GUESSING HAPPENS HERE, OVER HTTP, NEVER AT THE SOCKET. The mutation that
 * calls this is marked a credential surface, so the app points its tightest
 * rate limit at it; the socket handshake later takes the 256-bit pass, which
 * cannot be guessed and needs no limiter.
 */
@Injectable()
export class QueueDisplayService {
  constructor(
    @Inject(QUEUE_PRISMA_WRITE) private readonly prisma: QueueWriteClient,
    /** Absent means no display can ever open. */
    @Optional() @Inject(QUEUE_WORKSPACE_LOCATOR) private readonly locator?: QueueWorkspaceLocator,
  ) {}

  /**
   * A pass for this TV, or null.
   *
   * ⚠ NULL FOR EVERY FAILURE — unknown organization or workspace, no session
   * running, wrong code, too many attempts, display cap — so the public page can
   * say only `DISPLAY_CODE_REFUSAL_MESSAGE`. A page that answered "no such
   * organization" differently would let anybody enumerate customers by guessing
   * names. The console reads the specific reason from the session instead.
   *
   * ⚠ A wrong code is COUNTED, and the count is committed even though the
   * answer is a refusal — which is why this returns null from inside the
   * transaction rather than throwing out of it.
   *
   * Timing is not equalised: an unknown organization answers after one lookup,
   * a real one after a transaction. The exchange is rate-limited per IP, which
   * makes a timing probe slower than simply reading company names off the web.
   */
  async openDisplay(organizationKey: string, workspaceKey: string, typed: string): Promise<OpenedDisplay | null> {
    const place = (await this.locator?.locate(organizationKey, workspaceKey)) ?? null;
    if (!place) return null;

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.queueSession.findUnique({ where: { openWorkspaceId: place.workspaceId } });
      const activeDisplays = session ? await tx.queueDisplayPass.count({ where: { sessionId: session.id } }) : 0;

      const outcome = evaluateCodeExchange({
        session,
        typed: typed.length > MAX_TYPED_CODE ? '' : typed,
        activeDisplays,
      });

      if (!outcome.accepted) {
        if (outcome.countsAsFailure && session) {
          await tx.queueSession.updateMany({
            where: { id: session.id, openWorkspaceId: place.workspaceId },
            data: { failedCodeAttempts: { increment: 1 } },
          });
        }
        return null;
      }
      // Unreachable — an accepted exchange has a session — and kept for the compiler.
      if (!session) return null;

      const pass = randomBytes(DISPLAY_PASS_BYTES).toString('base64url');
      await tx.queueDisplayPass.create({
        data: {
          organizationId: session.organizationId,
          workspaceId: session.workspaceId,
          sessionId: session.id,
          tokenHash: hashDisplayPass(pass),
        },
      });

      return {
        pass,
        organizationId: session.organizationId,
        workspaceId: session.workspaceId,
        workspaceName: place.workspaceName,
        sessionId: session.id,
      };
    });
  }
}
