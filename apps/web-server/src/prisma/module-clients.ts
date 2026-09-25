import { AUTH_PRISMA, type AuthPrismaClient, type AuthTransaction } from '@kwtech/module-auth/server';
import {
  CHAT_PRISMA,
  CHAT_PRISMA_WRITE,
  type ChatPrismaClient,
  type ChatTransaction,
  type ChatWriteClient,
} from '@kwtech/module-chat/server';
import {
  PERMISSIONS_PRISMA,
  PERMISSIONS_PRISMA_WRITE,
  type PermissionsPrismaClient,
  type PermissionsTransaction,
  type PermissionsWriteClient,
} from '@kwtech/module-permissions/server';
import {
  QUEUE_PRISMA,
  QUEUE_PRISMA_WRITE,
  type QueueTransaction,
  type QueueWriteClient,
} from '@kwtech/module-queuing-window/server';
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
      authMfaFactor: prisma.authMfaFactor,
      authMfaEmailCode: prisma.authMfaEmailCode,
      authIdentity: prisma.authIdentity,
      authRecoveryCode: prisma.authRecoveryCode,
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
      // The platform's defaults. Written from one admin screen and read by the
      // three creation paths that consult them.
      permDefault: prisma.permDefault,
      permWorkspace: prisma.permWorkspace,
      permWorkspaceMember: prisma.permWorkspaceMember,
      /*
       * Subscriptions are written now, not only read.
       *
       * That reverses an explicit earlier decision — billing was to own this
       * table — and the reversal, with the idempotency questions it had to
       * answer first, is recorded in docs/PLAN.md §12 and on
       * `PermissionsWriteService`. Binding the delegate here is the app's half
       * of it: the module still opens no connection.
       */
      permSubscription: prisma.permSubscription,
      // A plan is the entitlement counterpart of a role: the definition, its
      // feature rows and its caps, all replaced wholesale on every save.
      permPlan: prisma.permPlan,
      permPlanFeature: prisma.permPlanFeature,
      permPlanLimit: prisma.permPlanLimit,
      permRole: prisma.permRole,
      // Role definitions are written now, not only read: see the roles admin
      // screens. The feature rows are replaced wholesale on every save.
      permRoleFeature: prisma.permRoleFeature,
      // The role editor's caps — see PLAN §12.27. Before 2026-09-11 only the
      // seeder wrote this table.
      permRoleLimit: prisma.permRoleLimit,
      permMembershipRole: prisma.permMembershipRole,
      permWorkspaceMemberRole: prisma.permWorkspaceMemberRole,
      /*
       * Invitations: created, revoked and accepted, never deleted. The delegate
       * the module declares has no `delete` on it at all, which is the rule
       * expressed as a type rather than as a comment — a revoked invitation is
       * the record of somebody having been asked and the asking undone.
       */
      permInvitation: prisma.permInvitation,
    }),
};

/** Reads need no adapter here either — the delegates fit outright. */
export const chatPrismaProvider: Provider = {
  provide: CHAT_PRISMA,
  useExisting: PrismaService,
};

export const chatWritePrismaProvider: Provider = {
  provide: CHAT_PRISMA_WRITE,
  inject: [PrismaService],
  useFactory: (prisma: PrismaService): ChatWriteClient =>
    withTransaction<ChatTransaction, ChatWriteClient>(prisma, {
      chatConversation: prisma.chatConversation,
      chatParticipant: prisma.chatParticipant,
      chatMessage: prisma.chatMessage,
      /*
       * Blocking is written by the person doing it and never by an
       * administrator: §12.42 leaves the platform with no remedy of its own, so
       * this table is the only one users maintain directly.
       */
      chatBlock: prisma.chatBlock,
      /*
       * ⚠ Written by the person it describes and by nobody else. Availability
       * is DECLARED — the durable half of a feature whose other half never
       * touches a database at all.
       */
      chatAvailability: prisma.chatAvailability,
    }),
};

/** Reads need no adapter — the delegates fit outright. */
export const queuePrismaProvider: Provider = {
  provide: QUEUE_PRISMA,
  useExisting: PrismaService,
};

export const queueWritePrismaProvider: Provider = {
  provide: QUEUE_PRISMA_WRITE,
  inject: [PrismaService],
  useFactory: (prisma: PrismaService): QueueWriteClient =>
    withTransaction<QueueTransaction, QueueWriteClient>(prisma, {
      queueSettings: prisma.queueSettings,
      queueLine: prisma.queueLine,
      queueWindow: prisma.queueWindow,
      queueWindowLine: prisma.queueWindowLine,
      queueSeat: prisma.queueSeat,
      queueSession: prisma.queueSession,
      queueDisplayPass: prisma.queueDisplayPass,
      /*
       * ⚠ The allocator's compare-and-set runs against this delegate, inside the
       * transaction `withTransaction` dispatches. Reads bound to the read client
       * must never be used to allocate.
       */
      queueSequence: prisma.queueSequence,
      queueTicket: prisma.queueTicket,
      queueStaffNickname: prisma.queueStaffNickname,
    }),
};

export type { ChatPrismaClient, PermissionsPrismaClient };
