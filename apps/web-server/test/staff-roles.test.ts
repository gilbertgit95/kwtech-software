import { APP_ROLES, NORMAL_USER_KEY, SUPER_ADMIN_KEY } from '../src/seed/app-roles.js';
import { ALL_FEATURES } from '../src/seed/registry.js';

/**
 * ⚠ PLATFORM STAFF ROLES HOLD EXACTLY THEIR JOB (#175, part of #25).
 *
 * Each staff role is pinned key by key, as `workspace-roles.test.ts` pins the
 * workspace tiers: a module preset that gains a key changes what a staff
 * member may do across EVERY organization, so it must fail here by name and be
 * agreed to in a diff, not arrive with a dependency bump.
 */

const levelOf = (key: string) => ALL_FEATURES.find((spec) => spec.key === key)?.level;
const roleOf = (key: string) => {
  const role = APP_ROLES.find((one) => one.key === key);
  if (!role) throw new Error(`'${key}' is not a seeded role`);
  return role;
};
const normalUser = roleOf(NORMAL_USER_KEY);
/** A staff role's keys beyond a normal user's: the job itself. */
const job = (key: string) =>
  roleOf(key)
    .features.filter((feature) => !normalUser.features.includes(feature))
    .sort();

const STAFF = ['platform-support', 'platform-operations', 'platform-moderator', 'platform-billing-approver'];

describe('each staff role holds its job and nothing more', () => {
  it('Support: enter organizations, find people, get them signed in, read the catalogue', () => {
    expect(job('platform-support')).toEqual(
      [
        'defaults:read',
        'features:read',
        'organizations:read',
        'plans:read',
        'platform:support_access',
        'users:read',
        'users:update',
      ].sort(),
    );
  });

  it('Operations: background processes, making backups, the local network', () => {
    expect(job('platform-operations')).toEqual(
      [
        'backup:create',
        'backup:read',
        'jobs:pause',
        'jobs:read',
        'jobs:run',
        'jobs:schedule',
        'local_network:read',
      ].sort(),
    );
  });

  it('Moderator: moderate chat, run any group, send and recall notices', () => {
    expect(job('platform-moderator')).toEqual(
      [
        'chat:manage_all',
        'chat:moderate',
        'chat:remove_participant',
        'notification:manage',
        'notification:send',
      ].sort(),
    );
  });

  it('Billing approver: the queue, approving and voiding', () => {
    expect(job('platform-billing-approver')).toEqual(
      ['platform-billing:approve', 'platform-billing:queue_read', 'platform-billing:void'].sort(),
    );
  });
});

describe('a staff role replaces Normal user, so it carries what Normal user has', () => {
  /*
   * `assignAppRole` deletes the person's app roles before writing the new one.
   * Without this a person made staff loses their own profile, sign-in
   * settings, chat and inbox the same moment.
   */
  it.each(STAFF)('%s holds every Normal user key, and its limits', (key) => {
    const role = roleOf(key);
    expect(normalUser.features.filter((feature) => !role.features.includes(feature))).toEqual([]);
    for (const [limit, value] of Object.entries(normalUser.limits ?? {})) {
      expect(role.limits?.[limit]).toBeGreaterThanOrEqual(value);
    }
  });
});

describe('staff roles hold only app-level keys', () => {
  /*
   * An app-level grant applies in every organization and skips the plan
   * filter. A tenant key here would be that right in every shop on the
   * platform.
   */
  it.each(STAFF)('%s grants nothing at organization or workspace level', (key) => {
    expect(roleOf(key).features.filter((feature) => levelOf(feature) !== 'app')).toEqual([]);
  });

  it('every app-level role other than Super admin and Normal user is in the staff list', () => {
    const appRoles = APP_ROLES.filter((role) => role.level === 'app').map((role) => role.key);
    expect(appRoles.filter((key) => key !== SUPER_ADMIN_KEY && key !== NORMAL_USER_KEY).sort()).toEqual(
      [...STAFF].sort(),
    );
  });
});
