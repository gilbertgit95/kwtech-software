import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchRouteWithParams } from '@kwtech/module-kit';
import { FEATURE_REGISTRY } from '../src/feature-keys.js';
import { permissionsWebModule } from '../src/react/module.js';
import {
  ORGANIZATION_NAV_GROUP,
  ORGANIZATION_NEW_HREF,
  ORGANIZATIONS_HREF,
  organizationHref,
  organizationSectionHref,
  WORKSPACE_NAV_GROUP,
  workspaceHref,
  workspaceNewHref,
} from '../src/react/tenant-nav.js';
import { isScopeConsistent, parseScope, scopePath } from '../src/scope.js';

/**
 * THE TENANT ROUTES AND THE SCOPE CONVENTION MUST AGREE.
 *
 * `/organizations/:orgId/...` is not a naming preference. It is the convention
 * `scope.ts` parses, and it decides what LEVEL a request resolves at — on the
 * web, in the Nest guard, and in the navigation builder. A route declared one
 * segment away from it resolves at a different level than its author intended,
 * and the failure is silent in the worst direction: a perfectly valid-looking
 * permission context, for the wrong scope.
 *
 * These assert the pairing that PLAN §12.13 rests on, so the next screen added
 * to this area cannot quietly land outside it.
 */

const routes = permissionsWebModule.routes ?? [];
const tenantRoutes = routes.filter(
  (route) => route.path === '/organizations' || route.path.startsWith('/organizations/'),
);
const levelOf = (key: string) => FEATURE_REGISTRY.find((spec) => spec.key === key)?.level;

