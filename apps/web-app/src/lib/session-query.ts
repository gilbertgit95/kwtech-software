import type { Viewer } from '@kwtech/module-auth';
import { getSessionToken } from '@kwtech/module-auth/next';
import type { PermissionContext } from '@kwtech/module-permissions';
import { cache } from 'react';

/**
 * Who is signed in and what they hold — in ONE request.
 *
 * ## Why this lives in the app and not in either module
 *
 * It asks for `viewer` and `myPermissions` together, and no module may write
 * that query: `module-auth` and `module-permissions` do not import each other
 * (PLAN §9), so neither can name the other's field. Composing them is exactly
 * what the app is for. Each module still ships its own `/next` helper for an app
 * that wants them separately — this is the composed convenience, not a
 * replacement.
 *
 * ## What it replaces
 *
 * Two sequential REST calls in the shell — `GET /auth/profile` then
 * `GET /permissions/me` — each paying a full round trip before the next could
 * start. One GraphQL operation resolves both fields concurrently on the server.
 *
 * ## Deduplicated per request
 *
 * Wrapped in React's `cache()`, so the shell and the page it wraps share one
 * response instead of asking twice. The cache is per-render, not global — two
 * concurrent requests never see each other's session, which for this data is the
 * only acceptable behaviour.
 *
 * ⚠ `cache()` keys on the ARGUMENTS. Now that this takes a scope, two callers
 * in one render share a response only if they pass the same one — and calling
 * it with no argument where the shell passed a scope would silently make a
 * second request AND resolve at app level, which is the reading that grants a
 * tenant-only member nothing. Both callers in this app derive the scope from
 * the same `parseScope(pathname)`, which is what keeps them in step.
 *
 * ## Three outcomes, not two
 *
 * "Nobody is signed in" and "I could not ask" are different facts, and this
 * used to return the same value for both. The consequence was specific and
 * bad: with the API down, `viewer` came back null, and AppShell's redirect sent
 * a perfectly well signed-in person to /auth/signin — where signing in also
 * failed, because the thing that was down was the thing sign-in needs. Nobody
 * ever saw the status bar, because nobody was ever left in a shell to see it.
 *
 * So `reachable` is carried separately. It is false only when the API could not
 * be reached at all; a 401, an empty body or an absent cookie are all reachable
 * answers meaning "not signed in".
 *
 * ## What it does NOT do
 *
 * It does not sign anyone in. Credential exchange stays on the REST endpoints
 * behind the Next route handler, which is the only thing that can turn a token
 * into an httpOnly cookie — and the only place where per-path rate limiting
 * still works. See AuthResolver for why moving sign-in onto the graph would
 * defeat that limit through field aliasing.
 */

const SESSION_QUERY = `
  query Session($organizationId: String, $workspaceId: String) {
    viewer { id email username displayName }
    session { expiresAt }
    myOrganizations {
      organizationId
      organizationKey
      organizationName
      roleKey
      roleLabel
      roleIcon
      planKey
      planLabel
      planIcon
    }
    myPermissions(organizationId: $organizationId, workspaceId: $workspaceId) {
      subjectId
      organizationId
      workspaceId
      effective
      granted
      entitled
      grantedAtAppLevel
      accessibleWorkspaceIds
      appRoles {
        key
        label
        icon
      }
    }
  }
`;

/** A workspace the viewer may enter, and what they are IN it. */
export interface ViewerWorkspace {
  id: string;
  key: string;
  name: string;
  /**
   * The viewer's WORKSPACE-level role here, or null.
   *
   * Null covers two states the selector does not need to tell apart: a member
   * given nothing yet, and platform support, who may enter every workspace
   * while belonging to none. Both hold no role HERE, which is what the badge
   * reports.
   */
  roleKey: string | null;
  roleLabel: string | null;
  /** Icon NAME, resolved to a component by the app's own set. */
  roleIcon: string | null;
}

