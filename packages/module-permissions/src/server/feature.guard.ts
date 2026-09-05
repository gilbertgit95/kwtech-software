import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { canAccessWorkspace, denialReason, hasAllFeatures, hasAnyFeature } from '../check.js';
import { FEATURE_REGISTRY } from '../feature-keys.js';
import { parseScope, type RequestScope } from '../scope.js';
import type { DenialReason, FeatureKey, PermissionContext } from '../types.js';
import {
  type BindingIndex,
  buildBindingIndex,
  featuresForSurface,
  graphqlIdentifier,
  restIdentifier,
} from './binding-index.js';
import type { PermissionsModuleOptions } from './permissions.module.js';
import { PermissionsService } from './permissions.service.js';
// The VALUE comes from the leaf module; the interface is type-only and erased,
// so importing it from permissions.module.js closes no cycle at runtime.
import { PERMISSIONS_OPTIONS } from './permissions.tokens.js';
import { type FeatureMode, REQUIRED_FEATURES, REQUIRED_FEATURES_MODE } from './require-feature.decorator.js';
import { REQUIRED_SCOPE, type ScopeSpec } from './require-scope.decorator.js';

type ResolveOutcome = { kind: 'ok'; context: PermissionContext } | { kind: 'unauthenticated' } | { kind: 'no_access' };

/** Where the guard stashes the resolved context, so handlers can read it without a second query. */
export const PERMISSION_CONTEXT_KEY = 'kwtechPermissions';

