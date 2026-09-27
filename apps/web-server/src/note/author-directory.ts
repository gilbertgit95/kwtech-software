import type { NoteAuthor, NoteAuthorDirectory } from '@kwtech/module-note/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Names for notes' authors and last editors.
 *
 * ## Why it lives here
 *
 * Names are `auth_user`, which `module-auth` owns, and a module may not read
 * another's tables (PLAN §9) — the reason `ChatUserDirectory` and the queue's
 * staff directory are app-side too.
 *
 * ⚠ ACCOUNT names, shown to members of the workspace beside notes they can
 * already see. The module only asks about ids on notes the viewer may see.
 */
@Injectable()
export class NoteAuthorDirectoryAdapter implements NoteAuthorDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async describe(userIds: readonly string[]): Promise<readonly NoteAuthor[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_AUTHOR_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return rows.map((row) => ({ userId: row.id, displayName: row.displayName ?? row.username ?? row.id }));
  }
}

/**
 * A page of notes names at most two people each, so this bounds a strange
 * request rather than a normal one. The same number as the queue's lookup.
 */
const MAX_AUTHOR_LOOKUP = 200;
