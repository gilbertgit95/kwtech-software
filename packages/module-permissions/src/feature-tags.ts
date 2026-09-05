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
  /** Reached from the admin app. Cuts across roles, members, billing and features. */
  admin: 'admin',
  /** Platform staff rights, held across every organization rather than inside one. */
  platform: 'platform',
  /** Helping a customer: support access, impersonation. */
  support: 'support',
  /** Who is in an organization, and what they hold. */
  members: 'members',
  /** Workspaces and what happens inside them. */
  workspaces: 'workspaces',
  /** The permission system itself — roles and the feature vocabulary. */
  accessControl: 'access-control',
  /** Plans, subscriptions and entitlement. */
  billing: 'billing',
  /** Your own account, as opposed to anybody else's. */
  account: 'account',
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