describe('the /organizations area', () => {
  it('has routes at all — a filter typo would otherwise make every test below vacuous', () => {
    expect(tenantRoutes.length).toBeGreaterThan(5);
  });

  /**
   * THE ONE THAT MATTERS MOST.
   *
   * A tenant route gated on an APP-level key would be unreachable by every
   * customer, for ever, and would look like a permissions bug rather than a
   * routing one: a role may only collect features at its own level, so no
   * organization-level role can ever carry an app-level key, and the guard
   * would refuse with an ordinary "your roles do not include this".
   *
   * `/organizations` and `/organizations/new` carry NO key deliberately —
   * somebody who belongs nowhere must be able to reach both — and that is the
   * only exemption.
   */
  it('is gated only by organization- or workspace-level keys', () => {
    const wrong = tenantRoutes
      .filter((route) => route.feature)
      .filter((route) => levelOf(route.feature as string) === 'app')
      .map((route) => `${route.path} → ${route.feature}`);

    expect(wrong).toEqual([]);
  });

  it('leaves exactly the two unreachable-by-a-member routes unkeyed', () => {
    const unkeyed = tenantRoutes.filter((route) => !route.feature).map((route) => route.path);
    expect(unkeyed.sort()).toEqual(['/organizations', '/organizations/new']);
  });

  it('every key it does use is one the registry actually declares', () => {
    for (const route of tenantRoutes) {
      if (route.feature) expect(levelOf(route.feature)).toBeDefined();
    }
  });

  /**
   * Each path must parse at the level its screen is built for, and the parse
   * must be internally consistent — a workspace-level path carrying both ids,
   * an organization-level one carrying exactly one.
   */
  it.each([
    ['/organizations', 'app'],
    ['/organizations/:organizationId', 'organization'],
    ['/organizations/:organizationId/members', 'organization'],
    ['/organizations/:organizationId/workspaces', 'organization'],
    ['/organizations/:organizationId/subscription', 'organization'],
    ['/organizations/:organizationId/settings', 'organization'],
    ['/organizations/:organizationId/workspaces/:workspaceId', 'workspace'],
    ['/organizations/:organizationId/workspaces/:workspaceId/settings', 'workspace'],
  ])('%s resolves at %s level', (path, level) => {
    expect(routes.some((route) => route.path === path)).toBe(true);

    // Parsed with real ids, because the parser reads VALUES: ':organizationId'
    // is itself a perfectly good id as far as it is concerned.
    const scope = parseScope(path.replace(':organizationId', 'org1').replace(':workspaceId', 'ws1'));
    expect(scope.level).toBe(level);
    expect(isScopeConsistent(scope)).toBe(true);
  });

  /**
   * ⚠ `/organizations/new` is the one literal that collides with the
   * convention: it sits exactly where an organization id goes, so `parseScope`
   * — which knows nothing about which routes exist — reads it as one.
   *
   * It fails CLOSED (nobody is a member of "new", so the context resolves to
   * null), and the page is unkeyed so it renders regardless. But the ROUTER
   * knows better, because it scores literal segments above dynamic ones, and
   * the app's catch-all therefore derives its scope from the matched route's
   * captured params rather than from a second pass over the string.
   *
   * Both halves are asserted: what the parser says, so the collision is on the
   * record, and what the router says, which is what the app actually uses.
   */
  it('parseScope alone reads /organizations/new as an organization id', () => {
    expect(parseScope('/organizations/new')).toMatchObject({ level: 'organization', organizationId: 'new' });
  });

  it('but the ROUTER matches the literal route and captures no organization', () => {
    const match = matchRouteWithParams(routes, '/organizations/new');
    expect(match?.route.path).toBe('/organizations/new');
    expect(match?.params.organizationId).toBeUndefined();
  });

  /**
   * ⚠ THE SECOND LITERAL WITH THE SAME COLLISION, and it lands one level
   * deeper: `/organizations/:orgId/workspaces/new` puts `new` exactly where a
   * workspace id goes, so `parseScope` calls it WORKSPACE level.
   *
   * That reading would be actively wrong here, not merely closed. The page is
   * gated on `workspaces:create`, an ORGANIZATION-level key — no
   * workspace-level context can carry one, so a render resolved at workspace
   * level would refuse everybody with a message about their roles rather than
   * about the route. The router saves it for the same reason as above, and the
   * app's catch-all reads its scope from the captured params.
   */
  it('parseScope alone reads a trailing /workspaces/new as a workspace id', () => {
    expect(parseScope('/organizations/org1/workspaces/new')).toMatchObject({
      level: 'workspace',
      organizationId: 'org1',
      workspaceId: 'new',
    });
  });

  it('but the ROUTER matches the literal and leaves it at organization level', () => {
    const match = matchRouteWithParams(routes, '/organizations/org1/workspaces/new');
    expect(match?.route.path).toBe('/organizations/:organizationId/workspaces/new');
    expect(match?.params.organizationId).toBe('org1');
    expect(match?.params.workspaceId).toBeUndefined();
  });

  /**
   * And the key it is gated on must be the one that reading grants. This is the
   * pairing the test above exists to protect, said as the property rather than
   * as the mechanism.
   */
  it('the workspace create screen is gated on an organization-level key', () => {
    const route = routes.find((entry) => entry.path === '/organizations/:organizationId/workspaces/new');
    expect(route?.feature).toBe(FEATURE_REGISTRY.find((spec) => spec.key === 'workspaces:create')?.key);
    expect(levelOf(route?.feature as string)).toBe('organization');
  });

  /**
   * THE TWO READINGS ARE PINNED TOGETHER.
   *
   * The app derives its scope from the router's captured params; the Nest guard
   * derives its own from `parseScope` and from resolver arguments. For every
   * DYNAMIC tenant route the two must agree, or the browser and the API would
   * resolve a caller's rights in different places — which is precisely the fork
   * `scope.ts` exists to prevent, arriving through a different door.
   *
   * A route whose LAST segment is a literal sitting in an id position is
   * exempt, and is the reason this test exists at all: `/organizations/new` and
   * `/organizations/:organizationId/workspaces/new` are create SCREENS, not
   * scoped resources, and the router is what says so. The guard never reads
   * either — no mutation is addressed at those paths — so the two readings have
   * nothing to agree about.
   */
  const dynamicTenantRoutes = tenantRoutes.filter((route) => route.path.includes(':') && !route.path.endsWith('/new'));

  it('exempts only the create screens, so the exemption cannot quietly widen', () => {
    const exempt = tenantRoutes.filter((route) => route.path.includes(':') && route.path.endsWith('/new'));
    expect(exempt.map((route) => route.path)).toEqual(['/organizations/:organizationId/workspaces/new']);
  });

  it.each(dynamicTenantRoutes.map((route) => route.path))(
    '%s: the router and parseScope agree about the ids',
    (path) => {
      const url = path.replace(':organizationId', 'org1').replace(':workspaceId', 'ws1');
      const match = matchRouteWithParams(routes, url);
      const parsed = parseScope(url);

      expect(match?.params.organizationId ?? null).toBe(parsed.organizationId);
      expect(match?.params.workspaceId ?? null).toBe(parsed.workspaceId);
    },
  );

  /**
   * THE SECTION IS THE ORGANIZATION, so every entry in it must be scoped.
   *
   * The drawer heads this group with the tenant's NAME, and it appears only
   * when there is one — which works because `composeNav` drops an entry whose
   * `:params` it cannot fill. A single param-less entry in the group would
   * break both halves at once: the section would persist outside any tenant,
   * headed by a company the reader is no longer in.
   */
  it('every listed entry in the organization group carries an organization id', () => {
    const listed = routes.filter((route) => route.nav?.group === ORGANIZATION_NAV_GROUP);
    expect(listed.length).toBeGreaterThan(2);
    expect(listed.filter((route) => !route.path.includes(':organizationId'))).toEqual([]);
  });

  /**
   * THE WORKSPACE SECTION NEEDS BOTH PARAMETERS.
   *
   * It appears only while a workspace is selected, and that is `composeNav`
   * dropping an entry whose `:params` it cannot fill — so an entry here missing
   * `:workspaceId` would persist after the selection was cleared, pointing at
   * whichever workspace was last open.
   */
  it('every listed entry in the workspace group carries BOTH ids', () => {
    const listed = routes.filter((route) => route.nav?.group === WORKSPACE_NAV_GROUP);
    expect(listed.length).toBeGreaterThan(0);

    for (const route of listed) {
      expect(route.path).toContain(':organizationId');
      expect(route.path).toContain(':workspaceId');
    }
  });

  /**
   * Entering a workspace is the SELECTOR's job. The workspaces LIST is where
   * they are created, renamed and archived — administering the organization
   * rather than working in one — so it is reached from the organization's
   * overview and is deliberately not a drawer entry beside the selector that
   * opens the same places.
   */
  it('leaves the workspaces list out of the drawer', () => {
    const list = routes.find((route) => route.path === '/organizations/:organizationId/workspaces');
    expect(list).toBeDefined();
    expect(list?.nav).toBeUndefined();
  });

  /**
   * `/organizations` is UNLISTED. Switching organization is the switcher's job
   * — it sits at the top of the drawer and offers "All organizations" and "New
   * organization" — so a drawer entry beside it would be a second control for
   * one act, and the two would drift.
   *
   * The route still exists and is still reachable; it simply declares no `nav`.
   */
  it('leaves the picker and the create screen out of the drawer', () => {
    const unlisted = tenantRoutes.filter((route) => !route.nav).map((route) => route.path);
    expect(unlisted).toContain('/organizations');
    expect(unlisted).toContain('/organizations/new');
  });

  /**
   * Exactly two: the tenant's, and the workspace inside it. Each holds the
   * pages scoped to that LEVEL — neither is a list of the other's contents,
   * which is the same split the URL makes.
   */
  it('contributes exactly two drawer groups for the tenant area', () => {
    const groups = new Set(tenantRoutes.filter((route) => route.nav).map((route) => route.nav?.group));
    expect([...groups].sort()).toEqual([ORGANIZATION_NAV_GROUP, WORKSPACE_NAV_GROUP].sort());
  });
});

