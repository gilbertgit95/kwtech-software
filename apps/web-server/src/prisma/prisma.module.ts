import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Global because there is exactly one pool and every feature module reads from
 * it. Importing it per module would invite a second PrismaService instance, and
 * a second instance means a second connection pool.
 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
