import { EMPTY_USER_DRAFT, hasUserDraftErrors, validateUserDraft } from '../src/domain/user-draft.js';

/**
 * The rules the FORM and the WRITE PATH share.
 *
 * They are tested here rather than through either one, because the value of
 * putting them in `domain/` is that there is a single answer — a test that went
 * through the form would only prove the form agrees with itself.
 */

const creating = { creating: true };
const editing = { creating: false };

const draft = (overrides: Partial<typeof EMPTY_USER_DRAFT> = {}) => ({ ...EMPTY_USER_DRAFT, ...overrides });

describe('creating', () => {
  it('accepts an address, a password typed twice, and nothing else', () => {
    const errors = validateUserDraft(
      draft({ email: 'someone@example.com', password: 'correct horse battery', confirm: 'correct horse battery' }),
      creating,
    );
    expect(hasUserDraftErrors(errors)).toBe(false);
  });

  it('reports everything wrong at once, not the first thing', () => {
    // A form that reports one error per submit makes somebody submit four times
    // to learn four things.
    const errors = validateUserDraft(draft({ email: 'not-an-address', password: 'short', confirm: 'other' }), creating);
    expect(Object.keys(errors).sort()).toEqual(['confirm', 'email', 'password']);
  });

  it('catches the mistyped confirmation, which the server cannot', () => {
    // The server has no second field to compare, so this rule lives only here.
    const errors = validateUserDraft(
      draft({ email: 'a@example.com', password: 'correct horse battery', confirm: 'correct horse batteryy' }),
      creating,
    );
    expect(errors.confirm).toMatch(/not the same/i);
  });
});

describe('editing', () => {
  it('asks for neither an address nor a password', () => {
    /*
     * An existing account's address is its identifier and is not editable, and
     * credentials are changed by sending a RESET rather than by typing one — so
     * an otherwise empty edit draft is valid.
     */
    expect(hasUserDraftErrors(validateUserDraft(draft(), editing))).toBe(false);
  });

  it('still checks the username, which is the one identifier an edit can set', () => {
    expect(validateUserDraft(draft({ username: 'not a username!' }), editing).username).toBeDefined();
    expect(validateUserDraft(draft({ username: 'gilbert.c' }), editing).username).toBeUndefined();
  });
});

describe('both modes', () => {
  it('treats an empty username and display name as valid answers', () => {
    // A username is chosen, not assigned, and plenty of accounts have none.
    // Requiring either would make an administrator invent one for somebody.
    expect(validateUserDraft(draft({ username: '', displayName: '' }), editing)).toEqual({});
  });

  it('refuses a display name long enough to be an essay', () => {
    expect(validateUserDraft(draft({ displayName: 'x'.repeat(200) }), editing).displayName).toBeDefined();
  });
});
