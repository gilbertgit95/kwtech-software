import type { NotificationRecipientView, NotificationUserDirectory } from '@kwtech/module-notification/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * People, for the notification compose screen — read from `auth_user`, which
 * belongs to `module-auth`. The notification module may not import it (PLAN §9),
 * so the app, which depends on both, answers. Same seam as chat's directory.
 *
 * ⚠ Unlike chat's exact-email lookup, this SEARCHES by name and email. That is
 * deliberate and bounded: the only caller is behind `notification:send`, a
 * privileged key that platform administrators hold, and an administrator who
 * already manages every account learns nothing new from a search box.
 *
 * ⚠ Active accounts only. A notification to a disabled account is one nobody
 * will ever read, and offering it would suggest otherwise.
 */
@Injectable()
export class NotificationUserDirectoryAdapter implements NotificationUserDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, limit: number): Promise<NotificationRecipientView[]> {
    const term = query.trim();
    if (!term) return [];
    const rows = await this.prisma.authUser.findMany({
      where: {
        status: 'active',
        OR: [
          { email: { contains: term, mode: 'insensitive' } },
          { displayName: { contains: term, mode: 'insensitive' } },
          { username: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, displayName: true, username: true },
      orderBy: { email: 'asc' },
      take: Math.min(limit, MAX_SEARCH),
    });
    return rows.map((row) => ({
      userId: row.id,
      displayName: row.displayName ?? row.username ?? row.email,
      email: row.email,
    }));
  }

  async names(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_NAMES) } },
      select: { id: true, email: true, displayName: true, username: true },
    });
    return new Map(rows.map((row) => [row.id, row.displayName ?? row.username ?? row.email]));
  }
}

/** A search box never needs more; a page of batches never names more. */
const MAX_SEARCH = 20;
const MAX_NAMES = 200;
