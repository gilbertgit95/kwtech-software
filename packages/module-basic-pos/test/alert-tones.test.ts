import {
  DEFAULT_POS_ALERT_TONES,
  effectiveAlertTones,
  type PosAlertTones,
  readAlertTones,
  validateAlertTones,
} from '../src/domain/alert-tones.js';
import { PosWriteError } from '../src/server/pos.errors.js';
import { ANA, BEN, harness, OTHER_STORE, SCOPE } from './harness.js';

const QUIET: PosAlertTones = {
  newOrder: { on: true, tone: 'bell', volume: 30 },
  updatedOrder: { on: false, tone: 'ding', volume: 20 },
};

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PosWriteError) return error.reason;
    throw error;
  }
  return 'no refusal';
}

describe('validateAlertTones', () => {
  it('accepts both moments, whole', () => {
    expect(validateAlertTones(QUIET)).toEqual({ tones: QUIET });
  });

  it('refuses a tone that is not built in, a volume out of range, and a missing moment — naming each', () => {
    const checked = validateAlertTones({
      newOrder: { on: true, tone: 'airhorn', volume: 150 },
    });
    expect(checked).toEqual({
      refused: [
        'A new order: “airhorn” is not one of the tones.',
        'A new order: the volume is a whole number from 0 to 100.',
        'An updated order: its sound is missing.',
      ],
    });
  });

  it('refuses nothing at all', () => {
    expect(validateAlertTones(null)).toEqual({ refused: ['The order sounds are missing.'] });
  });
});

describe('readAlertTones', () => {
  it('is every default with nothing stored', () => {
    expect(readAlertTones(null)).toEqual(DEFAULT_POS_ALERT_TONES);
  });

  it('⚠ falls back field by field for what no longer reads — a tone removed since, a volume out of range', () => {
    expect(readAlertTones({ newOrder: { on: false, tone: 'retired', volume: 400 }, updatedOrder: 'junk' })).toEqual({
      newOrder: { on: false, tone: DEFAULT_POS_ALERT_TONES.newOrder.tone, volume: 100 },
      updatedOrder: DEFAULT_POS_ALERT_TONES.updatedOrder,
    });
  });
});

describe('effectiveAlertTones', () => {
  it('plays the person’s own when they kept one, whole, and the store’s otherwise', () => {
    expect(effectiveAlertTones(DEFAULT_POS_ALERT_TONES, QUIET)).toBe(QUIET);
    expect(effectiveAlertTones(QUIET, null)).toBe(QUIET);
  });
});

describe('order sounds, stored', () => {
  it('saves the store’s, which every till reads with its settings, and tells the tills', async () => {
    const { settings, pubsub } = harness();
    expect((await settings.get(SCOPE)).alertTones).toEqual(DEFAULT_POS_ALERT_TONES);
    const saved = await settings.saveAlertTones(SCOPE, ANA, QUIET);
    expect(saved.alertTones).toEqual(QUIET);
    expect(pubsub.sent.at(-1)).toMatchObject({ change: 'settings', actorId: ANA });
  });

  it('⚠ never touches the keymap or the reference options', async () => {
    const { settings } = harness();
    await settings.saveReferenceOptions(SCOPE, ANA, ['Table 1']);
    const before = await settings.get(SCOPE);
    const after = await settings.saveAlertTones(SCOPE, ANA, QUIET);
    expect(after.referenceOptions).toEqual(['Table 1']);
    expect(after.keymap).toEqual(before.keymap);
  });

  it('refuses order sounds the domain refuses', async () => {
    const { settings } = harness();
    expect(await refusal(settings.saveAlertTones(SCOPE, ANA, { newOrder: { on: true } }))).toBe('invalid_alert_tones');
  });

  it('keeps a person’s own, which win over the store’s, until they go back to the store’s', async () => {
    const { settings } = harness();
    await settings.saveAlertTones(SCOPE, ANA, DEFAULT_POS_ALERT_TONES);
    expect(await settings.mySounds(SCOPE, BEN)).toEqual({ store: DEFAULT_POS_ALERT_TONES, mine: null });

    expect(await settings.saveMySounds(SCOPE, BEN, QUIET)).toEqual({ store: DEFAULT_POS_ALERT_TONES, mine: QUIET });
    // Saved twice is still one row.
    await settings.saveMySounds(SCOPE, BEN, QUIET);
    expect((await settings.saveMySounds(SCOPE, BEN, null)).mine).toBeNull();
  });

  it('⚠ keeps each person’s apart, and each store’s', async () => {
    const { settings } = harness();
    await settings.saveMySounds(SCOPE, BEN, QUIET);
    expect((await settings.mySounds(SCOPE, ANA)).mine).toBeNull();
    expect((await settings.mySounds(OTHER_STORE, BEN)).mine).toBeNull();
  });
});