/**
 * Enforces @RequireFeature.
 *
 * ENFORCEMENT IS OPT-IN. A handler that declares no feature passes through
 * untouched — no context is loaded, no query is made, nothing is checked. That
 * is deliberate: the vast majority of surfaces are not access-controlled
 * (sign-in, health checks, public listings), and a registry that had to name
 * every one of them would be mostly noise, which is how the entries that matter
 * stop being read.
 *
 * Authentication is a separate guard's job. This one answers only "is the
 * authenticated caller entitled to THIS", and only where a key says to ask.
 *
 * The cost of opt-in, stated plainly: an endpoint that SHOULD be guarded and is
 * not looks exactly like one that is deliberately public. Nothing here can tell
 * them apart — see docs/PLAN.md §12.15.
 *
 * ── bindings enforce themselves ────────────────────────────────────────────
 *
 * A handler with no `@RequireFeature` is checked against the registry's own
 * BINDINGS before being let through. `features:read` declares
 * `graphql_operation: 'Query.permissionFeatures'`, so that query is guarded by
 * the declaration existing — no decorator required, and no way for the binding
 * to claim enforcement it does not have. That exact drift is what happened:
 * the binding named the query while the query had no guard.
 *
 * The decorator still wins where present. It is more specific — several keys,
 * or `anyOf` — and it is what a reader looking at the handler sees first.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PERMISSIONS_OPTIONS) private readonly options: PermissionsModuleOptions,
    private readonly permissions: PermissionsService,
  ) {}

  /** Built once per process: the registry is a compile-time constant. */
  private static readonly bindings: BindingIndex = buildBindingIndex(FEATURE_REGISTRY);

  private boundFeatures(context: ExecutionContext): readonly FeatureKey[] | undefined {
    // Off by default? No — a declared binding that does not enforce is the bug
    // this closes. `enforceBindings: false` exists for an app that guards its
    // own surfaces some other way and wants the registry purely descriptive.
    if (this.options.enforceBindings === false) return undefined;
    return boundFeaturesFor(context, FeatureGuard.bindings, this.options.apiPrefix, this.options.getRequest);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // `declaredFeatures`, not `declared` — the scope spec below already owns
    // that name in this method.
    const declaredFeatures = this.reflector.getAllAndOverride<FeatureKey[] | undefined>(REQUIRED_FEATURES, [
      context.getHandler(),
      context.getClass(),
    ]);

    /*
     * Decorator first, registry second. Falling back only when nothing is
     * declared keeps `@RequireFeature` authoritative — a handler that names its
     * own keys is never silently widened or narrowed by a binding elsewhere.
     */
    const required = declaredFeatures?.length ? declaredFeatures : this.boundFeatures(context);
    if (!required || required.length === 0) return true;

    const mode =
      this.reflector.getAllAndOverride<FeatureMode | undefined>(REQUIRED_FEATURES_MODE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'all';

    const request = this.options.getRequest ? this.options.getRequest(context) : context.switchToHttp().getRequest();

    const declared = this.reflector.getAllAndOverride<ScopeSpec | undefined>(REQUIRED_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const scope = this.resolveScope(context, request, declared);

    // A handler mounted one level away from where it thinks it is still resolves
    // a perfectly valid-looking context — for the wrong organization. That is a
    // silent under-check, so a declared level that disagrees with the resolved
    // one is a misconfiguration and fails loudly.
    if (declared && declared.level !== scope.level) {
      throw new ForbiddenException(
        `Handler declares ${declared.level} scope but the request resolved as ${scope.level}`,
      );
    }

    const outcome = await this.resolve(request, scope);

    // 401 and 403 are different answers to different questions. "Who are you"
    // failing is not "you may not": a frontend reads the first as "sign in" and
    // the second as "stop asking", and conflating them sends signed-out users to
    // a dead end.
    if (outcome.kind === 'unauthenticated') throw new UnauthorizedException('Not signed in');
    if (outcome.kind === 'no_access') {
      throw new ForbiddenException({ message: 'No permission context for this scope', reason: 'no_context' });
    }
    const permissions = outcome.context;

    // Whether the caller may BE here, asked before whether they may act here.
    // Without it, workspace membership restricts nothing server-side: every
    // organization-level feature applies in every workspace of that
    // organization, including ones the caller was never added to.
    if (scope.level === 'workspace' && scope.workspaceId && !canAccessWorkspace(permissions, scope.workspaceId)) {
      throw new ForbiddenException({
        message: 'No access to this workspace',
        reason: 'no_workspace_access' satisfies DenialReason,
      });
    }

    const allowed = mode === 'any' ? hasAnyFeature(permissions, required) : hasAllFeatures(permissions, required);
    if (allowed) return true;

    // The reason is carried because the two denials need different advice:
    // 'not_entitled' means the organization has not bought it, and telling that
    // caller to ask an administrator sends them down a dead end.
    const reason = denialReason(permissions, required);
    throw new ForbiddenException({
      message: `Requires ${mode === 'any' ? 'any of' : 'all of'}: ${required.join(', ')}`,
      reason,
    });
  }

  /**
   * Where the request is, as opposed to who is making it.
   *
   * Order: an explicit override, then a resolver's declared arguments, then the
   * path convention (scope.ts). REST needs no declaration — the ids are already
   * in the URL.
   */
  private resolveScope(context: ExecutionContext, request: unknown, declared?: ScopeSpec): RequestScope {
    const override = this.options.resolveScope?.(context, request);
    if (override) return override;

    if (declared && this.options.getArgs) {
      const args = this.options.getArgs(context) ?? {};
      const organizationId = (args[declared.organizationIdArg ?? 'organizationId'] as string | undefined) ?? null;
      const workspaceId = (args[declared.workspaceIdArg ?? 'workspaceId'] as string | undefined) ?? null;
      if (organizationId || workspaceId) {
        return {
          level: workspaceId ? 'workspace' : 'organization',
          organizationId,
          workspaceId,
        };
      }
    }

    const url =
      (request as { originalUrl?: string; url?: string } | undefined)?.originalUrl ??
      (request as { url?: string } | undefined)?.url ??
      '';
    return parseScope(url, this.options.apiPrefix ? { apiPrefix: this.options.apiPrefix } : {});
  }

  private async resolve(request: unknown, scope: RequestScope): Promise<ResolveOutcome> {
    const bag = request as Record<string, unknown> | undefined;

    // Memoised per request AND per scope. Two guarded resolvers in one GraphQL
    // operation would otherwise mean two identical grant queries — and a deep
    // query many more — but a cache keyed on the request alone would serve a
    // workspace-scoped answer to an organization-scoped field in the same
    // operation, which is the dangerous direction.
    const cached = bag?.[PERMISSION_CONTEXT_KEY] as PermissionContext | undefined;
    if (cached && cached.organizationId === scope.organizationId && cached.workspaceId === scope.workspaceId) {
      return { kind: 'ok', context: cached };
    }

    let resolved: PermissionContext | undefined;
    if (this.options.resolveContext) {
      resolved = await this.options.resolveContext(request);
      if (!resolved) return { kind: 'unauthenticated' };
    } else if (this.options.resolvePrincipal) {
      const principal = this.options.resolvePrincipal(request);
      if (!principal) return { kind: 'unauthenticated' };

      // The principal says who; the scope says where. An explicit override on
      // the principal still wins, for the rare handler that acts outside its
      // own URL.
      resolved =
        (await this.permissions.loadContext(principal.userId, {
          organizationId: principal.organizationId ?? scope.organizationId ?? undefined,
          workspaceId: principal.workspaceId ?? scope.workspaceId,
        })) ?? undefined;
    } else {
      // Neither wiring supplied: the module cannot invent where the caller comes
      // from, and silently allowing or denying would both be wrong.
      throw new Error('PermissionsModule.forRoot requires resolvePrincipal or resolveContext');
    }

    // A principal with no context is authenticated but has no standing in this
    // scope — not a member, or the workspace does not belong to the organization
    // in the path.
    if (!resolved) return { kind: 'no_access' };

    if (bag) bag[PERMISSION_CONTEXT_KEY] = resolved;
    return { kind: 'ok', context: resolved };
  }
}

/**
 * The registry keys bound to whatever surface this request is, or undefined.
 *
 * Reads the transport STRUCTURALLY rather than importing `@nestjs/graphql`.
 * That package is an optional peer here, and a guard that imported it would
 * make every REST-only consumer install a GraphQL library to answer questions
 * about REST.
 */
export function boundFeaturesFor(
  context: ExecutionContext,
  index: BindingIndex,
  apiPrefix: string | undefined,
  getRequest?: (context: unknown) => unknown,
): readonly FeatureKey[] | undefined {
  if (context.getType<'graphql'>() === 'graphql') {
    /*
     * Nest hands a resolver (root, args, context, info); `info` carries the
     * schema-level names, which is what a binding names — the RESOLVER METHOD is
     * called `features` while the query is `permissionFeatures`, and binding to
     * the method name would tie the registry to an implementation detail.
     */
    const info = context.getArgs()[3] as { fieldName?: string; parentType?: { name?: string } } | undefined;
    const parent = info?.parentType?.name;
    const field = info?.fieldName;
    if (!parent || !field) return undefined;
    return featuresForSurface(index, graphqlIdentifier(parent, field));
  }

  const request = (getRequest ? getRequest(context) : context.switchToHttp().getRequest()) as
    | { method?: string; url?: string; originalUrl?: string; path?: string }
    | undefined;

  const method = request?.method;
  // `originalUrl` before `url`: Express rewrites `url` when a router is mounted
  // under a prefix, so `url` can be the path MINUS a prefix that was never in
  // the binding — matching on it would silently guard the wrong route.
  const path = request?.originalUrl ?? request?.url ?? request?.path;
  if (!method || !path) return undefined;

  return featuresForSurface(index, restIdentifier(method, path, apiPrefix));
}
