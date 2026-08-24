import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/client.js';

/**
 * The one connection to the database.
 *
 * The APPLICATION owns the connection lifecycle — that is the other half of the
 * rule that keeps every `module-*` package free of `@prisma/client`. Both
 * modules depend on a structural interface this class happens to satisfy, which
 * is why binding it is one line each in AppModule and why the modules' own
 * tests need no database at all.
 *
 * Under Prisma 7 the boundary is enforced by the client itself: constructing a
 * PrismaClient without a driver adapter throws, so the adapter below is not
 * optional wiring.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  /**
   * Probe the pool at boot with a real query.
   *
   * `$connect()` is NOT a connectivity check when a driver adapter is in play:
   * the pg pool is lazy, so it resolves happily against a host with nothing
   * listening. Only a round trip proves anything, which is why this issues
   * `SELECT 1`.
   *
   * A failed probe logs and continues rather than killing the process. The pool
   * recovers on its own when the database returns, /health answers 503 in the
   * meantime so a load balancer routes away, and a transient failover does not
   * become a restart storm.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Database reachable');
    } catch (error) {
      this.logger.error(`Database unreachable at boot: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