/** What the drawer needs about the SELECTED organization. */
export interface NavContext {
  /** Grants at APP level — filters `/admin/*` and this app's own pages. */
  appGranted: readonly string[];
  /** Grants INSIDE the selected organization — filters the tenant section. */
  organizationGranted: readonly string[];
  /**
   * What the selected organization's PLAN includes — the feature keys it bought.
   *
   * Read for the switcher's plan card, which says how much the plan carries
   * rather than only naming it. It rides on `myPermissions`, which is ungated
   * and answers only about the caller, so this needs no key: it is the same
   * fact the guard already acts on for every request this person makes.
   *
   * ⚠ `null` is NOT "none". It means the deployment has no entitlement model at
   * all — an app without subscriptions entitles everything rather than making a
   * special case of itself at every call site — and a card reading "0
   * capabilities" there would be flatly wrong. An organization on no plan
   * produces an empty ARRAY, which is the "entitled to nothing yet" state.
   */
  organizationEntitled: readonly string[] | null;
  /**
   * Grants at the selected WORKSPACE — filters the workspace section.
   *
   * A third reading rather than reusing the organization's, because an
   * organization-scoped context carries no workspace-level grants at all: those
   * hang off a workspace membership, and at organization scope there is no
   * workspace. `workspaces:share` is the only such key today and the workspace
   * section's one route does not need it — but the next page added there will,
   * and filtering it with the organization's grants would hide it from exactly
   * the people who hold it.
   *
   * Empty when no workspace is selected.
   */
  workspaceGranted: readonly string[];
  /**
   * The workspaces of that organization the viewer may ENTER, not every one it
   * has. Membership is required and no role widens it (§12.33), so a picker
   * listing the rest would offer rows the guard refuses on arrival.
   */
  workspaces: ViewerWorkspace[];
}

/** Nothing selected, nothing to offer. Fails closed, like every other null here. */
const EMPTY_NAV: NavContext = {
  appGranted: [],
  organizationGranted: [],
  organizationEntitled: null,
  workspaceGranted: [],
  workspaces: [],
};

/**
 * Everything the DRAWER needs about the selected organization, in one request.
 *
 * ## Why the drawer asks separately from the page
 *
 * Two different questions are answered on the same render, and one context gets
 * one of them wrong:
 *
 *   "May this person open THIS page?"  → the URL's scope. Anything else and
 *      `/admin/roles` would start accepting an ORGANIZATION-level `roles:read`,
 *      because the context would have been resolved inside a tenant. That is
 *      the app-level boundary quietly disappearing.
 *
 *   "What should the drawer offer?"    → BOTH scopes at once. The tenant
 *      section is filtered by grants inside the selected organization; the rest
 *      of the drawer is filtered at app level. `roles:read` and
 *      `subscriptions:read` are organization-level keys that ALSO gate
 *      `/admin/roles` and `/admin/subscriptions`, so filtering everything with
 *      one organization-scoped context offers a tenant admin the platform's
 *      roles screen — and the page then refuses them.
 *
 * ## One request, two scopes, via ALIASES
 *
 * `myPermissions` is asked twice in one operation under different aliases, so
 * both readings arrive together. They resolve independently — the guard's
 * per-request context cache is keyed on scope precisely so a workspace-scoped
 * answer is never served to an organization-scoped field in the same operation.
 *
 * ⚠ The result must NOT be given to `<PermissionsProvider>`. Every
 * `<FeatureGate>` in the page below reads that, and a gate evaluating against a
 * tenant while the page is an admin screen would show controls the API refuses.
 * The provider keeps the page's own context; this feeds `buildNav` and stops.
 *
 * Called only when an organization is selected, and fails closed to empty.
 */
