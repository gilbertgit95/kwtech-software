import { DEFAULT_EPHEMERAL, PresenceRegistry, TypingRegistry } from '../src/server/chat.ephemeral.js';

/**
 * The three traps every hand-rolled presence system hits, each with a test.
 *
 * Time is a number passed in rather than a clock read, so "thirty seconds
 * later" is an argument instead of a `setTimeout` in a suite.
 */

const START = 1_000_000;
const { graceMs, ttlMs, typingThrottleMs, typingTtlMs } = DEFAULT_EPHEMERAL;

describe('PresenceRegistry — a refcount, not a boolean', () => {
  it('⚠ stays online when ONE of several tabs closes', () => {
    // The trap nobody notices while testing alone: one person is several
    // sockets, and closing one must not take them offline.
    const presence = new PresenceRegistry();
    presence.connect('ann', 'tab-1', START);
    presence.connect('ann', 'tab-2', START);

    presence.disconnect('ann', 'tab-1', START);

    expect(presence.isOnline('ann', START)).toBe(true);
    expect(presence.sweep(START + graceMs + 1)).toEqual([]);
  });

  it('⚠ announces coming online ONCE, however many tabs open', () => {
    // Five tabs must be one event, not five: the fan-out is per conversation
    // partner, so five would be five redraws on everybody else's screen.
    const presence = new PresenceRegistry();

    expect(presence.connect('ann', 'tab-1', START)).toBe(true);
    expect(presence.connect('ann', 'tab-2', START)).toBe(false);
    expect(presence.connect('ann', 'tab-3', START)).toBe(false);
  });
});

describe('PresenceRegistry — the grace period', () => {
  it('⚠ does NOT go offline the moment the last socket closes', () => {
    /*
     * The socket is dropped whenever its access token expires — by design, on a
     * timer nobody controls. Immediate-offline means every user in the system
     * visibly flickers offline every time their token turns over.
     */
    const presence = new PresenceRegistry();
    presence.connect('ann', 'tab-1', START);
    presence.disconnect('ann', 'tab-1', START);

    expect(presence.isOnline('ann', START + graceMs - 1)).toBe(true);
    expect(presence.sweep(START + graceMs - 1)).toEqual([]);
  });

  it('goes offline once the grace has run out', () => {
    const presence = new PresenceRegistry();
    presence.connect('ann', 'tab-1', START);
    presence.disconnect('ann', 'tab-1', START);

    expect(presence.sweep(START + graceMs + 1)).toEqual(['ann']);
    expect(presence.isOnline('ann', START + graceMs + 1)).toBe(false);
  });

  it('⚠ a reconnect inside the grace produces NO events at all', () => {
    // Which is the whole point: a token turning over is not a person leaving.
    const presence = new PresenceRegistry();
    presence.connect('ann', 'tab-1', START);
    presence.disconnect('ann', 'tab-1', START);

    const reconnected = presence.connect('ann', 'tab-2', START + 1_000);

    expect(reconnected).toBe(false);
    expect(presence.sweep(START + graceMs + 1)).toEqual([]);
  });

  it('reports offline only once, not on every sweep', () => {
    const presence = new PresenceRegistry();
    presence.connect('ann', 'tab-1', START);
    presence.disconnect('ann', 'tab-1', START);

    expect(presence.sweep(START + graceMs + 1)).toEqual(['ann']);
    expect(presence.sweep(START + graceMs + 2)).toEqual([]);
  });
});

