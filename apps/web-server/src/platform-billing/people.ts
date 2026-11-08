import type { PlatformBillingPeople } from '@kwtech/module-platform-billing/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Whether an approver belongs to the organization whose payment they approve
 * (D15): flagged on the request and in the queue, never blocking, because a
 * small platform may have one approver. Memberships are permissions' table.
 */
@Injectable()
export class PlatformBillingPeopleAdapter implements PlatformBillingPeople {
  constructor(private readonly prisma: PrismaService) {}

  /** An active membership of `userId` in `organizationId`: the D15 flag. */
  async isMember(userId: string, organizationId: string): Promise<boolean> {
    const found = await this.prisma.permMembership.findFirst({
      where: { userId, organizationId, status: 'active' },
      select: { id: true },
    });
    return found !== null;
  }

  /** The organization's name, for what billing prints ("Billed to"). */
  async organizationName(organizationId: string): Promise<string | null> {
    const found = await this.prisma.permOrganization.findFirst({
      where: { id: organizationId },
      select: { name: true },
    });
    return found?.name ?? null;
  }
}
