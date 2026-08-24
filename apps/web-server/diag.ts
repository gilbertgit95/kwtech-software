import type { AuthPrismaClient } from '@kwtech/module-auth/server';
import type { PrismaService } from './src/prisma/prisma.service.js';

declare const svc: PrismaService;
export const a: AuthPrismaClient = svc;
