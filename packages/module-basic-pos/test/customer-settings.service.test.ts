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
  it('saves a customer, and finds them by name or contact', async () => {
    const { customers } = harness();
    await customers.save(SCOPE, ANA, { name: 'Juan Dela Cruz', contact: '0917 123 4567' });
    await customers.save(SCOPE, ANA, { name: 'Maria Santos' });
    expect((await customers.search(SCOPE, 'jua', false)).map((row) => row.name)).toEqual(['Juan Dela Cruz']);
    expect((await customers.search(SCOPE, '0917', false)).map((row) => row.name)).toEqual(['Juan Dela Cruz']);
    expect((await customers.search(SCOPE, '', false)).map((row) => row.name)).toEqual([
      'Juan Dela Cruz',
      'Maria Santos',
    ]);
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
