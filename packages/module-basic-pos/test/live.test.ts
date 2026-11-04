import {
  POS_NOT_LIVE_AFTER_MS,
  posIsLive,
  posLiveChangeIn,
  tillEventKind,
  tillRereads,
} from '../src/react/view/live.js';

const SINCE = 1_000_000;

describe('posIsLive — what the till says about its socket (#50)', () => {
  it('⚠ is not live with a connection that never connects, once the first attempt has run long', () => {
    // The cashier's till in #50: a connection object, and a socket timing out behind it.
    expect(posIsLive(true, 'connecting', SINCE, SINCE + POS_NOT_LIVE_AFTER_MS)).toBe(false);
    expect(posIsLive(true, 'reconnecting', SINCE, SINCE + 60_000)).toBe(false);
  });

  it('stays live through a routine reconnect', () => {
    expect(posIsLive(true, 'reconnecting', SINCE, SINCE + POS_NOT_LIVE_AFTER_MS - 1)).toBe(true);
    expect(posIsLive(true, 'connecting', SINCE, SINCE)).toBe(true);
  });

  it('is not live at once when refused, nor with no connection at all', () => {
    expect(posIsLive(true, 'refused', SINCE, SINCE)).toBe(false);
    expect(posIsLive(false, null, SINCE, SINCE)).toBe(false);
  });

  it('is live when connected or idle, and for a connection that reports no status', () => {
    expect(posIsLive(true, 'live', SINCE, SINCE + 600_000)).toBe(true);
    expect(posIsLive(true, 'idle', SINCE, SINCE)).toBe(true);
    expect(posIsLive(true, null, SINCE, SINCE)).toBe(true);
  });
});

describe('posLiveChangeIn', () => {
  it('says when a reconnect will become long enough to say so, then nothing', () => {
    expect(posLiveChangeIn('reconnecting', SINCE, SINCE + 2_000)).toBe(POS_NOT_LIVE_AFTER_MS - 2_000);
    expect(posLiveChangeIn('reconnecting', SINCE, SINCE + POS_NOT_LIVE_AFTER_MS)).toBeNull();
    expect(posLiveChangeIn('live', SINCE, SINCE)).toBeNull();
    expect(posLiveChangeIn(null, SINCE, SINCE)).toBeNull();
  });
});

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
