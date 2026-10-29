/**
 * What the phone layout has at an address (issue #22).
 *
 * Three kinds of place, and everything else:
 *
 *   home          `/`: straight into the remembered (or only) workspace,
 *                 or a picker.
 *   organization  `/organizations/:id` and its `/workspaces` list: that
 *                 organization's workspaces to choose from.
 *   workspace     `/organizations/:id/workspaces/:id`, and its desktop Apps
 *                 page `/apps`: the workspace's screens, one tab each.
 *   elsewhere     anything else the proxy sent here — a member list, a
 *                 workspace's settings. Not on phones: it says so, and offers
 *                 the full site.
 *
 * The workspace's own address is its home on a phone, and the Apps page's
 * address means the same place, so a link from either layout opens the same
 * workspace on the other.
 *
 * ⚠ `new` is a literal, never an id: `/organizations/new` and
 * `.../workspaces/new` are create forms, and reading them as an organization
 * called "new" would put a picker of nothing on screen.
 */
export type MobileRoute =
  | { kind: 'home' }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'workspace'; organizationId: string; workspaceId: string }
  /**
   * Not on the phone. Still carries the place the address names, when it names
   * one — `/organizations/:id/workspaces/:id/members` is in that workspace — so
   * the frame can show that workspace's bottom bar instead of none.
   */
  | { kind: 'elsewhere'; organizationId?: string; workspaceId?: string };

export function mobileRoute(slug: readonly string[]): MobileRoute {
  if (slug.length === 0) return { kind: 'home' };

  // Next hands the segments over already decoded; decoding again would turn a `%25` in an id into a different id.
  const [first, organizationId, third, workspaceId, fifth, ...rest] = slug;
  if (first !== 'organizations' || !organizationId || organizationId === 'new') return { kind: 'elsewhere' };

  if (third === undefined) return { kind: 'organization', organizationId };
  if (third !== 'workspaces') return { kind: 'elsewhere', organizationId };
  if (workspaceId === undefined) return { kind: 'organization', organizationId };
  if (!workspaceId || workspaceId === 'new') return { kind: 'elsewhere', organizationId };

  if (rest.length > 0) return { kind: 'elsewhere', organizationId, workspaceId };
  if (fifth === undefined || fifth === 'apps') return { kind: 'workspace', organizationId, workspaceId };
  return { kind: 'elsewhere', organizationId, workspaceId };
}
