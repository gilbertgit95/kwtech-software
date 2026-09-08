import { EMPTY_USER_DRAFT, hasUserDraftErrors, validateUserDraft } from '../src/domain/user-draft.js';

/**
 * The rules the FORM and the WRITE PATH share.
 *
 * Tested here rather than through either one, because the value of putting them
 * in `domain/` is that there is a single answer — a test that went through the
 * form would only prove the form agrees with itself.
 */

const draft = (overrides: Partial<typeof EMPTY_USER_DRAFT> = {}) => ({ ...EMPTY_USER_DRAFT, ...overrides });

describe('editing a profile', () => {
  it('treats an empty username and display name as valid answers', () => {
    /*
     * A username is chosen, not assigned, and plenty of accounts have none.
     * Requiring either would make an administrator invent one on somebody
     * else's behalf.
     */
    expect(validateUserDraft(draft())).toEqual({});
  });

  it('checks the username, which is the one identifier an edit can set', () => {
    expect(validateUserDraft(draft({ username: 'not a username!' })).username).toBeDefined();
    expect(validateUserDraft(draft({ username: 'gilbert.c' })).username).toBeUndefined();
  });

  it('normalises before checking, so casing is not a rejection', () => {
    // `normaliseUsername` lower-cases; a name typed with capitals is the same
    // name, and refusing it would be a rule about the keyboard.
    expect(validateUserDraft(draft({ username: 'Gilbert.C' })).username).toBeUndefined();
  });

  it('refuses a display name long enough to be an essay', () => {
    expect(validateUserDraft(draft({ displayName: 'x'.repeat(200) })).displayName).toBeDefined();
  });

  it('reports both problems at once, not the first', () => {
    const errors = validateUserDraft(draft({ username: '!!', displayName: 'x'.repeat(200) }));
    expect(Object.keys(errors).sort()).toEqual(['displayName', 'username']);
    expect(hasUserDraftErrors(errors)).toBe(true);
  });
});

describe('what it deliberately does NOT validate', () => {
  it('has no address or password fields at all', () => {
    /*
     * An account is created by whoever accepts an invitation, choosing their
     * own password — so nothing here validates a credential, and the address is
     * the identifier the invitation set rather than a field on a form.
     */
    expect(Object.keys(EMPTY_USER_DRAFT).sort()).toEqual(['displayName', 'username']);
  });
});
