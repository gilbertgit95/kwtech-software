import { Public } from '@kwtech/module-auth/server';
import { Controller, Get, HttpCode } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * A health check is a route, not a feature — no permission key, and explicitly
 * @Public so the globally applied JwtAuthGuard lets a load balancer through.
 *
 * That annotation is the visible cost of authentication being opt-OUT here,
 * and it is the right cost: forgetting it makes the health check fail closed,
 * whereas the opposite default would make a forgotten endpoint anonymous.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public('load balancers cannot sign in')
  @Get()
  @HttpCode(200)
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      // 503 rather than a thrown 500: an unreachable database is a routing
      // decision for whatever is in front, not an application bug.
      return { status: 'degraded', database: 'down' };
    }
  }
}
