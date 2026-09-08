import {
  isPlausibleEmail,
  isPlausibleUsername,
  MIN_PASSWORD_LENGTH,
  normaliseEmail,
  normaliseUsername,
} from './policy.js';

/**
 * What an administrator is typing about an account, and what is wrong with it.
 *
 * The counterpart of `role-draft.ts` in @kwtech/module-permissions, and here
 * for the same reason that one exists: the FORM and the WRITE PATH must agree
 * about what is valid, and the only way to guarantee that is to have one
 * function they both call. A form validating separately drifts, and the drift
 * shows up as a save that passes every check on screen and is refused by the
 * server with a message written for a different audience.
 *
 * Pure — no framework, no client, no Nest. It sits in `domain/` so the browser
 * bundle and the resolver can both import it.
 */

export interface UserDraft {
  /**
   * Only meaningful when CREATING. An existing account's address is its
   * identifier — invitations are addressed to it, `findUserByEmail` resolves
   * members by it, and a reset is delivered to it — so changing it silently
   * re-points all three. Doing it safely means a verification round trip to the
   * new address, which is a feature and not a field.
   */
  email: string;
  displayName: string;
  username: string;
  /** Only meaningful when creating. An edit never carries one — see below. */
  password: string;
  confirm: string;
}

export const EMPTY_USER_DRAFT: UserDraft = {
  email: '',
  displayName: '',
  username: '',
  password: '',
  confirm: '',
};

export type UserDraftErrors = Partial<Record<keyof UserDraft, string>>;

export interface ValidateUserOptions {
  /**
   * Creating, rather than editing an existing account.
   *
   * The two modes check genuinely different things — an edit has no address and
   * no password to check — and one flag rather than two functions is what keeps
   * the shared rules (the username, the display name) shared. The same call
   * `validateRoleDraft` makes with its `editing` option.
   */
  creating: boolean;
}

/**
 * Everything wrong with the draft, by field.
 *
 * All of it at once rather than the first problem: a form that reports one
 * error per submit makes somebody submit four times to learn four things.
 */
export function validateUserDraft(draft: UserDraft, options: ValidateUserOptions): UserDraftErrors {
  const errors: UserDraftErrors = {};

  if (options.creating) {
    const email = normaliseEmail(draft.email);
    if (!email) errors.email = 'An email address is required.';
    else if (!isPlausibleEmail(email)) errors.email = 'That does not look like an email address.';

    if (!draft.password) errors.password = 'A password is required.';
    else if (draft.password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    /*
     * Checked HERE and nowhere on the server, and that is correct rather than a
     * gap: it is not a rule about the password, it is a check that the typist
     * typed what they meant, and the server has no second field to compare.
     */
    if (draft.password && draft.confirm !== draft.password) {
      errors.confirm = 'Those two passwords are not the same.';
    }
  }

  /*
   * OPTIONAL, both of them, and empty is a valid answer for each. A username is
   * chosen, not assigned — plenty of accounts have none — and a display name is
   * free text somebody may not have given. Requiring either would make an
   * administrator invent one on somebody else's behalf.
   */
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
