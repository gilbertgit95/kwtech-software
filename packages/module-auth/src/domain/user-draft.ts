import { isPlausibleUsername, normaliseUsername } from './policy.js';

/**
 * What an administrator is typing about an existing account, and what is wrong
 * with it.
 *
 * The counterpart of `role-draft.ts` in @kwtech/module-permissions, and here
 * for the same reason that one exists: the FORM and the WRITE PATH must agree
 * about what is valid, and the only way to guarantee that is to have one
 * function they both call. A form validating separately drifts, and the drift
 * shows up as a save that passes every check on screen and is refused by the
 * server with a message written for a different audience.
 *
 * ## There is no create mode
 *
 * It briefly had one, for a screen that created an account from a form an
 * administrator filled in — including the password. That screen is gone: an
 * account now comes into being when somebody accepts an invitation and chooses
 * their own password, so nothing here validates an address or a credential.
 * `signUpFromInvitation` checks the password, in the module that hashes it.
 *
 * Pure — no framework, no client, no Nest. It sits in `domain/` so the browser
 * bundle and the resolver can both import it.
 */

export interface UserDraft {
  /**
   * Free text, and optional: plenty of accounts have none, and requiring one
   * would make an administrator invent a name on somebody else's behalf.
   */
  displayName: string;
  /** Optional too, and normalised before it is checked. */
  username: string;
}

export const EMPTY_USER_DRAFT: UserDraft = { displayName: '', username: '' };

export type UserDraftErrors = Partial<Record<keyof UserDraft, string>>;

/**
 * Everything wrong with the draft, by field.
 *
 * All of it at once rather than the first problem: a form that reports one
 * error per submit makes somebody submit twice to learn two things.
 *
 * The account's EMAIL is deliberately not here. It is the identifier —
 * invitations are addressed to it, member lookups resolve by it, a reset is
 * delivered to it — so changing it silently re-points all three, and doing it
 * safely needs a verification round trip to the new address. That is a feature,
 * not a field.
 */
export function validateUserDraft(draft: UserDraft): UserDraftErrors {
  const errors: UserDraftErrors = {};

  const username = normaliseUsername(draft.username);
  if (username && !isPlausibleUsername(username)) {
    errors.username = 'Letters, digits, dots, dashes and underscores only, and not starting or ending with one.';
  }

  if (draft.displayName.trim().length > MAX_DISPLAY_NAME) {
    errors.displayName = `Keep it under ${MAX_DISPLAY_NAME} characters.`;
  }

  return errors;
}

export function hasUserDraftErrors(errors: UserDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Long enough for any real name and short enough that the column is not a place
 * to paste an essay. Not enforced by the schema, which is `text` — this is the
 * one check, and it is here rather than in two places.
 */
export const MAX_DISPLAY_NAME = 120;