export const getNavContext = cache(async (organizationId: string, workspaceId: string | null): Promise<NavContext> => {
  const token = await getSessionToken();
  if (!token) return EMPTY_NAV;

  const apiUrl = process.env.API_URL ?? 'http://localhost:8080/api/v1';
  try {
    const response = await fetch(`${apiUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: `query NavContext($organizationId: String!, $workspaceId: String) {
          app: myPermissions { granted }
          organization: myPermissions(organizationId: $organizationId) { granted entitled }
          workspace: myPermissions(organizationId: $organizationId, workspaceId: $workspaceId) { granted }
          workspaces: myWorkspaces(organizationId: $organizationId) { id key name roleKey roleLabel roleIcon }
        }`,
        /*
         * The workspace id is the RAW remembered value, passed before it has
         * been validated — validating it needs the `workspaces` list this same
         * request returns, so asking first would be circular.
         *
         * Safe for the reason `myPermissions(organizationId:)` is: `loadContext`
         * resolves the (user, organization, workspace) triple and returns null
         * for one the caller has no standing in, so a stale or forged id yields
         * an empty grant list rather than anything about that workspace. The id
         * is checked against `workspaces` afterwards anyway, and a miss means
         * the section is not rendered at all.
         */
        variables: { organizationId, workspaceId },
      }),
      cache: 'no-store',
    });
    if (!response.ok) return EMPTY_NAV;

    const body = (await response.json()) as {
      data?: {
        app: { granted: string[] } | null;
        organization: { granted: string[]; entitled: string[] | null } | null;
        workspace: { granted: string[] } | null;
        workspaces: ViewerWorkspace[] | null;
      };
    };

    return {
      appGranted: body.data?.app?.granted ?? [],
      organizationGranted: body.data?.organization?.granted ?? [],
      /*
       * `?? null` and NOT `?? []`: the two mean opposite things here — see
       * `organizationEntitled`. An unresolved context is the no-model reading,
       * which claims nothing, rather than "this plan includes nothing".
       */
      organizationEntitled: body.data?.organization?.entitled ?? null,
      workspaceGranted: body.data?.workspace?.granted ?? [],
      workspaces: body.data?.workspaces ?? [],
    };
  } catch {
    return EMPTY_NAV;
  }
});

/**
 * The identity of ONE organization — id, key, name — and nothing else.
 *
 * ## Why it exists at all
 *
 * The drawer's switcher names the selected organization by finding it in the
 * viewer's OWN list, which is right for everybody who is a member of it. It is
 * wrong for the one case that matters here: platform staff drilling into a
 * customer from `/admin/organizations`. The URL names that tenant, the drawer's
 * Organization section renders (their app-level grants resolve there), and the
 * switcher above it fell back to the product name — so the header said one
 * thing and the page said another.
 *
 * ## Called only when the organization is NOT one of the viewer's own
 *
 * Which is the rare path. `myOrganization` is the tenant DETAIL query and loads
 * members, workspaces and invitations to answer with three columns, so running
 * it on every render for everybody would be a real cost for no gain — the name
 * is already in hand for a member.
 *
 * A dedicated lightweight query would be the tidier answer and is deliberately
 * NOT what this does: the module reaches Postgres through a hand-written
 * structural interface where a second `permOrganization.findFirst` shape means
 * declaring an OVERLOAD, which a generated Prisma client cannot satisfy. See
 * the note on `permWorkspace` in permissions.repository.ts — the same wall that
 * sent `listWorkspaceDetail` through `listOrganizationDetail`.
 *
 * Null when the caller has no standing there, which is the honest answer: the
 * switcher then falls back to the product name, and the page refuses them too.
 */
export const getOrganizationIdentity = cache(
  async (organizationId: string): Promise<{ id: string; key: string; name: string } | null> => {
    const token = await getSessionToken();
    if (!token) return null;

    const apiUrl = process.env.API_URL ?? 'http://localhost:8080/api/v1';
    try {
      const response = await fetch(`${apiUrl}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          query: `query OrganizationIdentity($organizationId: String!) {
            myOrganization(organizationId: $organizationId) { id key name }
          }`,
          variables: { organizationId },
        }),
        cache: 'no-store',
      });
      if (!response.ok) return null;

      const body = (await response.json()) as {
        data?: { myOrganization: { id: string; key: string; name: string } | null };
      };
      return body.data?.myOrganization ?? null;
    } catch {
      return null;
    }
  },
);

/** The plan the SELECTED organization is on, for the switcher's mark. */
export interface OrganizationPlan {
  planKey: string;
  planLabel: string;
  /** Icon NAME, resolved to a component by the app's own set. Null for a plan that chose none. */
  planIcon: string | null;
}

