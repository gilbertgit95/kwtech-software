import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { composeContext } from '../src/domain/grants.js';
import { FEATURE } from '../src/feature-keys.js';
import { FeatureGuard, PERMISSION_CONTEXT_KEY } from '../src/server/feature.guard.js';
import type { PermissionsModuleOptions } from '../src/server/permissions.module.js';
import type { PermissionsService } from '../src/server/permissions.service.js';
import { REQUIRED_FEATURES, REQUIRED_FEATURES_MODE } from '../src/server/require-feature.decorator.js';
import { REQUIRED_SCOPE } from '../src/server/require-scope.decorator.js';
import type { PermissionContext } from '../src/types.js';

/**
 * The guard is where "may this user do X" meets "is X somewhere this user may
 * be". C1 was the second question never being asked: canAccessWorkspace existed,
 * was exported, was used by the React layer, and was never called on the server.
 */

const ctx = (over: Partial<PermissionContext> = {}): PermissionContext => ({
  ...composeContext({
    subjectId: 'u1',
    organizationId: 'org1',
    roles: [{ roleKey: 'admin', level: 'organization', workspaceId: null, features: [FEATURE.membersManage] }],
  }),
  ...over,
});

/** A minimal ExecutionContext carrying metadata and a request. */
function execution(meta: Record<string, unknown>, request: unknown = { url: '/' }): ExecutionContext {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(meta)) Reflect.defineMetadata(key, value, handler);
  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guard(options: Partial<PermissionsModuleOptions>, loadContext?: jest.Mock) {
  const permissions = { loadContext: loadContext ?? jest.fn(async () => ctx()) } as unknown as PermissionsService;
  return new FeatureGuard(new Reflector(), options as PermissionsModuleOptions, permissions);
}

const principal = { resolvePrincipal: () => ({ userId: 'u1' }) };

describe('enforcement is opt-in', () => {
  it('passes an undecorated handler through without loading anything', async () => {
    // Most surfaces are not access-controlled. A registry naming all of them
    // would be noise that buries the entries that matter.
    const loadContext = jest.fn();
    await expect(guard(principal, loadContext).canActivate(execution({}))).resolves.toBe(true);
    expect(loadContext).not.toHaveBeenCalled();
  });

  it('passes a handler decorated with an EMPTY key list through', async () => {
    const loadContext = jest.fn();
    const g = guard(principal, loadContext);
    await expect(g.canActivate(execution({ [REQUIRED_FEATURES]: [] }))).resolves.toBe(true);
    expect(loadContext).not.toHaveBeenCalled();
  });
});

describe('M2 — 401 and 403 are different answers to different questions', () => {
  it('throws 401 when there is no principal at all', async () => {
    // A frontend reads 401 as "sign in" and 403 as "stop asking"; conflating
    // them sends signed-out users to a dead end.
    const g = guard({ resolvePrincipal: () => undefined });
    await expect(g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws 403 with reason no_context when the principal has no standing in this scope', async () => {
    const g = guard(
      principal,
      jest.fn(async () => null),
    );
    await expect(g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }))).rejects.toMatchObject({
      response: { reason: 'no_context' },
    });
  });

  it('throws a configuration error when neither wiring is supplied', async () => {
    // The module cannot invent where the caller comes from, and silently
    // allowing or denying would both be wrong.
    const g = guard({});
    await expect(g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }))).rejects.toThrow(
      /requires resolvePrincipal or resolveContext/,
    );
  });
});

describe('C1 — workspace access is enforced before any feature question', () => {
  const workspaceRequest = { url: '/organizations/org1/workspaces/ws999/data' };

  it('refuses an organization admin in a workspace they were never added to', async () => {
    // The exact hole: every organization-level feature they hold applied in
    // every workspace, including unshared ones.
    const g = guard(
      principal,
      jest.fn(async () => ctx({ accessibleWorkspaceIds: ['ws1'] })),
    );

    await expect(
      g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }, workspaceRequest)),
    ).rejects.toMatchObject({ response: { reason: 'no_workspace_access' } });
  });

  it('allows them in a workspace they belong to', async () => {
    const g = guard(
      principal,
      jest.fn(async () => ctx({ accessibleWorkspaceIds: ['ws999'] })),
    );
    await expect(
      g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }, workspaceRequest)),
    ).resolves.toBe(true);
  });

  it('does not lock out platform support, who hold no membership anywhere', async () => {
    // Enforcing C1 required support_access to imply access-all, or the new
    // check would have refused exactly the people it must not.
    const support = composeContext({
      subjectId: 'staff',
      organizationId: 'org1',
      roles: [{ roleKey: 'support', level: 'app', workspaceId: null, features: [FEATURE.platformSupportAccess] }],
      plans: [],
    });
    const g = guard(
      principal,
      jest.fn(async () => support),
    );

    await expect(
      g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.platformSupportAccess] }, workspaceRequest)),
    ).resolves.toBe(true);
  });

  it('asks the access question before the feature question', async () => {
    // Both would deny, but the REASON differs: "you are not in this workspace"
    // and "you lack this right here" need different answers.
    const g = guard(
      principal,
      jest.fn(async () => ctx({ accessibleWorkspaceIds: [], effective: [] })),
    );

    await expect(
      g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }, workspaceRequest)),
    ).rejects.toMatchObject({ response: { reason: 'no_workspace_access' } });
  });

  it('does not ask it at organization level', async () => {
    const g = guard(
      principal,
      jest.fn(async () => ctx({ accessibleWorkspaceIds: [] })),
    );
    await expect(
      g.canActivate(
        execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }, { url: '/organizations/org1/members' }),
      ),
    ).resolves.toBe(true);
  });
});

