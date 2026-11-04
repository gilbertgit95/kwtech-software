import { tillEventKind, tillRereads } from '../src/react/view/live.js';

describe('the till’s events (#50)', () => {
  const nothing = { catalogue: false, stock: false, settings: false, pending: false, order: false };

  it('an order held elsewhere reloads the pending column, not the order on this till', () => {
    const kind = tillEventKind({ kind: 'order', orderId: 'held-elsewhere' }, 'on-this-till');
    expect(kind).toBe('order');
    expect(tillRereads(new Set([kind]))).toEqual({ ...nothing, pending: true });
  });

  it('⚠ a change to the order ON this till reloads it too — no paying on an old version', () => {
    const kind = tillEventKind({ kind: 'order', orderId: 'on-this-till' }, 'on-this-till');
    expect(kind).toBe('current');
    expect(tillRereads(new Set([kind]))).toEqual({ ...nothing, pending: true, order: true });
  });

  it('a clear till files every order event as just an order', () => {
    expect(tillEventKind({ kind: 'order', orderId: 'any' }, null)).toBe('order');
  });

  it('references edited on Items reload the settings the Sell tab’s dialog reads', () => {
    expect(tillRereads(new Set(['settings']))).toEqual({ ...nothing, settings: true });
  });

  it('a catalogue change reloads the items and their counts; a stock change the counts alone', () => {
    expect(tillRereads(new Set(['catalogue']))).toEqual({ ...nothing, catalogue: true, stock: true });
    expect(tillRereads(new Set(['stock']))).toEqual({ ...nothing, stock: true });
  });

  it('sync — a reconnect, Sell opened again, the window back — reads everything', () => {
    expect(tillRereads(new Set(['sync']))).toEqual({
      catalogue: true,
      stock: true,
      settings: true,
      pending: true,
      order: true,
    });
  });

  it('a burst is one set of reads', () => {
    expect(tillRereads(new Set(['order', 'settings', 'customers']))).toEqual({
      ...nothing,
      settings: true,
      pending: true,
    });
  });
});