/**
 * The href builders are the INVERSE of the parser, and are built on `scopePath`
 * rather than on template literals for exactly that reason. A link assembled by
 * hand that spelled a segment differently would not merely 404 — it would
 * resolve at the wrong level.
 */
describe('the tenant href builders round-trip through parseScope', () => {
  it('organizationHref', () => {
    expect(organizationHref('org1')).toBe('/organizations/org1');
    expect(parseScope(organizationHref('org1'))).toMatchObject({ level: 'organization', organizationId: 'org1' });
  });

  it('organizationSectionHref', () => {
    expect(organizationSectionHref('org1', 'members')).toBe('/organizations/org1/members');
    expect(parseScope(organizationSectionHref('org1', 'members'))).toMatchObject({
      level: 'organization',
      organizationId: 'org1',
    });
  });

  it('workspaceHref', () => {
    expect(workspaceHref('org1', 'ws1')).toBe('/organizations/org1/workspaces/ws1');
    expect(parseScope(workspaceHref('org1', 'ws1'))).toMatchObject({
      level: 'workspace',
      organizationId: 'org1',
      workspaceId: 'ws1',
    });
  });

  it('encodes an id that needs it, and reads the same id back', () => {
    // `scopePath` encodes and `parseScope` decodes. Two hand-written halves of
    // this convention would eventually disagree about exactly this.
    const href = workspaceHref('org/1', 'ws 1');
    expect(href).toBe(`/organizations/${encodeURIComponent('org/1')}/workspaces/${encodeURIComponent('ws 1')}`);
    expect(parseScope(href)).toMatchObject({ organizationId: 'org/1', workspaceId: 'ws 1' });
  });

  /**
   * `workspaceNewHref` is the one builder whose output does NOT round-trip: it
   * ends in a literal where an id goes, so `parseScope` reads it as a workspace
   * called "new". Asserted rather than avoided — the collision is real, the
   * router is what resolves it, and a silent change to either side should break
   * something here.
   *
   * What must hold is that the ORGANIZATION half still parses out, because that
   * is the id the create page writes with.
   */
  it('workspaceNewHref builds inside the organization, and does not round-trip', () => {
    expect(workspaceNewHref('org1')).toBe('/organizations/org1/workspaces/new');
    expect(parseScope(workspaceNewHref('org1'))).toMatchObject({
      level: 'workspace',
      organizationId: 'org1',
      workspaceId: 'new',
    });
  });

  it('and it encodes an organization id that needs it', () => {
    expect(workspaceNewHref('org/1')).toBe(`/organizations/${encodeURIComponent('org/1')}/workspaces/new`);
  });

  it('the two literals are app level, so neither is mistaken for a tenant', () => {
    expect(ORGANIZATIONS_HREF).toBe(scopePath({}, 'organizations'));
    expect(parseScope(ORGANIZATIONS_HREF).level).toBe('app');
    // '/organizations/new' is the documented exception — see above.
    expect(ORGANIZATION_NEW_HREF).toBe('/organizations/new');
  });
});

