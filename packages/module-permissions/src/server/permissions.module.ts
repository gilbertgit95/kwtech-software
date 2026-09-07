import { type DynamicModule, Module, type ModuleMetadata, type Provider } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestScope } from '../scope.js';
import type { FeatureSpec, PermissionContext } from '../types.js';
import { FeatureGuard } from './feature.guard.js';
import { PermissionsResolver } from './graphql/permissions.resolver.js';
import { PermissionsController } from './permissions.controller.js';
import { PERMISSIONS_PRISMA_WRITE } from './permissions.repository.js';
import { PermissionsService } from './permissions.service.js';
import { PERMISSIONS_OPTIONS } from './permissions.tokens.js';
import { PermissionsWriteService } from './permissions-write.service.js';

/*
 * Re-exported, not declared. It lives in ./permissions.tokens.ts — a file that
 * imports nothing — because every provider this module registers needs it, and
 * importing it back from here closes a cycle that leaves the token `undefined`
 * inside a decorator. See that file for the boot error it produces.
 *
 * The re-export keeps `import { PERMISSIONS_OPTIONS } from '.../permissions.module.js'`
 * working for anything outside the cycle.
 */
export { PERMISSIONS_OPTIONS } from './permissions.tokens.js';

export interface PermissionsModuleOptions {
  /** Modules exporting whatever `prismaProvider` depends on — usually the app's DB module. */
  imports?: ModuleMetadata['imports'];

  /**
   * Binds the app's Prisma client to PERMISSIONS_PRISMA. One line in practice:
   *   { provide: PERMISSIONS_PRISMA, useExisting: PrismaService }
   */
  prismaProvider?: Provider;

  /**
   * Binds a WRITE-capable client, enabling PermissionsWriteService:
   *   { provide: PERMISSIONS_PRISMA_WRITE, useExisting: PrismaService }
   *
   * Separate from prismaProvider on purpose. An app that only answers
   * permission questions — a worker, a read replica, an app administering
   * grants elsewhere — should not acquire a write path by having wired reads,
   * and granting one should be a visible line in its wiring. Omitted, the
   * service is still injectable and refuses on first use with an error naming
   * this option, rather than failing to resolve at boot.
   */
  prismaWriteProvider?: Provider;

  /**
   * The preferred wiring: say only who is calling and in which organization,
   * and the module loads memberships, roles and the active plan itself. This is
   * the point of the module — the app does not query perm_* tables, know the
   * join path to a subscription, or reimplement role composition.
   *
   * organizationId matters as soon as a user can belong to more than one:
   * omitting it means "whichever membership comes back first", which is not a
   * decision anyone intends. Read it from the active-org header, subdomain or
   * session — wherever the app decided it lives.
   */
  resolvePrincipal?: (
    request: unknown,
  ) => { userId: string; organizationId?: string; workspaceId?: string | null } | undefined;

  /**
   * Escape hatch for apps that already carry grants on the request (a JWT claim
   * with the key list baked in). Takes precedence over resolvePrincipal and
   * skips the database entirely.
   */
  resolveContext?: (request: unknown) => PermissionContext | undefined | Promise<PermissionContext | undefined>;

  /**
   * Binds a pub/sub engine to PERMISSIONS_PUBSUB, enabling this module's
   * GraphQL subscriptions:
   *   { provide: PERMISSIONS_PUBSUB, useValue: new PubSub() }
   *
   * Optional, and omitting it is a normal configuration rather than a mistake:
   * a worker or a CLI importing the module for its services has no socket and
   * nobody to notify. Without it, publishing is a no-op and subscribing yields
   * a stream that ends immediately — see NULL_PUBSUB.
   *
   * The module never picks an engine. `graphql-subscriptions`' in-memory
   * `PubSub` serves one API instance; past a single replica the host swaps in
   * `graphql-redis-subscriptions` and nothing here changes (PLAN §7).
   */
  pubsubProvider?: Provider;

  /**
   * Which transports the module publishes. Both default to on: importing the
   * module is meant to BE the registration — REST routes appear in the app and
   * in openapi.json, resolvers join the composed GraphQL schema, and the app
   * writes no glue.
   *
   * Turn one off for an app that has no such transport (a worker importing the
   * module for `PermissionsService` alone wants neither).
   */
  expose?: { rest?: boolean; graphql?: boolean };

  /**
   * Stripped before the scope is parsed from a request path. '/api/v1' for the
   * convention in scope.ts.
   */
  apiPrefix?: string;
  /**
   * Whether a registry BINDING guards its own surface.
   *
   * On by default. `features:read` declaring
   * `graphql_operation: 'Query.permissionFeatures'` is a claim that the query is
   * checked; honouring it here is what makes the claim true rather than
   * documentation somebody has to keep in step. `@RequireFeature` still wins
   * wherever it is present.
   *
   * Set false for an app that guards its own surfaces another way and wants the
   * registry to stay purely descriptive. Nothing else changes: a handler with
   * neither a decorator nor a binding passes through either way, which is the
   * opt-in behaviour §4.7 documents.
   */
  enforceBindings?: boolean;