describe('PresenceRegistry — the socket that never says goodbye', () => {
  it('⚠ expires a socket nobody has heard from', () => {
    // A closed laptop lid delivers no close event. Presence that trusted a
    // farewell would leave that person online forever.
    const presence = new PresenceRegistry();
    presence.connect('ann', 'tab-1', START);

    expect(presence.isOnline('ann', START + ttlMs + 1)).toBe(false);
    expect(presence.sweep(START + ttlMs + 1)).toEqual(['ann']);
  });

  it('believes a socket that keeps saying it is there', () => {
    const presence = new PresenceRegistry();
    presence.connect('ann', 'tab-1', START);

    presence.touch('ann', 'tab-1', START + ttlMs - 1);

    expect(presence.isOnline('ann', START + ttlMs + 1)).toBe(true);
  });

  it('⚠ one dead socket does not take a live one with it', () => {
    const presence = new PresenceRegistry();
    presence.connect('ann', 'laptop', START);
    presence.connect('ann', 'phone', START);

    presence.touch('ann', 'phone', START + ttlMs);

    // The laptop has gone quiet; the phone has not.
    expect(presence.isOnline('ann', START + ttlMs + 1)).toBe(true);
  });
});

describe('PresenceRegistry — reading it', () => {
  it('answers for a page of people in one pass', () => {
    const presence = new PresenceRegistry();
    presence.connect('ann', 'tab-1', START);
    presence.connect('cat', 'tab-1', START);

    expect(presence.onlineAmong(['ann', 'bob', 'cat'], START)).toEqual(['ann', 'cat']);
  });

  it('says nothing about somebody who has never connected', () => {
    expect(new PresenceRegistry().isOnline('stranger', START)).toBe(false);
  });
});

describe('TypingRegistry — it expires, it is never stopped', () => {
  it('⚠ throttles repeated pings into one announcement', () => {
    // One per person per conversation every few seconds, fanned out to every
    // participant, is the highest-frequency write in the product.
    const typing = new TypingRegistry();

    expect(typing.shouldAnnounce('c1', 'ann', START)).toBe(true);
    expect(typing.shouldAnnounce('c1', 'ann', START + typingThrottleMs - 1)).toBe(false);
    expect(typing.shouldAnnounce('c1', 'ann', START + typingThrottleMs + 1)).toBe(true);
  });

  it('throttles per conversation, not per person', () => {
    const typing = new TypingRegistry();

    expect(typing.shouldAnnounce('c1', 'ann', START)).toBe(true);
    // Writing in two conversations at once is two different facts.
    expect(typing.shouldAnnounce('c2', 'ann', START)).toBe(true);
  });

  it('⚠ CLEARS BY EXPIRY, because a tab closing mid-word sends nothing', () => {
    const typing = new TypingRegistry();
    typing.shouldAnnounce('c1', 'ann', START);

    expect(typing.typingIn('c1', START + typingTtlMs - 1)).toEqual(['ann']);
    expect(typing.typingIn('c1', START + typingTtlMs + 1)).toEqual([]);
  });

  it('⚠ the indicator outlives the throttle, or it would flicker between pings', () => {
    // The one relationship between these two numbers that has to hold.
    expect(typingTtlMs).toBeGreaterThan(typingThrottleMs);
  });

  it('keeps two conversations apart', () => {
    const typing = new TypingRegistry();
    typing.shouldAnnounce('c1', 'ann', START);
    typing.shouldAnnounce('c2', 'bob', START);

    expect(typing.typingIn('c1', START)).toEqual(['ann']);
    expect(typing.typingIn('c2', START)).toEqual(['bob']);
  });

  it('⚠ forgets everything somebody was typing when they go offline', () => {
    // An indicator that outlives the person it describes is the same bug as a
    // presence row that outlives the process.
    const typing = new TypingRegistry();
    typing.shouldAnnounce('c1', 'ann', START);
    typing.shouldAnnounce('c2', 'ann', START);
    typing.shouldAnnounce('c1', 'bob', START);

    typing.forget('ann');

    expect(typing.typingIn('c1', START)).toEqual(['bob']);
    expect(typing.typingIn('c2', START)).toEqual([]);
  });

  it('⚠ forgetting one person cannot match another by coincidence', () => {
    // The keys are joined by NUL precisely so that a conversation id ending the
    // way a user id does cannot be mistaken for it.
    const typing = new TypingRegistry();
    typing.shouldAnnounce('room-ann', 'bob', START);

    typing.forget('ann');

    expect(typing.typingIn('room-ann', START)).toEqual(['bob']);
  });
});
