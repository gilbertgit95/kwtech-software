import {
  clearAtFrom,
  effectiveAvailability,
  isAvailability,
  mayAnnounceTyping,
  publishedPresence,
} from '../src/domain/availability.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');

describe('effectiveAvailability', () => {
  it('is `available` for somebody who has never said anything', () => {
    // Not a special state — they simply have not answered the question.
    expect(effectiveAvailability(null, NOW)).toBe('available');
  });

  it('is whatever they declared, with no timer', () => {
    expect(effectiveAvailability({ availability: 'busy', clearAt: null }, NOW)).toBe('busy');
  });

  it('⚠ treats an EXPIRED clearAt as unset, ON READ', () => {
    /*
     * There is no scheduler in this server, so a written `expired` would have
     * nothing to write it and the row would read `busy` for the rest of the
     * year. Storing the moment and comparing here is the whole mechanism.
     */
    const expired = new Date(NOW.getTime() - 1);
    expect(effectiveAvailability({ availability: 'busy', clearAt: expired }, NOW)).toBe('available');
  });

  it('still holds while the timer is running', () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(effectiveAvailability({ availability: 'dnd', clearAt: later }, NOW)).toBe('dnd');
  });

  it('clears exactly ON the moment, not a millisecond after', () => {
    expect(effectiveAvailability({ availability: 'busy', clearAt: NOW }, NOW)).toBe('available');
  });
});

describe('publishedPresence', () => {
  it('says online and what they declared', () => {
    expect(publishedPresence('busy', true)).toEqual({ online: true, availability: 'busy' });
  });

  it('⚠ says NOTHING rather than `available` when somebody is offline', () => {
    // `available` as a stand-in for "we are not telling you" is a green dot on
    // somebody who is not there.
    expect(publishedPresence('available', false)).toEqual({ online: false, availability: null });
  });

  it('⚠ renders an INVISIBLE person indistinguishable from an offline one', () => {
    /*
     * Applied at the PUBLISH boundary, never client-side. A client that
     * received "online, but do not show it" has been told — the information is
     * in a payload anybody can read, and the promise is already broken.
     */
    expect(publishedPresence('invisible', true)).toEqual(publishedPresence('available', false));
  });
});

describe('mayAnnounceTyping', () => {
  it('⚠ suppresses typing for an invisible person', () => {
    // Typing is the louder signal: it says not only that somebody is there but
    // that they are writing to you. Hiding presence and leaking this is the
    // side door.
    expect(mayAnnounceTyping('invisible')).toBe(false);
  });

  it('allows it for every other state, dnd included', () => {
    // `dnd` quietens what reaches YOU. It is not a claim to be absent.
    expect(mayAnnounceTyping('dnd')).toBe(true);
    expect(mayAnnounceTyping('away')).toBe(true);
    expect(mayAnnounceTyping('available')).toBe(true);
  });
});

describe('clearAtFrom', () => {
  it('turns minutes into a moment', () => {
    expect(clearAtFrom(30, NOW)?.toISOString()).toBe('2026-09-11T12:30:00.000Z');
  });

  it('⚠ is null for somebody who did not ask for a timer', () => {
    // Not "expired immediately", which would clear the setting they just made.
    expect(clearAtFrom(null, NOW)).toBeNull();
    expect(clearAtFrom(0, NOW)).toBeNull();
    expect(clearAtFrom(-5, NOW)).toBeNull();
  });

  it('refuses a number that is not one', () => {
    expect(clearAtFrom(Number.NaN, NOW)).toBeNull();
    expect(clearAtFrom(Number.POSITIVE_INFINITY, NOW)).toBeNull();
  });
});

describe('isAvailability', () => {
  it('accepts the vocabulary and nothing else', () => {
    expect(isAvailability('dnd')).toBe(true);
    // The guard the GraphQL layer leans on: the field is a String, so anything
    // can arrive.
    expect(isAvailability('asleep')).toBe(false);
    expect(isAvailability(null)).toBe(false);
  });
});
