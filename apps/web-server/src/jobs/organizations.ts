import type { JobsOrganizations } from '@kwtech/module-jobs/server';
import type { ProcessOrganizationPage } from '@kwtech/module-kit';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * EVERY organization, for a background process that reaches them all (#94):
 * billing's daily check, which must reach an organization whose plan expired —
 * exactly the one `JobsEntitledWorkspacesAdapter`'s plan gate would hide.
 *
 * App-side because organizations are `module-permissions`' table and the runner
 * may not import it (PLAN §9). ⚠ No plan and no grant is read, on purpose: the
 * platform acting on its customers. Ordered by id, the cursor the last id, so
 * pages are stable while organizations come and go.
 */
@Injectable()
export class JobsOrganizationsAdapter implements JobsOrganizations {
  constructor(private readonly prisma: PrismaService) {}

  async page(cursor: string | null, limit: number): Promise<ProcessOrganizationPage> {
    // 0 would read as "the last page" while organizations remain, and a negative
    // `take` reads backwards. A throw is recorded as a skipped run, saying so.
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error(`A page of organizations needs a positive limit, not ${limit}.`);
    const rows = await this.prisma.permOrganization.findMany({
      where: cursor === null ? {} : { id: { gt: cursor } },
      select: { id: true },
      orderBy: { id: 'asc' },
      // One more than asked, to know whether another page follows without a second query.
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      organizations: page.map((row) => ({ organizationId: row.id })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
