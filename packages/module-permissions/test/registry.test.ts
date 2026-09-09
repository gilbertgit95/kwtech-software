import type { ModuleRoute } from '@kwtech/module-kit';
import { allFeatureKeys, assertRoleFeatureLevels, featuresForLevel, type RoleDefinition } from '../src/domain/roles.js';
import { FEATURE, FEATURE_REGISTRY, isRegisteredFeature } from '../src/feature-keys.js';
import { assertRegistered, auditRegistry, deriveRouteBindings } from '../src/registry-audit.js';
import { type FeatureSpec, toRoleLevel } from '../src/types.js';

/**
 * The registry is the source and the database is the mirror. These tests are
 * the drift alarm: a key that guards nothing reads as coverage in the role
 * editor, and a guard on an unregistered key can never be granted, so the check
 * behind it always fails.
 */

/** A route descriptor is only ever read for its path and feature here. */
const route = (over: Pick<ModuleRoute, 'path' | 'title'> & Partial<ModuleRoute>): ModuleRoute => ({
  component: (() => null) as unknown as ModuleRoute['component'],
  ...over,
});

const spec = (over: Partial<FeatureSpec> & Pick<FeatureSpec, 'key' | 'level'>): FeatureSpec => ({
  module: 'test',
  label: over.key,
  description: over.key,
  ...over,
});

