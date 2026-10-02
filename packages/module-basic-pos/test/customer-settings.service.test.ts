import { POS_DEFAULT_KEYMAP } from '../src/domain/keymap.js';
import { PosWriteError } from '../src/server/pos.errors.js';
import { ANA, harness, OTHER_STORE, SCOPE } from './harness.js';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PosWriteError) return error.reason;
    throw error;
  }
  return 'no refusal';
}

describe('customers', () => {
  it('saves a customer, and finds them by name, phone, e-mail or Facebook link', async () => {
    const { customers } = harness();
    const juan = await customers.save(SCOPE, ANA, {
      name: 'Juan Dela Cruz',
      phone: '0917 123 4567',
      email: 'juan@example.com',
      facebookUrl: 'facebook.com/juan.delacruz',
    });
    await customers.save(SCOPE, ANA, { name: 'Maria Santos' });
    expect(juan).toMatchObject({
      phone: '0917 123 4567',
      email: 'juan@example.com',
      facebookUrl: 'https://facebook.com/juan.delacruz',
    });
    for (const term of ['jua', '0917', 'example.com', 'juan.delacruz']) {
      expect((await customers.search(SCOPE, term, false)).map((row) => row.name)).toEqual(['Juan Dela Cruz']);
    }
    expect((await customers.search(SCOPE, '', false)).map((row) => row.name)).toEqual([
      'Juan Dela Cruz',
      'Maria Santos',
    ]);
  });

  it('keeps every way of reaching them optional, and clears one saved empty', async () => {
    const { customers } = harness();
    const maria = await customers.save(SCOPE, ANA, { name: 'Maria', phone: '0918' });
    expect(maria).toMatchObject({ phone: '0918', email: null, facebookUrl: null });
    const edited = await customers.save(SCOPE, ANA, { id: maria.id, name: 'Maria', phone: '', email: 'm@x.ph' });
    expect(edited).toMatchObject({ phone: null, email: 'm@x.ph', facebookUrl: null });
  });

  it('⚠ refuses a phone with no number, an e-mail that is not one, and a link that is not Facebook’s', async () => {
    const { customers } = harness();
    expect(await refusal(customers.save(SCOPE, ANA, { name: 'A', phone: 'call me' }))).toBe('invalid_phone');
    expect(await refusal(customers.save(SCOPE, ANA, { name: 'A', email: 'juan at example' }))).toBe('invalid_email');
    expect(await refusal(customers.save(SCOPE, ANA, { name: 'A', facebookUrl: 'https://evil.example/juan' }))).toBe(
      'invalid_facebook',
    );
  });

  it('⚠ escapes the search: "%" finds a literal percent sign, not everybody', async () => {
    const { customers } = harness();
    await customers.save(SCOPE, ANA, { name: 'Juan' });
    expect(await customers.search(SCOPE, '%', false)).toEqual([]);
  });

  it('⚠ never reads or edits another store’s customer', async () => {
    const { customers } = harness();
    const theirs = await customers.save(OTHER_STORE, ANA, { name: 'Theirs' });
    expect(await customers.get(SCOPE, theirs.id)).toBeNull();
    expect(await refusal(customers.save(SCOPE, ANA, { id: theirs.id, name: 'Mine' }))).toBe('not_found');
    expect(await customers.search(SCOPE, 'Theirs', false)).toEqual([]);
  });

  it('archives a customer out of the picker, never deleting them', async () => {
    const { customers, prisma } = harness();
    const juan = await customers.save(SCOPE, ANA, { name: 'Juan' });
    await customers.setArchived(SCOPE, ANA, juan.id, true);
    expect(await customers.search(SCOPE, 'Juan', false)).toEqual([]);
    expect(prisma.state.posCustomer).toHaveLength(1);
  });
});

describe('settings', () => {
  it('gives every default to a store that saved nothing', async () => {
    const { settings } = harness();
    expect(await settings.get(SCOPE)).toEqual({ timeZone: 'Asia/Manila', keymap: POS_DEFAULT_KEYMAP, version: 0 });
  });

  it('saves a keymap, and tells the tills', async () => {
    const { settings, pubsub } = harness();
    const keymap = { ...POS_DEFAULT_KEYMAP, actions: { ...POS_DEFAULT_KEYMAP.actions, pay: 'F10' } };
    const saved = await settings.save(SCOPE, ANA, { keymap });
    expect(saved.version).toBe(1);
    expect(saved.keymap.actions.pay).toBe('F10');
    expect(pubsub.sent.map((event) => event.change)).toEqual(['settings']);
  });

  it('refuses a keymap that takes a browser key — naming the problem', async () => {
    const { settings } = harness();
    const bad = { ...POS_DEFAULT_KEYMAP, actions: { ...POS_DEFAULT_KEYMAP.actions, pay: 'F5' } };
    await expect(settings.save(SCOPE, ANA, { keymap: bad })).rejects.toThrow('belongs to the browser');
  });
});

describe('the workspace’s time zone', () => {
  it('⚠ follows the workspace, not a POS setting', async () => {
    const { settings } = harness({ timeZone: 'Asia/Singapore' });
    expect((await settings.get(SCOPE)).timeZone).toBe('Asia/Singapore');
  });

  it('⚠ falls to Asia/Manila — never UTC — when unbound, unknown or not a real zone', async () => {
    expect((await harness().settings.get(SCOPE)).timeZone).toBe('Asia/Manila');
    expect((await harness({ timeZone: null }).settings.get(SCOPE)).timeZone).toBe('Asia/Manila');
    expect((await harness({ timeZone: 'Mars/Olympus' }).settings.get(SCOPE)).timeZone).toBe('Asia/Manila');
  });
});