  /**
   * EVERY module's features, composed by the app.
   *
   * Defaults to this module's own registry, which is correct for an app that
   * mounts only this module and wrong the moment it mounts a second one.
   *
   * ## Why the app has to supply it
   *
   * A role may grant any registered feature, whoever declared it — but no
   * module may import another (PLAN §9), so `module-permissions` cannot see
   * `module-auth`'s keys, or a third module's. Validating a role against its
   * own registry alone quietly means "permissions is the only module allowed to
   * declare rights", which is the exact bug `seed/registry.ts` was written to
   * fix on the seeding side. It reappeared here: cloning a role that held
   * `account:profile_write` reported it as "not in the registry" and dropped
   * it, while the key sat in `perm_feature`, undeprecated, held by two roles.
   *
   * The app composes both lists already — pass the same `ALL_FEATURES` here and
   * the seeder and the write path agree by construction rather than by luck.
   */
  featureRegistry?: readonly FeatureSpec[];

  /**
   * How an invitation link REACHES the person invited.
   *
   * The module mints the token, stores only its hash, and hands the raw value
   * to this function exactly once — the same contract `module-auth` uses for
   * `sendPasswordResetEmail`, and for the same reason: delivery is the app's.
   * This package has no email transport and should not acquire one. It also
   * does not know the URL an invitation link should point at, which is a route
   * in the frontend the app owns.
   *
   * ⚠ `token` is a working credential. Do not log it, and do not put it
   * anywhere an access log will see it.
   *
   * WITHOUT this hook `inviteMember` REFUSES, before writing anything. The
   * alternative — creating the row and dropping the token — produces an
   * invitation nobody can ever accept, which looks like success on the screen
   * that made it and like a broken product to the person waiting for an email.
   */
  sendInvitationEmail?: (invitation: {
    /** Normalised, exactly as stored. */
    email: string;
    /** The raw token. Handed over ONCE — see above. */
    token: string;
    organization: { id: string; key: string; name: string };
    invitedByUserId: string;
    expiresAt: Date;
  }) => void | Promise<void>;

  /**
   * Reads a handler's arguments, for resolvers declaring @RequireScope. A
   * GraphQL app passes `(ctx) => GqlExecutionContext.create(ctx).getArgs()`,
   * which keeps the @nestjs/graphql import in the app that already has it.
   */
  getArgs?: (context: unknown) => Record<string, unknown> | undefined;

  /**
   * Last-resort override for a transport that is neither HTTP nor GraphQL.
   * Takes precedence over both the argument reader and path parsing.
   */
  resolveScope?: (context: unknown, request: unknown) => RequestScope | undefined;

  /**
   * Pulls the request out of an ExecutionContext. Only needed for non-HTTP
   * transports: a GraphQL app passes
   * `(ctx) => GqlExecutionContext.create(ctx).getContext().req`, keeping the
   * @nestjs/graphql import in the app that already depends on it.
   */
  getRequest?: (context: unknown) => unknown;
}

/**
 * Wire once per server app:
 *
 *   PermissionsModule.forRoot({
 *     imports: [DbModule],
 *     prismaProvider: { provide: PERMISSIONS_PRISMA, useExisting: PrismaService },
 *     resolvePrincipal: (req) => {
 *       const r = req as { user?: { id: string }; orgId?: string; workspaceId?: string };
 *       return r.user ? { userId: r.user.id, organizationId: r.orgId, workspaceId: r.workspaceId } : undefined;
 *     },
 *   })
 *
 * then apply FeatureGuard globally, or per-controller with @UseGuards.
 */
@Module({})
export class PermissionsModule {
  static forRoot(options: PermissionsModuleOptions): DynamicModule {
    const exposeRest = options.expose?.rest ?? true;
    const exposeGraphql = options.expose?.graphql ?? true;

    const providers: Provider[] = [
      { provide: PERMISSIONS_OPTIONS, useValue: options },
      // See the note in @kwtech/module-auth's AuthModule: Reflector is auto-
      // provided in the ROOT injector only, and FeatureGuard reads every
      // @RequireFeature / @RequireScope through it. Without this the app cannot
      // construct the guard at boot.
      Reflector,
      PermissionsService,
      PermissionsWriteService,
      FeatureGuard,
    ];
    if (options.pubsubProvider) providers.push(options.pubsubProvider);
    if (options.prismaProvider) providers.push(options.prismaProvider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider);
    else providers.push({ provide: PERMISSIONS_PRISMA_WRITE, useValue: undefined });
    // A resolver is just a provider: listing it here is what puts the module's
    // queries into the app's code-first schema. Nothing to stitch.
    if (exposeGraphql) providers.push(PermissionsResolver);

    return {
      module: PermissionsModule,
      imports: options.imports ?? [],
      controllers: exposeRest ? [PermissionsController] : [],
      providers,
      exports: [FeatureGuard, PermissionsService, PermissionsWriteService, PERMISSIONS_OPTIONS],
      global: true,
    };
  }
}