describe('feature checks and denial reasons', () => {
  it('allows when every required key is held', async () => {
    const g = guard(principal);
    await expect(g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }))).resolves.toBe(true);
  });

  it('denies in ALL mode when one key is missing', async () => {
    const g = guard(principal);
    await expect(
      g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage, FEATURE.billingManage] })),
    ).rejects.toMatchObject({ response: { message: expect.stringContaining('all of') } });
  });

  it('allows in ANY mode when one key is held', async () => {
    const g = guard(principal);
    await expect(
      g.canActivate(
        execution({
          [REQUIRED_FEATURES]: [FEATURE.membersManage, FEATURE.billingManage],
          [REQUIRED_FEATURES_MODE]: 'any',
        }),
      ),
    ).resolves.toBe(true);
  });

  it('carries not_entitled rather than not_granted when the plan is what dropped it', async () => {
    const unentitled = composeContext({
      subjectId: 'u1',
      organizationId: 'org1',
      roles: [{ roleKey: 'admin', level: 'organization', workspaceId: null, features: [FEATURE.billingManage] }],
      plans: [],
    });
    const g = guard(
      principal,
      jest.fn(async () => unentitled),
    );

    // 'ask an admin' and 'upgrade the plan' are different advice, and giving
    // the wrong one sends the ticket to the wrong team.
    await expect(g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.billingManage] }))).rejects.toMatchObject({
      response: { reason: 'not_entitled' },
    });
  });
});

describe('@RequireScope guards the convention itself', () => {
  it('refuses when the declared level disagrees with the resolved one', async () => {
    // A controller mounted a level from where it thinks it is resolves a
    // perfectly valid-looking context for the wrong organization — a silent
    // under-check, so it fails loudly instead.
    const g = guard(principal);
    await expect(
      g.canActivate(
        execution(
          { [REQUIRED_FEATURES]: [FEATURE.membersManage], [REQUIRED_SCOPE]: { level: 'workspace' } },
          { url: '/organizations/org1/members' },
        ),
      ),
    ).rejects.toThrow(/declares workspace scope but the request resolved as organization/);
  });

  it('accepts a declaration that matches', async () => {
    const g = guard(principal);
    await expect(
      g.canActivate(
        execution(
          { [REQUIRED_FEATURES]: [FEATURE.membersManage], [REQUIRED_SCOPE]: { level: 'organization' } },
          { url: '/organizations/org1/members' },
        ),
      ),
    ).resolves.toBe(true);
  });

  it('reads ids from resolver arguments when getArgs is wired, for GraphQL', async () => {
    const loadContext = jest.fn(async () => ctx({ accessibleWorkspaceIds: null }));
    const g = guard({ ...principal, getArgs: () => ({ organizationId: 'orgX', workspaceId: 'wsX' }) }, loadContext);

    await expect(
      g.canActivate(
        execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage], [REQUIRED_SCOPE]: { level: 'workspace' } }),
      ),
    ).resolves.toBe(true);
    expect(loadContext).toHaveBeenCalledWith('u1', { organizationId: 'orgX', workspaceId: 'wsX' });
  });
});

describe('the per-request cache is keyed on SCOPE, not just the request', () => {
  it('reuses a context for a second check at the same scope', async () => {
    const loadContext = jest.fn(async () => ctx());
    const g = guard(principal, loadContext);
    const request = { url: '/organizations/org1/members' };
    const meta = { [REQUIRED_FEATURES]: [FEATURE.membersManage] };

    await g.canActivate(execution(meta, request));
    await g.canActivate(execution(meta, request));

    // One GraphQL operation can ask fifty times; it should pay once.
    expect(loadContext).toHaveBeenCalledTimes(1);
    expect((request as Record<string, unknown>)[PERMISSION_CONTEXT_KEY]).toBeDefined();
  });

  it('does NOT reuse it across scopes within one request', async () => {
    // A cache keyed on the request alone would serve a workspace-scoped answer
    // to an organization-scoped field in the same operation.
    const loadContext = jest.fn(async () => ctx({ accessibleWorkspaceIds: null }));
    const g = guard(principal, loadContext);
    const request = { url: '/organizations/org1/members' };
    const meta = { [REQUIRED_FEATURES]: [FEATURE.membersManage] };

    await g.canActivate(execution(meta, request));
    request.url = '/organizations/org1/workspaces/ws1/data';
    await g.canActivate(execution(meta, request));

    expect(loadContext).toHaveBeenCalledTimes(2);
  });
});

describe('fail closed', () => {
  it('throws ForbiddenException, never returns false, so a denial cannot be read as a pass', async () => {
    const g = guard(
      principal,
      jest.fn(async () => ctx({ effective: [] })),
    );
    await expect(g.canActivate(execution({ [REQUIRED_FEATURES]: [FEATURE.membersManage] }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
