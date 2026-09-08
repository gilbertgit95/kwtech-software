/**
 * Inviting somebody to an organization, as pure decisions.
 *
 * An invitation is addressed to an EMAIL, not to a user — that is the whole
 * reason it exists rather than being a membership with a status. The person may
 * have no account, and creating a placeholder one to hold a membership would
 * put a fake person in every count, every seat cap and every members list.
 */

/**
 * The states an invitation can be IN, as opposed to the three the column
 * stores.
 *
 * `expired` is derived rather than written — see `invitationState`. Everything
 * that reads an invitation has to agree about it, so it is computed in one
 * place from the timestamp instead of being a value something has to remember
 * to set.
 */
export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'declined' | 'expired';

/** What the column holds. `expired` is never one of these. */
export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

export const INVITATION_STATUSES: readonly InvitationStatus[] = ['pending', 'accepted', 'revoked'];

/**
 * How long an invitation is good for. SEVEN DAYS.
 *
 * Long enough to survive a holiday and a forwarded email; short enough that a
 * mailbox compromised months later does not yield a way into an organization.
 * A password reset lives an hour because it is sent to somebody who asked for
 * it seconds ago; an invitation is sent to somebody who was not expecting it,
 * so the window has to allow for a human noticing.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Normalised the same way `auth_user.email` is stored.
 *
 * Doing it differently would mean an invitation to `Alice@Acme.com` never
 * matching a sign-up as `alice@acme.com` — the bug that only appears for the
 * one person whose mail client capitalises, and only on the day they try to
 * join.
 */
export function normaliseInviteEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Deliberately loose, and that is a decision rather than laziness.
 *
 * The only test that matters is whether mail arrives, which no regular
 * expression can answer. A strict pattern's failures are all false negatives —
 * real addresses it refuses — and each one is somebody who cannot be invited
 * for a reason nobody can explain. This rejects what is obviously not an
 * address and leaves the rest to the mail server.
 */
export function isPlausibleInviteEmail(value: string): boolean {
  const email = normaliseInviteEmail(value);
  if (email.length < 3 || email.length > 320) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  // One '@', not first, not last, and something with a dot after it.
  return at > 0 && at === email.lastIndexOf('@') && at < email.length - 1;
}

export interface InvitationDraft {
  email: string;
  /** The organization role to grant on acceptance. Empty means none. */
  roleId: string;
  /**
   * The organization to join. Empty means a PLATFORM invitation — an offer to
   * hold an app-level role and no membership anywhere.
   *
   * The members screen leaves this alone and passes the organization
   * separately; it is here for the platform invite screen, which lets the
   * administrator choose one or none in the same form.
   */
  organizationId?: string;
  /**
   * The APP-level role to grant on acceptance.
   *
   * Empty means none, which is what every invitation written by the members
   * screen carries — a tenant administrator does not hand out platform rights.
   * The platform invite screen requires one, and enforces that itself: at this
   * layer an empty value is only invalid when the caller says so, because the
   * two screens genuinely disagree about it.
   */
  appRoleId?: string;
}

export const EMPTY_INVITATION_DRAFT: InvitationDraft = { email: '', roleId: '' };

export type InvitationDraftErrors = Partial<Record<keyof InvitationDraft, string>>;

export interface ValidateInvitationOptions {
  /** Organization-level role ids that may be offered. Omit to skip the check. */
  roleIds?: readonly string[];
  /** Addresses with a PENDING invitation already. See the note below. */
  pendingEmails?: readonly string[];
  /** App-level role ids that may be offered. Omit to skip the check. */
  appRoleIds?: readonly string[];
  /**
   * Whether an app-level role must be chosen.
   *
   * True for the platform invite screen, false for the members screen — and it
   * is an OPTION rather than a rule because the two are different offers. An
   * invitation to an organization grants a membership and needs no platform
   * right; an invitation to the platform grants nothing at all without one, and
   * would land somebody on an account they cannot even rename.
   */
  requireAppRole?: boolean;
}

/**
 * Everything wrong with a draft, all at once.
 *
 * ⚠ It does NOT check whether the address already belongs to a member. It
 * cannot: that means resolving an email to a userId, which reads `auth_user` —
 * a table this module does not own and may not import (§12.12). The screen
 * checks it by composing the app's user lookup with the member list, and
 * `acceptInvitation` is idempotent for somebody who is already in, so the worst
 * case is a wasted email rather than a broken row.
 */
export function validateInvitationDraft(
  draft: InvitationDraft,
  options: ValidateInvitationOptions = {},
): InvitationDraftErrors {
  const errors: InvitationDraftErrors = {};
  const email = normaliseInviteEmail(draft.email);

  if (!email) errors.email = 'An email address is required.';
  else if (!isPlausibleInviteEmail(email)) errors.email = 'That does not look like an email address.';
  else if (options.pendingEmails?.includes(email)) {
    /*
     * One PENDING invitation per address per OFFER — per organization for an
     * organization invitation, and across the platform ones for a platform
     * invitation. A second is not an error of fact, the row would be valid; it
     * is that two live links to the same place make "which one did they use"
     * unanswerable, and revoking one would leave the other working.
     *
     * The two are separate buckets deliberately. A platform invitation and an
     * invitation to an organization are different offers to the same person,
     * and letting either block the other would mean an administrator could not
     * invite a colleague to a tenant because somebody had already invited them
     * to the platform.
     */
    errors.email = 'That address already has an invitation waiting.';
  }

  if (draft.roleId && options.roleIds && !options.roleIds.includes(draft.roleId)) {
    errors.roleId = 'That role does not exist, or is not an organization role.';
  }

  if (options.requireAppRole && !draft.appRoleId) {
    errors.appRoleId = 'Choose what this person may do on the platform.';
  } else if (draft.appRoleId && options.appRoleIds && !options.appRoleIds.includes(draft.appRoleId)) {
    errors.appRoleId = 'That role does not exist, or is not an app-level role.';
  }

  /*
   * An organization ROLE without an organization is a contradiction: there is
   * no membership for it to sit on. Caught here rather than at the write, so
   * the form can say which of the two fields to change.
   */
  if (draft.roleId && draft.organizationId === '') {
    errors.roleId = 'Choose an organization before choosing a role in it.';
  }

  return errors;
}

/**
 * What an invitation actually IS right now, as opposed to what its column says.
 *
 * ONE implementation, because the list screen, the accept path and any future
 * reminder job must agree. An invitation that reads `pending` in a table and is
 * refused on use — or worse, the reverse — is the disagreement that makes
 * somebody doubt the whole feature.
 */
export function invitationState(
  invitation: { status: string; expiresAt: Date | string },
  now: Date = new Date(),
): InvitationState {
  if (invitation.status === 'accepted') return 'accepted';
  if (invitation.status === 'revoked') return 'revoked';
  // Refused by the person invited, as opposed to withdrawn by the sender. Both
  // are dead ends and `isAcceptable` treats them alike; they are two statuses
  // because "they said no" and "we changed our mind" are different answers to
  // "why is this person not in the organization".
  if (invitation.status === 'declined') return 'declined';

  const expiresAt = invitation.expiresAt instanceof Date ? invitation.expiresAt : new Date(invitation.expiresAt);
  // An unparseable date is treated as expired, which is the safe direction: a
  // link that cannot be shown to be live is not one to honour.
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) return 'expired';

  return 'pending';
}

/** Whether an invitation may still be accepted. The only question the accept path asks. */
export function isAcceptable(
  invitation: { status: string; expiresAt: Date | string },
  now: Date = new Date(),
): boolean {
  return invitationState(invitation, now) === 'pending';
}
