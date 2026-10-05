import type { JobsActorDirectory } from '@kwtech/module-jobs/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Names for the background processes page: who paused a process, forced a run
 * or changed a schedule.
 *
 * App-side because accounts are `module-auth`'s table (`auth_user`) and the
 * runner may not import it (PLAN §9). A read of another module's rows, so it
 * needs no service — as `QueueStaffDirectoryAdapter.describe` reads the same
 * three columns.
 *
 * ⚠ A LOOK-UP ONLY, for ids the module already holds on its own rows, and
 * CAPPED: a page of history names a few people, never hundreds. An id with no
 * account (it was removed) is left out, and the page says "an administrator".
 */
@Injectable()
export class JobsActorDirectoryAdapter implements JobsActorDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async names(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_ACTOR_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return new Map(rows.map((row) => [row.id, row.displayName ?? row.username ?? row.id]));
  }
}

/** The same number, and the same argument, as the queue's staff look-up. */
const MAX_ACTOR_LOOKUP = 200;