/**
 * The `/admin` twins must NOT move onto the tenant path.
 *
 * They are platform-staff screens that resolve at app level. Putting one at
 * `/organizations/...` would change what the guard reads out from under it —
 * the workspace screen's own comment has said so since it was written, and this
 * is that comment as a check.
 */
describe('the platform screens stay off the tenant path', () => {
  it('every /admin route resolves at app level', () => {
    const admin = routes.filter((route) => route.path.startsWith('/admin'));
    expect(admin.length).toBeGreaterThan(0);

    for (const route of admin) {
      const scope = parseScope(route.path.replace(':organizationId', 'org1').replace(':workspaceId', 'ws1'));
      expect(scope.level).toBe('app');
      expect(scope.organizationId).toBeNull();
    }
  });
});

/**
 * ⚠ THE NAV VOCABULARY MUST NOT BECOME A CLIENT MODULE.
 *
 * `ORGANIZATION_NAV_GROUP` is READ on the server: `composeNav` sorts groups by
 * name, and the descriptor that carries it is composed server-side. A Next.js
 * app replaces a `'use client'` module with a client-reference proxy, and a
 * proxy is something a server component may pass through and never READ — so
 * the moment these constants lived in `pages/tenant-page.tsx`, every tenant
 * page 500'd with:
 *
 *     Cannot access ORGANIZATION_NAV_GROUP.localeCompare on the server.
 *     You cannot dot into a client module from a server component.
 *
 * A constant is not exempt because it is "just a string": what crosses the
 * boundary is the MODULE, not the value. That failure appears at runtime only —
 * it typechecks, it lints, and every test passes — so this asserts the one
 * property that prevents it, cheaply.
 */
/*
 * Read from `__dirname` rather than `import.meta.url`: the suite compiles to
 * CommonJS, where the latter is a syntax error the typechecker refuses.
 */
const NAV_SOURCE = readFileSync(join(__dirname, '../src/react/tenant-nav.ts'), 'utf8');

describe('the tenant nav vocabulary stays readable from a server component', () => {
  it('tenant-nav.ts is not a client module', () => {
    expect(NAV_SOURCE).not.toMatch(/^\s*['"]use client['"]/m);
  });

  it('and it imports no React, so a Nest app or a test can read the convention', () => {
    expect(NAV_SOURCE).not.toMatch(/from ['"]react['"]/);
  });
});
