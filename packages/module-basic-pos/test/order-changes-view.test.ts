import { POS_ALERT_TONE_IDS } from '../src/domain/alert-tones.js';
import { alertMomentFor, pendingChanges } from '../src/react/view/order-changes.js';
import { noteGain, POS_TONE_PEAK, POS_TONES } from '../src/react/view/tone-notes.js';

const none = new Map<string, number>();

describe('pendingChanges', () => {
  it('⚠ lights nothing on the first read — ten orders waiting must not flash ten times', () => {
    expect(pendingChanges(null, [{ id: 'a', version: 1 }], none).size).toBe(0);
  });

  it('marks an order that arrived as new, and a newer version of one waiting as updated', () => {
    const changes = pendingChanges(
      [
        { id: 'a', version: 1 },
        { id: 'b', version: 3 },
      ],
      [
        { id: 'a', version: 1 },
        { id: 'b', version: 4 },
        { id: 'c', version: 2 },
      ],
      none,
    );
    expect([...changes]).toEqual([
      ['b', 'updated'],
      ['c', 'new'],
    ]);
  });

  it('is nothing for an order that left the list, or one read again unchanged', () => {
    expect(pendingChanges([{ id: 'a', version: 1 }], [], none).size).toBe(0);
    expect(pendingChanges([{ id: 'a', version: 2 }], [{ id: 'a', version: 2 }], none).size).toBe(0);
  });

  it('⚠ never counts this till’s own change: held here, or edited here', () => {
    const own = new Map([
      ['held-here', 3],
      ['edited-here', 5],
    ]);
    const changes = pendingChanges(
      [{ id: 'edited-here', version: 4 }],
      [
        { id: 'held-here', version: 3 },
        { id: 'edited-here', version: 5 },
      ],
      own,
    );
    expect(changes.size).toBe(0);
  });

  it('still counts a seller’s change to an order this till had on it before', () => {
    const own = new Map([['a', 2]]);
    expect([...pendingChanges([{ id: 'a', version: 2 }], [{ id: 'a', version: 3 }], own)]).toEqual([['a', 'updated']]);
  });
});

describe('alertMomentFor', () => {
  it('sounds once per read: a new order’s when anything arrived, an update’s otherwise', () => {
    expect(
      alertMomentFor(
        new Map([
          ['a', 'updated'],
          ['b', 'new'],
        ]),
      ),
    ).toBe('newOrder');
    expect(alertMomentFor(new Map([['a', 'updated']]))).toBe('updatedOrder');
    expect(alertMomentFor(new Map())).toBeNull();
  });
});

describe('the built-in tones', () => {
  it('has notes for every tone id, each short', () => {
    for (const id of POS_ALERT_TONE_IDS) {
      const notes = POS_TONES[id].notes;
      expect(notes.length).toBeGreaterThan(0);
      expect(Math.max(...notes.map((note) => note.at + note.duration))).toBeLessThanOrEqual(1.5);
    }
  });

  it('never goes past the peak, and is silent at volume 0', () => {
    expect(noteGain({ level: 1 }, 100)).toBe(POS_TONE_PEAK);
    expect(noteGain({ level: 1 }, 400)).toBe(POS_TONE_PEAK);
    expect(noteGain({ level: 1 }, 0)).toBe(0);
    expect(noteGain({ level: 0.5 }, 50)).toBeCloseTo(POS_TONE_PEAK / 4);
  });
});