/**
 * The organization-wide plan, in a request of its OWN — and the separate
 * request is the whole point rather than an oversight.
 *
 * ## Why it is not a field on the NavContext query
 *
 * It was going to be, until the schema said otherwise:
 *
 *     myOrganizationSubscriptions(organizationId: String!): [PermissionSubscription!]!
 *
 * Non-null, and guarded by `subscriptions:read` — a DIFFERENT key from any that
 * opens the drawer. A member who may be in the organization and may not see
 * what it bought is an ordinary configuration, and for them the guard throws;
 * GraphQL then nulls the field, and a null on a non-null field PROPAGATES to
 * its parent. The parent is `data`. So adding this to that query would have
 * turned "cannot read the plan" into "the entire drawer is empty", for exactly
 * the people who are least likely to be able to explain why.
 *
 * Here the blast radius is one fetch and the answer is null. The shell runs it
 * CONCURRENTLY with `getNavContext`, so it costs no wall time.
 *
 * ## Null means two different things, and the caller must not merge them
 *
 * "No plan" (an organization starts on none, and that is a normal state) and
 * "you may not see the plan" both arrive as null. The switcher therefore says
 * nothing rather than saying "No plan" at somebody who was refused — a
 * confident wrong answer is worse than a quiet one, which is the same call the
 * organization overview's em dash makes.
 *
 * ## Organization-wide, not per workspace
 *
 * A subscription with a `workspaceId` entitles that workspace alone; the
 * switcher's mark is about the tenant. `status === 'active'` and not archived,
 * matching `organizationWidePlan` on the overview — two readings of "the plan"
 * that disagreed would be visible as an icon contradicting the page under it.
 *
 * ⚠ An `active` row entitles regardless of `currentPeriodEnd` (§12.40), so
 * nothing here compares it to the clock.
 */
