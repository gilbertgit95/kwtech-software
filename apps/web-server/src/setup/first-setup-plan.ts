import {
  checkPassword,
  isPlausibleEmail,
  isPlausibleUsername,
  normaliseEmail,
  normaliseUsername,
} from '@kwtech/module-auth';

/**
 * THE FIRST-SETUP SCRIPT'S DECISIONS, without I/O (#206, #133 P0c): what each
 * answer must look like, the order the roles are asked in, and the summary
 * shown before anything is written. `first-setup.ts` asks and writes; this
 * decides, so the rules are tested without a terminal or a database.
 */

/** A role the loop offers: a system role (no organization) at one level. */
export interface SetupRole {
  id: string;
  key: string;
  label: string;
}

/** One person to create, with the roles chosen for them. */
export interface SetupPerson {
  displayName: string;
  email: string;
  username: string;
  /** Typed hidden; never written anywhere but the credential's hash. */
  password: string;
}

export interface SetupMember extends SetupPerson {
  organizationRole: SetupRole;
  /** Null: a member of the organization with no role in the first workspace. */
  workspaceRole: SetupRole | null;
}

/** Everything the questions gathered, before any write. */
export interface SetupAnswers {
  organization: { name: string; key: string };
  workspace: { name: string; key: string };
  superAdmin: SetupPerson;
  /** The owner first: they found the organization. */
  members: readonly SetupMember[];
}

/** The organization's founder role: asked first, and required (#133 P0c). */
export const OWNER_ROLE_KEY = 'organization-owner';

/** Lower-case letters, digits and single dashes, 2–63 long: what a URL and a person can both say. */
const KEY_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,62}$/;

/** A key suggested from a name: "Sunrise Café" → `sunrise-cafe`. Empty when nothing usable is left. */
export function suggestKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

/** Null when `key` is usable, else the sentence the question repeats. */
export function checkKey(key: string): string | null {
  if (KEY_PATTERN.test(key)) return null;
  return 'Use 2 to 63 lower-case letters, digits and dashes, starting and ending with a letter or digit (e.g. sunrise-cafe).';
}

/** Null when `name` is usable. */
export function checkName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'A name is required.';
  if (trimmed.length > 120) return 'Keep it to 120 characters.';
  return null;
}

/** Null when `email` is a plausible address not already taken by this setup or the database. */
export function checkEmail(email: string, taken: ReadonlySet<string>): string | null {
  const normalised = normaliseEmail(email);
  if (!isPlausibleEmail(normalised)) return 'That is not an email address.';
  if (taken.has(normalised)) return 'That email is already used by another account.';
  return null;
}

/** Null when `username` is usable and not already taken. */
export function checkUsername(username: string, taken: ReadonlySet<string>): string | null {
  const normalised = normaliseUsername(username);
  if (!isPlausibleUsername(normalised)) {
    return "Use 3 to 32 characters: a-z, 0-9, dot, dash or underscore, and no '@'.";
  }
  if (taken.has(normalised)) return 'That username is already used by another account.';
  return null;
}

/**
 * Null when `password` meets the policy the app enforces at a reset.
 *
 * ⚠ REFUSED here, where `seedUser` only warns: an operator re-seeding a local
 * database may choose a weak value on purpose, but a shop's first accounts
 * must be ones the app itself would accept.
 */
export function checkNewPassword(password: string): string | null {
  const complaint = checkPassword(password);
  if (complaint.ok) return null;
  switch (complaint.reason) {
    case 'too_short':
      return 'Use at least 12 characters. A few words together is easiest to remember.';
    case 'too_common':
      return 'That password is too common. Choose another.';
    default:
      return 'That password is not accepted. Choose another.';
  }
}

/**
 * The organization roles in the order they are asked: the owner first (the
 * founder, required), then the rest by label. Every system role at that level
 * is offered, so a role added later is asked about without changing this file.
 */
export function orderOrganizationRoles(roles: readonly SetupRole[]): SetupRole[] {
  const owner = roles.find((role) => role.key === OWNER_ROLE_KEY);
  const rest = roles.filter((role) => role.key !== OWNER_ROLE_KEY).sort((a, b) => a.label.localeCompare(b.label));
  return owner ? [owner, ...rest] : rest;
}

/** Why setup must not run here, or null on a new install (#133: never a second shop, never a reset). */
export function checkNewInstall(state: { organizations: number; superAdmins: number }): string | null {
  if (state.organizations > 0) {
    return 'This install already has an organization, so first setup has been done. Add people and workspaces in the app instead.';
  }
  if (state.superAdmins > 0) {
    return 'This install already has a super admin, so first setup has been done. Sign in as them to continue in the app.';
  }
  return null;
}

/** The summary shown before anything is written: no password, ever. */
export function summaryLines(answers: SetupAnswers): string[] {
  const lines = [
    `Organization  ${answers.organization.name} (${answers.organization.key})`,
    `Workspace     ${answers.workspace.name} (${answers.workspace.key})`,
    '',
    `${answers.superAdmin.displayName} <${normaliseEmail(answers.superAdmin.email)}>  super admin (platform staff, not a member)`,
  ];
  for (const member of answers.members) {
    const workspace = member.workspaceRole
      ? `${answers.workspace.name}: ${member.workspaceRole.label}`
      : `no role in ${answers.workspace.name}`;
    lines.push(
      `${member.displayName} <${normaliseEmail(member.email)}>  ${member.organizationRole.label} · ${workspace}`,
    );
  }
  return lines;
}
