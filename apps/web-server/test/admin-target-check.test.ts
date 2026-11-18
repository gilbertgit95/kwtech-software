import type { PermissionContext } from '@kwtech/module-permissions';
import { createAdminTargetCheck, holdsEveryRightOf } from '../src/auth/admin-target-check.js';

/**
 * ⚠ WHO MAY CHANGE WHOSE ACCOUNT (#175, found in review of the staff roles).
 * Support holds `users:update`, which carries removing a second factor; this
 * is what stops it doing so to a Super admin.
 */
const context = (effective: string[]) => ({ effective }) as unknown as PermissionContext;

const SUPPORT = ['users:read', 'users:update', 'chat:read'];
const SUPER_ADMIN = [...SUPPORT, 'users:disable', 'roles:grant_app'];
const NORMAL = ['chat:read'];

function check(contexts: Record<string, string[] | null>) {
  return createAdminTargetCheck({
    loadContext: async (userId: string) => {
      const found = contexts[userId];
      return found ? context(found) : null;
    },
  });
}

describe('holdsEveryRightOf', () => {
  it('is true when the target holds nothing the actor lacks', () => {
    expect(holdsEveryRightOf(SUPPORT, NORMAL)).toBe(true);
    expect(holdsEveryRightOf(SUPPORT, SUPPORT)).toBe(true);
  });

  it('is false when the target holds one right more', () => {
    expect(holdsEveryRightOf(SUPPORT, SUPER_ADMIN)).toBe(false);
  });
});

describe('createAdminTargetCheck', () => {
  const may = check({ support: SUPPORT, admin: SUPER_ADMIN, customer: NORMAL, nobody: null });

  it('lets Support change an ordinary account', async () => {
    expect(await may('support', 'customer')).toBe(true);
  });

  it("refuses Support a Super admin's account", async () => {
    expect(await may('support', 'admin')).toBe(false);
  });

  it('lets a Super admin change Support', async () => {
    expect(await may('admin', 'support')).toBe(true);
  });

  it('treats an account with no platform role as holding nothing', async () => {
    expect(await may('support', 'nobody')).toBe(true);
  });

  it('lets anyone act on their own account', async () => {
    expect(await may('customer', 'customer')).toBe(true);
  });
});
