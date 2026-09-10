/**
 * ⚠ TAGS ARE AN ORDERED PATH, not a set.
 *
 * A feature's tags read outermost-first: `['admin', 'roles']` means "the roles
 * area of the admin app", and the role editor nests its picker on exactly that
 * — `admin` containing `roles` containing the features themselves. Reversing
 * them would build the tree upside down.
 *
 * Filtering is unaffected and still treats them as a set: a feature tagged
 * `['admin', 'roles']` matches a filter for `admin`, for `roles`, or for both.
 * The order only decides how they NEST.
 *
 * Two levels is the shape everything uses today. Nothing enforces a maximum —
 * the tree renders whatever depth it is given — but a third level should be a
 * deliberate decision rather than a tag somebody appended.
 */
/**
 * The controlled vocabulary for feature tags.
 *
 * ## Why a vocabulary and not free text
 *
 * Tags exist to GROUP, and grouping only works if the same idea is spelled the
 * same way every time. Left free, a registry acquires `admin`, `Admin` and
 * `administration` within a month, and the filter that was supposed to collapse
 * a long list into a few piles produces three piles that mean one thing.
 *
 * Declaring them costs one line per new tag and makes adding one a deliberate
 * act. `assertKnownTags` is what turns that from a convention into a check.
 *
 * ## Tags are not permissions
 *
 * Nothing here is read by `checkFeature`, `hasAllFeatures`, the guard, or any
 * other decision. A tag groups keys for a human reading a list; granting "every
 * feature tagged admin" would be the wildcard grant this model already rejected
 * (see docs/PLAN.md §13, the `platform:super_admin` entry) — a role row must
 * describe what its holder can do, and a tag is a label somebody can edit.
 */

export const FEATURE_TAG = {
  // ── roots ─────────────────────────────────────────────────────────────────
  /** Reached from the admin app: the platform's own back office. */
  admin: 'admin',
  /** Platform staff rights, held across every organization rather than inside one. */
  platform: 'platform',
  /** Signing in and looking after your own account. */
  auth: 'auth',
  /**
   * Reached from inside ONE organization: a tenant looking after itself.
   *
   * A root, and the counterpart of `admin` rather than an area under it. The
   * two group the same subject matter — members, workspaces, what the tenant
   * bought — from opposite sides of the platform boundary, and the level says
   * which: everything tagged `admin` is app level and reads across tenants,
   * everything tagged `organization` is organization or workspace level and
   * reads one. A role editor that nested them together would offer a customer's
   * owner the platform's keys in the same tree as their own.
   */
  organization: 'organization',

  // ── areas, used as the SECOND tag ─────────────────────────────────────────
  /** The permission system's roles. */
  roles: 'roles',
  /** The feature registry itself. */
  features: 'features',
  /** Who is in an organization, and what they hold. */
  members: 'members',
  /** Workspaces and what happens inside them. */
  workspaces: 'workspaces',
  /** Plans, subscriptions and entitlement. */
  billing: 'billing',
  /** Helping a customer: support access, impersonation. */
  support: 'support',
  /**
   * What the platform does when nobody said what to do — the defaults every
   * account, organization and workspace is created with.
   *
   * Its own area rather than sitting under `roles` or `billing`, because the
   * screen crosses both: one of these points at a role, another at a plan, and
   * a role editor that filed them under either would hide half of them from
   * whoever went looking.
   */
  defaults: 'defaults',
} as const;

export type FeatureTag = (typeof FEATURE_TAG)[keyof typeof FEATURE_TAG];

export const FEATURE_TAGS: readonly FeatureTag[] = Object.values(FEATURE_TAG);

/**
 * Lower-cased, trimmed, spaces to hyphens.
 *
 * Applied wherever a tag arrives from outside the code — a form field, a
 * spreadsheet cell — so `Access Control` and `access-control` are one tag
 * rather than two that sort apart and filter separately.
 */
export function normaliseTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Normalised, de-duplicated, and ordered — so two equal tag sets render identically. */
export function normaliseTags(values: readonly string[]): string[] {
  return [...new Set(values.map(normaliseTag).filter((tag) => tag.length > 0))].sort();
}

export function isKnownTag(value: string): value is FeatureTag {
  return (FEATURE_TAGS as readonly string[]).includes(value);
}

/**
 * Every tag used by a registry that is not in the vocabulary above.
 *
 * Returned rather than thrown, so a caller decides: the test suite fails the
 * build on it, while the role editor could reasonably show an unknown tag
 * greyed out rather than refusing to render.
 */
export function unknownTags(specs: readonly { tags?: readonly string[] }[]): string[] {
  const unknown = new Set<string>();
  for (const spec of specs) {
    for (const tag of spec.tags ?? []) if (!isKnownTag(tag)) unknown.add(tag);
  }
  return [...unknown].sort();
}

/** Every tag actually in use, sorted — for a filter bar that should not list empty piles. */
export function tagsInUse(specs: readonly { tags?: readonly string[] }[]): string[] {
  const used = new Set<string>();
  for (const spec of specs) for (const tag of spec.tags ?? []) used.add(tag);
  return [...used].sort();
}
