import { checkFeature, hasAllFeatures, hasAnyFeature } from '../src/check.js';
import { FEATURE, FEATURE_REGISTRY } from '../src/feature-keys.js';
import { FEATURE_TAG, isKnownTag, normaliseTag, normaliseTags, tagsInUse, unknownTags } from '../src/feature-tags.js';
import type { PermissionContext } from '../src/types.js';

const ctx = (effective: string[]): PermissionContext => ({
  subjectId: 'u',
  organizationId: 'o',
  workspaceId: null,
  granted: effective,
  grantedAtAppLevel: [],
  effective,
  limits: {},
  accessibleWorkspaceIds: null,
  entitled: null,
  appRoles: [],
});

/**
 * THE GUARDRAIL. Tags group keys for a person reading a list; they must never
 * grant, deny, or imply anything. "Everyone with the admin tag" would be the
 * wildcard grant this model already rejected — a role row has to describe what
 * its holder can do, and a tag is a label somebody can edit.
 */
describe('tags never influence access', () => {
  const tagged = FEATURE_REGISTRY.find((spec) => (spec.tags ?? []).includes(FEATURE_TAG.admin));

  it('the fixture is actually tagged', () => {
    expect(tagged).toBeDefined();
  });

  it('holding a tag name as if it were a key grants nothing', () => {
    // Someone who somehow ended up with 'admin' in their grant list must not
    // thereby hold every feature tagged 'admin'.
    const context = ctx([FEATURE_TAG.admin]);
    expect(checkFeature(context, FEATURE.adminAccess).allowed).toBe(false);
    expect(checkFeature(context, FEATURE.featuresRead).allowed).toBe(false);
    expect(hasAnyFeature(context, [FEATURE.rolesManage])).toBe(false);
  });

  it('holding one key does not extend to its tag-mates', () => {
    const context = ctx([FEATURE.featuresRead]);
    expect(checkFeature(context, FEATURE.featuresRead).allowed).toBe(true);
    // Same 'admin' + 'access-control' tags, different key.
    expect(checkFeature(context, FEATURE.rolesManage).allowed).toBe(false);
    expect(hasAllFeatures(context, [FEATURE.featuresRead, FEATURE.rolesManage])).toBe(false);
  });

  it('a decision is identical whether or not the spec carries tags', () => {
    const context = ctx([FEATURE.billingManage]);
    const before = checkFeature(context, FEATURE.billingManage);
    // `checkFeature` reads the CONTEXT, never the registry, so tags cannot
    // reach it at all — asserted rather than assumed.
    expect(before.allowed).toBe(true);
    expect(checkFeature(ctx([]), FEATURE.billingManage).allowed).toBe(false);
  });
});

describe('the vocabulary is closed', () => {
  it('every tag in the registry is declared', () => {
    expect(unknownTags(FEATURE_REGISTRY)).toEqual([]);
  });

  /** A key with no tags is invisible to every filter — a pile of one, unfindable. */
  it('every registry entry carries at least one tag', () => {
    expect(FEATURE_REGISTRY.filter((spec) => (spec.tags ?? []).length === 0).map((s) => s.key)).toEqual([]);
  });

  it('recognises declared tags and rejects others', () => {
    expect(isKnownTag(FEATURE_TAG.billing)).toBe(true);
    expect(isKnownTag('nonsense')).toBe(false);
  });

  it('lists only tags actually in use', () => {
    const used = tagsInUse(FEATURE_REGISTRY);
    expect(used).toEqual([...used].sort());
    expect(used.every(isKnownTag)).toBe(true);
  });
});

describe('normalisation', () => {
  it.each([
    ['Admin', 'admin'],
    ['  admin  ', 'admin'],
    ['Access Control', 'access-control'],
    ['ACCESS   CONTROL', 'access-control'],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseTag(input)).toBe(expected);
  });

  it('de-duplicates and sorts, so two equal sets render identically', () => {
    expect(normaliseTags(['Billing', 'admin', 'BILLING'])).toEqual(['admin', 'billing']);
  });

  it('drops empties rather than producing a blank tag', () => {
    expect(normaliseTags(['', '  ', 'admin'])).toEqual(['admin']);
  });
});
