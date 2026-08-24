import { AUTH_PRISMA, type AuthPrismaClient, type AuthTransaction } from '@kwtech/module-auth/server';
import {
  PERMISSIONS_PRISMA,
  PERMISSIONS_PRISMA_WRITE,
  type PermissionsPrismaClient,
  type PermissionsTransaction,
  type PermissionsWriteClient,
} from '@kwtech/module-permissions/server';
import type { Provider } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Binds this app's Prisma client to each module's structural interface.
 *
 * The modules' READ interfaces are satisfied by PrismaService directly — that
 * is checked, not assumed, in ./satisfies-modules.ts — so those bind with
 * `useExisting` and nothing here would be needed at all if reads were the whole
 * story.
 *
 * `$transaction` is the exception, and the reason this file exists. Prisma's
 * `$transaction` is OVERLOADED — an array form and a callback form — and
 * TypeScript cannot match the callback overload against the modules' single
 * callback signature once Prisma's generated generics are involved: it gives up
 * on the structural comparison and reports the array overload instead. The
 * delegates all fit; only the dispatcher does not.
 *
 * So the adapter is one line per model plus one narrowed `$transaction`. The
 * alternative — loosening the modules' `$transaction` to take `any` — would buy
 * the same wiring by discarding the type of the transaction handle inside every
 * write in both modules, which is exactly where it is worth most.
 */

/** Everything except the dispatcher is a straight pass-through of the delegate. */
function withTransaction<Tx, Client extends { $transaction: unknown }>(
  prisma: PrismaService,
  delegates: Omit<Client, '$transaction'>,
): Client {
  return {
    ...delegates,
    $transaction: <T>(fn: (tx: Tx) => Promise<T>) =>
      // The single cast in the wiring, and a narrow one: Prisma hands the
      // callback its interactive transaction client, which carries every
      // delegate above. What it does NOT carry is `$transaction` itself — which
      // is precisely what the modules' `Tx` type omits, so the shapes agree at
      // runtime and only the compiler needs telling.
      prisma.$transaction(fn as unknown as (tx: unknown) => Promise<T>),
  } as Client;
}

export const authPrismaProvider: Provider = {
  provide: AUTH_PRISMA,
  inject: [PrismaService],
  useFactory: (prisma: PrismaService): AuthPrismaClient =>
    withTransaction<AuthTransaction, AuthPrismaClient>(prisma, {
      authUser: prisma.authUser,
      authCredential: prisma.authCredential,
      authSession: prisma.authSession,
      authPasswordReset: prisma.authPasswordReset,
    }),
};

/** Reads need no adapter — PrismaService satisfies this interface outright. */
export const permissionsPrismaProvider: Provider = {
  provide: PERMISSIONS_PRISMA,
  useExisting: PrismaService,
};

export const permissionsWritePrismaProvider: Provider = {
  provide: PERMISSIONS_PRISMA_WRITE,
  inject: [PrismaService],
  useFactory: (prisma: PrismaService): PermissionsWriteClient =>
    withTransaction<PermissionsTransaction, PermissionsWriteClient>(prisma, {
      permOrganization: prisma.permOrganization,
      permUserRole: prisma.permUserRole,
      permMembership: prisma.permMembership,
      permWorkspace: prisma.permWorkspace,
      permWorkspaceMember: prisma.permWorkspaceMember,
      permSubscription: prisma.permSubscription,
      permRole: prisma.permRole,
      permMembershipRole: prisma.permMembershipRole,
      permWorkspaceMemberRole: prisma.permWorkspaceMemberRole,
    }),
};

export type { PermissionsPrismaClient };
