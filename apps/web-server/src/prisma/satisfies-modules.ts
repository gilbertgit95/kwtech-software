import type { AuthTransaction } from '@kwtech/module-auth/server';
import type { PermissionsPrismaClient, PermissionsTransaction } from '@kwtech/module-permissions/server';
import type { PrismaService } from './prisma.service.js';

/**
 * Proof, at compile time, that this app's client actually fits the modules it
 * is bound to.
 *
 * `{ provide: AUTH_PRISMA, useExisting: PrismaService }` is typed as `Provider`
 * — a token and a class, with no relationship between them that TypeScript
 * checks. So the property the entire database-agnostic design rests on, that
 * PrismaService structurally satisfies each module's narrow interface, was
 * being taken on trust in the one place it matters.
 *
 * Now a module adding a field to its client interface, or a schema change that
 * renames a model, breaks THIS file at build time — with a message naming the
 * missing method — instead of throwing on the first request that reaches it.
 *
 * Nothing imports this; it exists to be typechecked. That is why it declares
 * types and no values.
 */

declare const client: PrismaService;

/**
 * The read client, bound with `useExisting`, must fit outright.
 */
export const _permissionsReadClientFits: PermissionsPrismaClient = client;

/**
 * For the two modules that write, what has to hold is that every DELEGATE fits
 * — which is what `Tx` is: the client minus `$transaction`. ./module-clients.ts
 * supplies the dispatcher itself, so asserting the whole interface here would
 * be asserting something the app deliberately does not use.
 *
 * These are the assertions that actually catch drift: a module adding a method
 * to its client interface, or a schema change renaming a model, breaks this
 * file at build time with a message naming the missing delegate, instead of
 * throwing on the first request that reaches it.
 */
export const _authDelegatesFit: AuthTransaction = client;
export const _permissionsWriteDelegatesFit: PermissionsTransaction = client;
