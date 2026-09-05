import type { FeatureKey, FeatureSpec } from '../types.js';

/**
 * Turning the registry's BINDINGS into enforcement.
 *
 * A binding names the concrete place a key is checked —
 * `GET /permissions/features`, `Query.permissionFeatures`. Until now that was a
 * claim nobody verified, and one of them was false: `features:read` named the
 * GraphQL query while the query had no guard at all, so the UI hid the page and
 * the API handed over the data anyway.
 *
 * Two ways to stop that recurring. Check the claims in CI — which
 * `surface-coverage.test.ts` does — or make the claim itself the enforcement, so
 * there is nothing to drift. This is the second: `FeatureGuard` consults the
 * index below for any handler that declares no `@RequireFeature`, and a binding
 * therefore guards its own surface by existing.
 *
 * `@RequireFeature` still wins where present. It is more specific — it can
 * demand several keys, or `anyOf` — and a decorator on the handler is what a
 * reader looks at first.
 *
 * ## What this does NOT change
 *
 * Enforcement stays opt-in for surfaces nobody declared. A handler with no
 * decorator and no binding still passes through untouched, which is the
 * documented behaviour (§4.7) and why sign-in and health checks need no
 * annotation. This narrows the gap between "declared" and "enforced"; it does
 * not close the one between "unguarded" and "deliberately public".
 */

/**
 * Identifier → the keys required to reach it, plus the parameterised entries
 * kept separately.
 *
 * Two collections rather than one because of where the cost falls: the guard
 * consults this for EVERY handler that declares no `@RequireFeature`, which is
 * almost all of them. An exact hit is one Map lookup; a miss would otherwise
 * scan every binding to see whether a `:param` one matches. Splitting them
 * means a miss scans only the parameterised entries — of which there are
 * currently none, so the common path is a single lookup and nothing else.
 */
export interface BindingIndex {
  readonly exact: ReadonlyMap<string, readonly FeatureKey[]>;
  readonly parameterised: readonly { method: string; segments: readonly string[]; keys: readonly FeatureKey[] }[];
  readonly size: number;
}

/**
 * Only the API surfaces. `ui_route` and `ui_component` bindings are enforced by
 * the frontend and are meaningless to a request — including them would have the
 * guard match a path that looks like a page and refuse it for the wrong reason.
 */
const ENFORCEABLE = new Set(['rest_endpoint', 'graphql_operation', 'graphql_subscription']);

export function buildBindingIndex(registry: readonly FeatureSpec[]): BindingIndex {
  const exact = new Map<string, FeatureKey[]>();

  for (const spec of registry) {
    for (const binding of spec.bindings ?? []) {
      if (!ENFORCEABLE.has(binding.surface)) continue;
      const identifier = binding.identifier.trim();
      /*
       * Several keys on one surface means ALL of them are required, matching
       * `@RequireFeature`'s default mode. Two keys guarding one endpoint is
       * unusual and probably a mistake, but silently honouring only the first
       * would be the wrong way to find that out.
       */
      const existing = exact.get(identifier);
      if (existing) existing.push(spec.key);
      else exact.set(identifier, [spec.key]);
    }
  }

  const parameterised = [...exact.entries()]
    .map(([identifier, keys]) => {
      const [method, path] = splitIdentifier(identifier);
      return path?.includes(':') ? { method, segments: path.split('/'), keys } : undefined;
    })
    .filter((entry): entry is { method: string; segments: string[]; keys: FeatureKey[] } => entry !== undefined);

  return { exact, parameterised, size: exact.size };
}

/**
 * `GET /permissions/features` from a request, with the app's API prefix removed.
 *
 * The prefix is stripped because a binding describes the route as the MODULE
 * declares it — `@Controller('permissions')` plus `@Get('features')` — while the
 * request carries wherever the app happened to mount it. Writing the prefix into
 * the registry would make the same module's bindings wrong in the next app.
 */
export function restIdentifier(method: string, path: string, apiPrefix?: string): string {
  // Query string and trailing slash are not part of the route's identity.
  let route = path.split('?')[0] ?? '';
  if (apiPrefix) {
    const prefix = `/${apiPrefix.replace(/^\/|\/$/g, '')}`;
    if (route === prefix || route.startsWith(`${prefix}/`)) route = route.slice(prefix.length);
  }
  route = route.replace(/\/+$/, '') || '/';
  return `${method.toUpperCase()} ${route.startsWith('/') ? route : `/${route}`}`;
}

/** `Query.permissionFeatures`, `Mutation.assignRole`. */
export function graphqlIdentifier(parentType: string, fieldName: string): string {
  return `${parentType}.${fieldName}`;
}

/**
 * The keys bound to one surface, or undefined when nothing is.
 *
 * Undefined and empty are deliberately different: undefined means "no binding
 * declared, let it through", which is opt-in enforcement working as documented.
 */
export function featuresForSurface(index: BindingIndex, identifier: string): readonly FeatureKey[] | undefined {
  // The common path, and for a GraphQL identifier the only one.
  const direct = index.exact.get(identifier);
  if (direct) return direct;
  if (index.parameterised.length === 0) return undefined;

  /*
   * A parameterised binding — `GET /organizations/:id/members` — matched
   * segment by segment. Literal segments must match exactly; a `:name` segment
   * matches one non-empty segment and nothing more, so a binding cannot
   * accidentally swallow a deeper path and guard a route it never named.
   */
  const [method, path] = splitIdentifier(identifier);
  if (!path) return undefined;
  const segments = path.split('/');

  for (const candidate of index.parameterised) {
    if (candidate.method !== method) continue;
    if (segmentsMatch(candidate.segments, segments)) return candidate.keys;
  }
  return undefined;
}

/** 'GET /a/b' -> ['GET', '/a/b']; 'Query.x' -> ['Query.x', undefined]. */
function splitIdentifier(identifier: string): [string, string | undefined] {
  const space = identifier.indexOf(' ');
  return space === -1 ? [identifier, undefined] : [identifier.slice(0, space), identifier.slice(space + 1)];
}

function segmentsMatch(want: readonly string[], got: readonly string[]): boolean {
  if (want.length !== got.length) return false;

  return want.every((segment, index) => {
    const value = got[index];
    if (value === undefined) return false;
    if (segment.startsWith(':')) return value.length > 0;
    return segment === value;
  });
}
