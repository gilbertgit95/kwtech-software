import 'reflect-metadata';
import { denialReason, type PermissionContext } from '../src/index.js';
import { toPermissionContextType } from '../src/server/graphql/permission.types.js';

/**
 * #195: the context the browser reads must carry when the paid plan ended,
 * or every page denied after expiry says "upgrade" instead of "renew".
 */
describe('PermissionContext over GraphQL carries the plan’s end (#195)', () => {
  const context: PermissionContext = {
    subjectId: 'u1',
    organizationId: 'o1',
    workspaceId: 'w1',
    effective: [],
    granted: ['queue:read'],
    entitled: [],
    grantedAtAppLevel: [],
    accessibleWorkspaceIds: ['w1'],
    appRoles: [],
    limits: {},
    subscriptionEndedAt: '2026-11-18T16:00:00.000Z',
  };

  it('sends subscriptionEndedAt, and null when the plan did not end', () => {
    expect(toPermissionContextType(context).subscriptionEndedAt).toBe('2026-11-18T16:00:00.000Z');
    const { subscriptionEndedAt: _ended, ...never } = context;
    expect(toPermissionContextType(never).subscriptionEndedAt).toBeNull();
  });

  it('is what turns the browser’s denial into subscription_expired', () => {
    // The field as the web app receives it, on the context it decides with: the reason follows it.
    const sent = toPermissionContextType(context).subscriptionEndedAt;
    expect(denialReason({ ...context, subscriptionEndedAt: sent }, ['queue:read'])).toBe('subscription_expired');
    expect(denialReason({ ...context, subscriptionEndedAt: null }, ['queue:read'])).toBe('not_entitled');
  });
});
