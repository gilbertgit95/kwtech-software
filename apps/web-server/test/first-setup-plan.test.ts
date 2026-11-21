import {
  checkEmail,
  checkKey,
  checkName,
  checkNewInstall,
  checkNewPassword,
  checkUsername,
  orderOrganizationRoles,
  type SetupAnswers,
  suggestKey,
  summaryLines,
} from '../src/setup/first-setup-plan.js';

/** #206 (#133 P0c): the first-setup script's rules, without a terminal or a database. */

describe('keys', () => {
  it('suggests a key from a name, accents and punctuation dropped', () => {
    expect(suggestKey('Sunrise Café')).toBe('sunrise-cafe');
    expect(suggestKey('  Ben & Cara’s Print Shop!! ')).toBe('ben-cara-s-print-shop');
    expect(suggestKey('!!!')).toBe('');
  });

  it('accepts what it suggests, and refuses capitals, spaces and edge dashes', () => {
    expect(checkKey(suggestKey('Sunrise Café'))).toBeNull();
    for (const bad of ['Sunrise', 'sun rise', '-sunrise', 'sunrise-', 'a', 'sun--rise'])
      expect(checkKey(bad)).not.toBeNull();
  });
});

describe('answers about people', () => {
  it('refuses an empty name', () => {
    expect(checkName('  ')).toBe('A name is required.');
    expect(checkName('Ana Reyes')).toBeNull();
  });

  it('refuses an email or username already taken, compared as the app stores them', () => {
    expect(checkEmail('Ana@Shop.test', new Set(['ana@shop.test']))).toBe(
      'That email is already used by another account.',
    );
    expect(checkEmail('not-an-email', new Set())).toBe('That is not an email address.');
    expect(checkUsername('Ana', new Set(['ana']))).toBe('That username is already used by another account.');
    expect(checkUsername('a@b', new Set())).not.toBeNull();
  });

  it('⚠ refuses a password the app would refuse at a reset (seedUser only warns)', () => {
    expect(checkNewPassword('short')).toMatch(/at least 12 characters/);
    expect(checkNewPassword('plum orchard lantern 42')).toBeNull();
  });
});

describe('the role loop', () => {
  it('asks the owner first, then every other organization role by label', () => {
    const ordered = orderOrganizationRoles([
      { id: '3', key: 'organization-user', label: 'Organization user' },
      { id: '1', key: 'organization-owner', label: 'Organization owner' },
      { id: '2', key: 'organization-admin', label: 'Organization admin' },
      { id: '4', key: 'organization-cashier', label: 'Cashier' },
    ]);
    expect(ordered.map((role) => role.key)).toEqual([
      'organization-owner',
      'organization-cashier',
      'organization-admin',
      'organization-user',
    ]);
  });
});

describe('a new install only', () => {
  it('refuses once an organization or a super admin exists, saying where to go instead', () => {
    expect(checkNewInstall({ organizations: 0, superAdmins: 0 })).toBeNull();
    expect(checkNewInstall({ organizations: 1, superAdmins: 0 })).toMatch(/first setup has been done/);
    expect(checkNewInstall({ organizations: 0, superAdmins: 1 })).toMatch(/Sign in as them/);
  });
});

describe('the summary', () => {
  const answers: SetupAnswers = {
    organization: { name: 'Sunrise Café', key: 'sunrise-cafe' },
    workspace: { name: 'Counter', key: 'counter' },
    superAdmin: { displayName: 'Ana Reyes', email: 'Ana@Shop.test', username: 'ana', password: 'secret ana password' },
    members: [
      {
        displayName: 'Ben Cruz',
        email: 'ben@shop.test',
        username: 'ben',
        password: 'secret ben password',
        organizationRole: { id: '1', key: 'organization-owner', label: 'Organization owner' },
        workspaceRole: { id: 'w1', key: 'workspace-admin', label: 'Workspace admin' },
      },
      {
        displayName: 'Cara Lim',
        email: 'cara@shop.test',
        username: 'cara',
        password: 'secret cara password',
        organizationRole: { id: '3', key: 'organization-user', label: 'Organization user' },
        workspaceRole: null,
      },
    ],
  };

  it('lists the organization, the workspace and each person with their roles', () => {
    expect(summaryLines(answers)).toEqual([
      'Organization  Sunrise Café (sunrise-cafe)',
      'Workspace     Counter (counter)',
      '',
      'Ana Reyes <ana@shop.test>  super admin (platform staff, not a member)',
      'Ben Cruz <ben@shop.test>  Organization owner · Counter: Workspace admin',
      'Cara Lim <cara@shop.test>  Organization user · no role in Counter',
    ]);
  });

  it('⚠ never shows a password', () => {
    expect(summaryLines(answers).join('\n')).not.toMatch(/secret/);
  });
});