export const getOrganizationPlan = cache(async (organizationId: string): Promise<OrganizationPlan | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  const apiUrl = process.env.API_URL ?? 'http://localhost:8080/api/v1';
  try {
    const response = await fetch(`${apiUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: `query OrganizationPlan($organizationId: String!) {
          myOrganizationSubscriptions(organizationId: $organizationId) {
            planKey planLabel planIcon planArchived status workspaceId
          }
        }`,
        variables: { organizationId },
      }),
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      data?: {
        myOrganizationSubscriptions:
          | {
              planKey: string;
              planLabel: string;
              planIcon: string | null;
              planArchived: boolean;
              status: string;
              workspaceId: string | null;
            }[]
          | null;
      };
    };

    const plan = body.data?.myOrganizationSubscriptions?.find(
      (row) => row.workspaceId === null && row.status === 'active' && !row.planArchived,
    );
    return plan ? { planKey: plan.planKey, planLabel: plan.planLabel, planIcon: plan.planIcon } : null;
  } catch {
    return null;
  }
});

/**
 * Where to resolve the viewer's rights — read from the URL by `parseScope`.
 *
 * ## Why the session query gained a scope (PLAN §12.13)
 *
 * A permission context is always per (subject, organization): the same person
 * legitimately holds different rights in two organizations, so a context with
 * no organization is not a smaller one but an ambiguous one. This query used to
 * take none, so every render got the APP-LEVEL reading — and a member whose
 * only role is inside a tenant resolved to nothing at all. Their drawer was
 * empty and every `<FeatureGate>` on a tenant page was closed, on pages the API
 * would have served them.
 *
 * The ids come from the URL, which is the convention `scope.ts` parses and the
 * one the API's guard reads from a resolver's arguments. Not from a header
 * (forgettable, invisible in a bug report), not from a subdomain (a DNS record
 * per tenant), and not from the token — baking the active tenant into a
 * week-long credential would make switching organization need a new sign-in.
 *
 * Passing an organization the viewer has no standing in is SAFE: `loadContext`
 * resolves the (user, organization) pair and returns null for a pair with none,
 * so the answer is "you hold nothing" rather than anything about that tenant.
 */
export interface SessionScope {
  organizationId?: string | null;
  workspaceId?: string | null;
}

/** One organization the viewer belongs to, for the drawer's switcher. */
export interface ViewerOrganization {
  organizationId: string;
  organizationKey: string;
  organizationName: string;
  roleKey: string | null;
  roleLabel: string | null;
  roleIcon: string | null;
  /**
   * The plan THAT organization is on, arriving with the list rather than being
   * asked for per row.
   *
   * Null means "on no plan", where every organization starts — not "may not
   * see". `myOrganizations` is ungated and cannot refuse; the plan's identity
   * rides on it because `myPermissions` already publishes the `entitled` list
   * the plan produces. See the resolver's own note.
   */
  planKey: string | null;
  planLabel: string | null;
  /** Icon NAME, resolved to a component by the app's own set. */
  planIcon: string | null;
}

export interface SessionSnapshot {
  viewer: Viewer | null;
  permissions: PermissionContext | null;
  /**
   * Where the viewer belongs. Empty for somebody who is in no organization,
   * which is a normal state — a platform invitation names no tenant at all.
   *
   * Asked for in the SAME operation as the viewer and the permissions, for the
   * reason those two were merged: the drawer needs it on every render, and a
   * second round trip per navigation for a list that changes when somebody
   * joins a company is a round trip for nothing.
   */
  organizations: ViewerOrganization[];
  /**
   * Whether the API answered at all.
   *
   * Distinct from `viewer` being null, and the distinction is the point: a
   * caller must be able to tell "you are signed out" from "I cannot tell". The
   * first is grounds for a redirect; the second is grounds for a message.
   *
   * True when there is no cookie, because an absent cookie is an answer this
   * app already has — it is not a reason to claim the server is down.
   */
  reachable: boolean;
  /**
   * ISO-8601 access-token expiry, for <SessionKeeper> to schedule against.
   *
   * Converted from the epoch seconds the token carries, because a `Date` is what
   * the browser will do arithmetic on and doing it in one place beats doing it
   * at each call site.
   */
  expiresAt: string | null;
}

/** Signed out, having asked and been told so. */
const SIGNED_OUT: SessionSnapshot = {
  viewer: null,
  permissions: null,
  organizations: [],
  expiresAt: null,
  reachable: true,
};

/** Could not ask. Renders the shell with a status bar rather than a redirect. */
const UNREACHABLE: SessionSnapshot = {
  viewer: null,
  permissions: null,
  organizations: [],
  expiresAt: null,
  reachable: false,
};

/**
 * Null on every failure — no cookie, expired token, API down, malformed body —
 * with `reachable` separating the last two from the first two.
 *
 * **Both nulls FAIL CLOSED at the call site**: a null viewer means signed out, a
 * null permission context means "holds nothing", never "skip the filter". A
 * navigation that failed open would link someone to a page that turns them away,
 * and a permissions service being down is exactly when guessing generously costs
 * most. `reachable: false` does not soften that — it only stops the caller
 * mistaking an outage for a sign-out.
 *
 * A partial answer is honoured rather than discarded: GraphQL returns `data`
 * alongside `errors`, so a failure resolving permissions still yields a viewer,
 * and the shell renders a signed-in user with no privileged navigation — which
 * is the safe direction.
 */
export const getSessionSnapshot = cache(async (scope: SessionScope = {}): Promise<SessionSnapshot> => {
  const token = await getSessionToken();
  // No cookie is a complete answer, arrived at without asking anyone. Reporting
  // it as unreachable would put "cannot reach the server" on the sign-in page
  // of a perfectly healthy deployment.
  if (!token) return SIGNED_OUT;

  const apiUrl = process.env.API_URL ?? 'http://localhost:8080/api/v1';

  try {
    const response = await fetch(`${apiUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: SESSION_QUERY,
        variables: { organizationId: scope.organizationId ?? null, workspaceId: scope.workspaceId ?? null },
      }),
      // Never cached: one viewer must not be served another's identity or grants
      // from a shared cache.
      cache: 'no-store',
    });
    /*
     * A 5xx is the API failing; a 4xx is the API answering. Only the first is
     * an outage — a 401 here means the token is no longer good, which is a
     * sign-out and should redirect like one.
     */
    if (!response.ok) return response.status >= 500 ? UNREACHABLE : SIGNED_OUT;

    const body = (await response.json()) as {
      data?: {
        viewer: Viewer | null;
        myPermissions: PermissionContext | null;
        myOrganizations: ViewerOrganization[] | null;
        session: { expiresAt: number } | null;
      };
    };

    const expiresAt = body.data?.session?.expiresAt;
    return {
      viewer: body.data?.viewer ?? null,
      permissions: body.data?.myPermissions ?? null,
      organizations: body.data?.myOrganizations ?? [],
      expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      reachable: true,
    };
  } catch {
    // Connection refused, DNS failure, a body that is not JSON. Nothing came
    // back, so nothing is known — least of all whether anyone is signed in.
    return UNREACHABLE;
  }
});