describe('FEATURE_REGISTRY', () => {
  it('has no duplicate keys', () => {
    const keys = FEATURE_REGISTRY.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('registers every key the FEATURE constant exposes, and nothing else', () => {
    // A fork between the two raises no error at runtime: it silently hides a
    // control the user is entitled to, or shows one the API will refuse.
    expect(Object.values(FEATURE).sort()).toEqual(FEATURE_REGISTRY.map((s) => s.key).sort());
  });

  it('gives every entry a valid level', () => {
    for (const s of FEATURE_REGISTRY) expect(() => toRoleLevel(s.level)).not.toThrow();
  });

  it('namespaces every key as area:action', () => {
    for (const s of FEATURE_REGISTRY) expect(s.key).toMatch(/^[a-z][a-z_]*:[a-z][a-z_]*$/);
  });

  it('puts every platform:* key at app level — they are staff rights', () => {
    for (const s of FEATURE_REGISTRY.filter((f) => f.key.startsWith('platform:'))) {
      expect(s.level).toBe('app');
    }
  });

  it('agrees with isRegisteredFeature', () => {
    expect(isRegisteredFeature(FEATURE.membersRead)).toBe(true);
    expect(isRegisteredFeature('nothing:here')).toBe(false);
  });
});

describe('toRoleLevel', () => {
  it.each(['app', 'organization', 'workspace'])('accepts %p', (level) => {
    expect(toRoleLevel(level)).toBe(level);
  });

  it.each(['Organization', 'organization ', 'ORG', '', 'tenant'])('throws on %p rather than casting', (bad) => {
    // A cast would produce a role that matches nothing and grants nothing, with
    // no error anywhere. Silent denial is the safe direction and the
    // undiagnosable one.
    expect(() => toRoleLevel(bad)).toThrow(/Unknown role level/);
  });
});

describe('assertRoleFeatureLevels', () => {
  const specs = [
    spec({ key: 'billing:manage', level: 'organization' }),
    spec({ key: 'workspaces:share', level: 'workspace' }),
  ];
  const role = (over: Partial<RoleDefinition>): RoleDefinition => ({
    key: 'r',
    label: 'R',
    level: 'workspace',
    features: [],
    ...over,
  });

  it('refuses a workspace role holding an organization-level feature', () => {
    // Creating workspace roles is a routine, widely delegated right. Without
    // this it is also a path to an organization-wide one.
    expect(() => assertRoleFeatureLevels(role({ features: ['billing:manage'] }), specs)).toThrow(
      /'billing:manage' is organization-level, which is broader than workspace-level role 'r'/,
    );
  });

  it('refuses an unregistered key', () => {
    expect(() => assertRoleFeatureLevels(role({ features: ['made:up'] }), specs)).toThrow(/not in the registry/);
  });

  it('reports every problem at once', () => {
    const error = (() => {
      try {
        assertRoleFeatureLevels(role({ features: ['billing:manage', 'made:up'] }), specs);
      } catch (e) {
        return (e as Error).message;
      }
    })();

    expect(error).toContain('billing:manage');
    expect(error).toContain('made:up');
  });

  it('throws rather than filtering silently', () => {
    // Dropping the offending key would leave a role that looks correct in the
    // editor and grants less than it says.
    expect(() => assertRoleFeatureLevels(role({ features: ['billing:manage'] }), specs)).toThrow();
  });

  it('accepts a role whose features all match its level', () => {
    expect(() => assertRoleFeatureLevels(role({ features: ['workspaces:share'] }), specs)).not.toThrow();
    expect(() =>
      assertRoleFeatureLevels(role({ level: 'organization', features: ['billing:manage'] }), specs),
    ).not.toThrow();
  });

  it('accepts an empty role', () => {
    expect(() => assertRoleFeatureLevels(role({}), specs)).not.toThrow();
  });

  it('holds for every real role level against the real registry', () => {
    for (const level of ['app', 'organization', 'workspace'] as const) {
      const everything = featuresForLevel(FEATURE_REGISTRY, level).map((s) => s.key);
      expect(() => assertRoleFeatureLevels(role({ level, features: everything }), FEATURE_REGISTRY)).not.toThrow();
    }
  });

  it('lets an APP-level role collect features of every other level', () => {
    // The escalation the rule guards against needs a lesser right to escalate
    // from, and an app role has none: it hangs off no membership and no tenant
    // administrator can mint one. Without the exemption a super admin could
    // hold only the two app-level keys.
    expect(() =>
      assertRoleFeatureLevels(role({ level: 'app', features: ['billing:manage', 'workspaces:share'] }), specs),
    ).not.toThrow();
  });

  it('lets an APP-level role hold the ENTIRE real registry', () => {
    // This is the definition of super admin. If it ever throws, the seeded
    // role silently stops being all-access.
    expect(() =>
      assertRoleFeatureLevels(role({ level: 'app', features: allFeatureKeys(FEATURE_REGISTRY) }), FEATURE_REGISTRY),
    ).not.toThrow();
  });

  it('still refuses an unregistered key on an APP-level role', () => {
    // The level exemption is not an exemption from the registry: a key no spec
    // declares can never be checked, so it would read as access while granting
    // nothing.
    expect(() => assertRoleFeatureLevels(role({ level: 'app', features: ['made:up'] }), specs)).toThrow(
      /not in the registry/,
    );
  });
});

describe('allFeatureKeys', () => {
  it('returns every registry key, so super admin follows the registry', () => {
    expect(allFeatureKeys(FEATURE_REGISTRY)).toHaveLength(FEATURE_REGISTRY.length);
    expect(allFeatureKeys(FEATURE_REGISTRY)).toContain(FEATURE.billingManage);
    expect(allFeatureKeys(FEATURE_REGISTRY)).toContain(FEATURE.featuresCreate);
    expect(allFeatureKeys(FEATURE_REGISTRY)).toContain(FEATURE.workspaceRead);
  });
});

describe('featuresForLevel', () => {
  it('offers a role only what its level may grant', () => {
    const workspace = featuresForLevel(FEATURE_REGISTRY, 'workspace');
    expect(workspace.map((s) => s.key)).toContain(FEATURE.workspaceRead);
    expect(workspace.map((s) => s.key)).not.toContain(FEATURE.billingManage);
  });

  it('NESTS the levels rather than partitioning them', () => {
    /*
     * The levels used to be disjoint — each offered exactly its own keys. They
     * are now nested: a role may collect its own level and any NARROWER one, so
     * what an organization role can offer is a superset of what a workspace
     * role can, and app offers everything.
     *
     * Asserted as a containment chain rather than as three fixed counts, so
     * adding a key to the registry cannot make this fail for the wrong reason.
     */
    const keys = (level: 'app' | 'organization' | 'workspace') =>
      new Set(featuresForLevel(FEATURE_REGISTRY, level).map((spec) => spec.key));

    const app = keys('app');
    const organization = keys('organization');
    const workspace = keys('workspace');

    expect([...workspace].every((key) => organization.has(key))).toBe(true);
    expect([...organization].every((key) => app.has(key))).toBe(true);
    expect(app.size).toBe(FEATURE_REGISTRY.length);
    // And the nesting is STRICT while more than one level is in use — otherwise
    // this would still pass if the rule collapsed into "everything, always".
    expect(organization.size).toBeLessThan(app.size);
    expect(workspace.size).toBeLessThan(organization.size);
  });

  it('offers an app-level role the whole registry', () => {
    // Otherwise the editor presents a shorter list than the write path accepts,
    // and super admin cannot be composed in the UI at all.
    expect(featuresForLevel(FEATURE_REGISTRY, 'app')).toHaveLength(FEATURE_REGISTRY.length);
    expect(featuresForLevel(FEATURE_REGISTRY, 'app').map((s) => s.key)).toContain(FEATURE.billingManage);
  });
});

describe('deriveRouteBindings', () => {
  it('derives a ui_route binding from a route descriptor', () => {
    // Written once, in the routes. Asking anyone to repeat it in the registry
    // only creates a second thing to forget.
    const derived = deriveRouteBindings([route({ path: '/admin/roles', feature: 'roles:manage', title: 'Roles' })]);
    expect(derived.get('roles:manage')).toEqual([{ surface: 'ui_route', identifier: '/admin/roles' }]);
  });

  it('ignores an unguarded route — enforcement is opt-in', () => {
    expect(deriveRouteBindings([route({ path: '/help', title: 'Help' })]).size).toBe(0);
  });

  it('collects several routes under one key', () => {
    const derived = deriveRouteBindings([
      route({ path: '/a', feature: 'roles:manage', title: 'A' }),
      route({ path: '/b', feature: 'roles:manage', title: 'B' }),
    ]);
    expect(derived.get('roles:manage')).toHaveLength(2);
  });
});

describe('auditRegistry', () => {
  it('reports a key that guards nothing', () => {
    const audit = auditRegistry([spec({ key: 'a:b', level: 'app', bindings: [] })]);
    expect(audit.unbound).toEqual(['a:b']);
  });

  it('counts bindings by surface', () => {
    const audit = auditRegistry([
      spec({
        key: 'a:b',
        level: 'app',
        bindings: [
          { surface: 'rest_endpoint', identifier: 'GET /x' },
          { surface: 'rest_endpoint', identifier: 'GET /y' },
          { surface: 'ui_component', identifier: 'Widget' },
        ],
      }),
    ]);

    expect(audit.bySurface.rest_endpoint).toBe(2);
    expect(audit.bySurface.ui_component).toBe(1);
    expect(audit.unbound).toEqual([]);
  });

  it('reports a surface claimed by two keys — one surface, two answers, no way to tell which wins', () => {
    const audit = auditRegistry([
      spec({ key: 'a:b', level: 'app', bindings: [{ surface: 'rest_endpoint', identifier: 'GET /x' }] }),
      spec({ key: 'c:d', level: 'app', bindings: [{ surface: 'rest_endpoint', identifier: 'GET /x' }] }),
    ]);

    expect(audit.contested).toEqual([{ surface: 'rest_endpoint', identifier: 'GET /x', keys: ['a:b', 'c:d'] }]);
  });

  it('counts a route binding once when it is both hand-written and derived', () => {
    // Counting it twice would overstate coverage.
    const audit = auditRegistry(
      [spec({ key: 'a:b', level: 'app', bindings: [{ surface: 'ui_route', identifier: '/x' }] })],
      [route({ path: '/x', feature: 'a:b', title: 'X' })],
    );

    expect(audit.bySurface.ui_route).toBe(1);
    expect(audit.contested).toEqual([]);
  });

  it('counts a derived binding for a key with none declared', () => {
    const audit = auditRegistry(
      [spec({ key: 'a:b', level: 'app', bindings: [] })],
      [route({ path: '/x', feature: 'a:b', title: 'X' })],
    );

    expect(audit.unbound).toEqual([]);
    expect(audit.bySurface.ui_route).toBe(1);
  });

  it('runs over the real registry and reports the keys still awaiting a guard', () => {
    const audit = auditRegistry(FEATURE_REGISTRY);

    // Contested is the one that must always be empty: it is a genuine
    // contradiction, not a buildout gap.
    expect(audit.contested).toEqual([]);
    // Unbound is expected during buildout and must be empty at release. Pinned
    // so that a NEW unbound key is a visible diff rather than a silent one.
    expect(audit.unbound.sort()).toEqual(
      /*
       * Down from six to three. `members:manage`, `workspaces:manage` and
       * `workspaces:share` were bound when the organization screens exposed the
       * mutations they guard — the write service had checked all three since it
       * was written, with nothing reachable to call it.
       *
       * The three that remain are genuinely different: two are read in
       * `composeContext` rather than guarding a surface, and `roles:manage_app`
       * is a condition inside the write path rather than an endpoint.
       */
      /*
       * Three, and the newcomer is a different KIND of unbound from the other
       * two — worth keeping straight, because the audit cannot tell them apart.
       *
       * `platform:support_access` and `roles:manage_app` guard no surface at
       * all: one is read in `composeContext`, the other is a condition inside
       * the write path. They will never have a binding, and that is not a lie.
       *
       * `workspaces:read` DOES guard a surface —
       * `/organizations/:organizationId/workspaces` — but a UI route is not
       * declared in the registry: `deriveRouteBindings` reads route bindings off
       * the module's descriptors, and this call passes no routes. So it appears
       * here while being perfectly well enforced. Repeating the route by hand to
       * silence the audit is exactly the second place to forget that
       * `deriveRouteBindings` exists to remove.
       */
      [FEATURE.platformSupportAccess, FEATURE.rolesManageApp, FEATURE.workspacesRead].sort(),
    );
  });
});

describe('assertRegistered', () => {
  it('throws for a key used in code but absent from the registry', () => {
    // Otherwise it fails every permission check at runtime instead of the build.
    expect(() => assertRegistered(FEATURE_REGISTRY, ['made:up'])).toThrow(/used but not registered: made:up/);
  });

  it('lists each missing key once', () => {
    expect(() => assertRegistered(FEATURE_REGISTRY, ['made:up', 'made:up', 'also:missing'])).toThrow(
      /made:up, also:missing/,
    );
  });

  it('accepts registered keys', () => {
    expect(() => assertRegistered(FEATURE_REGISTRY, [FEATURE.membersRead, FEATURE.billingManage])).not.toThrow();
  });

  it('accepts an empty list', () => {
    expect(() => assertRegistered(FEATURE_REGISTRY, [])).not.toThrow();
  });
});
