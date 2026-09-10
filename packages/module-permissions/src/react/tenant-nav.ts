/**
 * The `/organizations/*` vocabulary: its URLs, and the drawer section they sit in.
 *
 * ⚠ **NO `'use client'` IN THIS FILE, AND THAT IS THE WHOLE REASON IT EXISTS.**
 *
 * These began life in `pages/tenant-page.tsx`, which is a client component. A
 * Next.js app replaces such a module with a client-reference PROXY, and a proxy
 * is something a server component may pass through and never read. So the
 * moment something on the server compared the group name — `composeNav` sorts
 * on it, and `module.tsx`'s descriptor is read server-side — it threw:
 *
 *     Cannot access ORGANIZATION_NAV_GROUP.localeCompare on the server.
 *     You cannot dot into a client module from a server component.
 *
 * A constant is not exempt from that because it is "just a string" — what
 * crosses the boundary is the module, not the value. Anything the SERVER reads
 * the value of has to be defined outside a client module, which is what this
 * file is. The barrel re-exports from both kinds, so consumers see no
 * difference.
 *
 * It is the same boundary the barrel's own `export *` warning is about, and the
 * mirror of the other direction's trap: a FUNCTION passed from a server
 * component into a client one fails just as hard (see `OrganizationNewPage`,
 * which takes a `basePath` string for exactly that reason).
 *
 * Nothing here imports React, so a test — or a Nest app — can read the URL
 * convention without a renderer.
 */

import { scopePath } from '../scope.js';

/**
 * ── the tenant URL vocabulary, in one place ─────────────────────────────────
 *
 * ⚠ These are not decorative helpers. `/organizations/:id/...` is the CONVENTION
 * `scope.ts` parses to decide what LEVEL a request is at, and the same
 * convention the server's guard reads from a resolver's arguments. A path built
 * by hand that puts the ids in a different order, or spells `workspaces`
 * differently, does not merely 404 — it resolves at the wrong level, which is a
 * perfectly valid-looking context for the wrong scope.
 *
 * So they are built by `scopePath`, the inverse of the parser, rather than by
 * template literals. One implementation of the convention, used by both
 * directions, is the whole reason that function exists.
 */

/**
 * The drawer section for the organization the reader has drilled into.
 *
 * A STATIC word, and drawn as-is. It briefly carried the organization's NAME
 * instead, and that was worse: the switcher sits directly above this heading
 * and already says which organization you are in, so the name appeared twice in
 * the space of two rows and the second one carried nothing the first had not. A
 * static word beside a live name reads as a label FOR it, which is what a
 * section heading is for.
 *
 * That is also why `NavGroup` has no separate `label` — the substitution it
 * existed for is gone, and an abstraction kept for a case nobody has is worse
 * than none.
 *
 * Named here rather than written six times in `module.tsx`, and exported so an
 * app that wants to place or reorder the section can name it — both
 * `composeNavGroups` and `navGroupRank` work by group name.
 *
 * There is deliberately no group for `/organizations` itself. Switching
 * organization is the SWITCHER's job, and it already offers both "All
 * organizations" and "New organization". A drawer entry beside it would be a
 * second control for one act, and the two would drift.
 */
export const ORGANIZATION_NAV_GROUP = 'Organization';

/**
 * The drawer section for the WORKSPACE the reader has drilled into.
 *
 * Its own section rather than entries nested under the organization's, because
 * a workspace is a place you are IN, not a thing the organization has a list
 * of: everything under this heading is scoped to that one workspace, and
 * everything under the organization's is scoped to the tenant. Two scopes, two
 * sections — the same distinction the URL makes.
 *
 * It appears only when a workspace is selected, and by the same arithmetic the
 * organization's section uses: every route in it carries BOTH
 * `:organizationId` and `:workspaceId`, and `composeNav` drops an entry whose
 * parameters it cannot fill.
 */
export const WORKSPACE_NAV_GROUP = 'Workspace';

/** `/organizations` — the picker. Not scoped to anything; app level by design. */
export const ORGANIZATIONS_HREF = '/organizations';

/** `/organizations/new`. A literal path, and the router scores literals above `:id`. */
export const ORGANIZATION_NEW_HREF = '/organizations/new';

export function organizationHref(organizationId: string): string {
  return scopePath({ organizationId });
}

export function organizationSectionHref(organizationId: string, section: string): string {
  return scopePath({ organizationId }, section);
}

export function workspaceHref(organizationId: string, workspaceId: string): string {
  return scopePath({ organizationId, workspaceId });
}

/**
 * `/organizations/:organizationId/workspaces/new` — create a workspace IN a tenant.
 *
 * ⚠ Built by `scopePath` like every other link here, and the reason matters
 * more on this one than on most: a workspace is not a top-level thing. There is
 * no `/workspaces/new` to point at, because "new workspace" is meaningless
 * without saying whose — the same key exists in two tenants and they are
 * different places, and the organization id is what the server's guard reads
 * the LEVEL from. So the create screen sits inside the organization's path, and
 * the switcher that offers it can only offer it while one is selected.
 *
 * It is the second literal that collides with the convention, after
 * `/organizations/new`: `parseScope` knows nothing about which routes exist, so
 * it reads the trailing `new` as a workspace ID and calls this workspace level.
 * The ROUTER does not — it scores literal segments above dynamic ones, matches
 * the literal route, and captures no `:workspaceId` — and the app's catch-all
 * derives its scope from those captured params rather than from a second pass
 * over the string. So the page renders at ORGANIZATION level, which is where
 * `workspaces:create` lives. Both readings are pinned by `tenant-routes.test`.
 */
export function workspaceNewHref(organizationId: string): string {
  return scopePath({ organizationId }, 'workspaces/new');
}
