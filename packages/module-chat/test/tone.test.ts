import { shouldPlayTone, type ToneDecision } from '../src/domain/tone.js';
import { CHAT_TONES, DEFAULT_CHAT_TONE, isChatToneId } from '../src/react/chat-tone.js';

/**
 * ── WHETHER A MESSAGE MAKES A SOUND ────────────────────────────────────────
 *
 * Every `false` here is a complaint somebody would otherwise make, which is why
 * the rule is a pure function in the domain rather than four conditions tangled
 * into a socket handler.
 */

const arriving = (over: Partial<ToneDecision> = {}): ToneDecision => ({
  viewerId: 'ann',
  authorId: 'bob',
  conversationId: 'c1',
  openConversationId: null,
  windowFocused: true,
  availability: 'available',
  enabled: true,
  ...over,
});

describe('shouldPlayTone', () => {
  it('plays for somebody else’s message in a conversation you are not looking at', () => {
    expect(shouldPlayTone(arriving())).toBe(true);
  });

  it('stays silent when the device setting is off', () => {
    expect(shouldPlayTone(arriving({ enabled: false }))).toBe(false);
  });

  /** ⚠ It beeps when YOU press send — in every tab you have open. */
  it('⚠ never plays for your own message', () => {
    expect(shouldPlayTone(arriving({ authorId: 'ann' }))).toBe(false);
  });

  /**
   * A system message has no author. "X left the conversation" is addressed to
   * nobody, and the same rule already keeps it out of the unread count.
   */
  it('never plays for a system message', () => {
    expect(shouldPlayTone(arriving({ authorId: null }))).toBe(false);
  });

  /**
   * ⚠ BOTH HALVES ARE REQUIRED, and this is the pair that is easy to get wrong.
   * Open-and-focused means you are watching it arrive. Open in a BACKGROUND tab
   * is not — you are somewhere else entirely, which is exactly when being told
   * matters.
   */
  it('⚠ stays silent only when the conversation is open AND the window focused', () => {
    expect(shouldPlayTone(arriving({ openConversationId: 'c1', windowFocused: true }))).toBe(false);
    expect(shouldPlayTone(arriving({ openConversationId: 'c1', windowFocused: false }))).toBe(true);
    expect(shouldPlayTone(arriving({ openConversationId: 'c2', windowFocused: true }))).toBe(true);
  });

  /**
   * ⚠ THE WHOLE OF WHAT `dnd` CAN HONESTLY DO until a notification system
   * exists (§12.44). It is checked per arrival rather than by hiding the
   * setting, because availability changes while the setting stays put.
   */
  it('⚠ stays silent on Do not disturb, whatever the setting says', () => {
    expect(shouldPlayTone(arriving({ availability: 'dnd' }))).toBe(false);
  });

  it('plays on every other availability, including invisible', () => {
    for (const availability of ['available', 'away', 'busy', 'invisible', null]) {
      expect(shouldPlayTone(arriving({ availability }))).toBe(true);
    }
  });
});

describe('the tone catalogue', () => {
  it('offers a range without becoming a list nobody reads', () => {
    // Fewer than three is not a choice. More than a dozen is a scroll, and
    // every one of these has to be auditioned one at a time to be chosen.
    expect(CHAT_TONES.length).toBeGreaterThanOrEqual(3);
    expect(CHAT_TONES.length).toBeLessThanOrEqual(12);

    for (const tone of CHAT_TONES) {
      expect(tone.label.length).toBeGreaterThan(0);
      expect(tone.notes.length).toBeGreaterThan(0);
    }
  });

  /** ⚠ A notification that outlasts the glance is a notification people mute. */
  it('⚠ keeps every tone short', () => {
    for (const tone of CHAT_TONES) {
      const end = Math.max(...tone.notes.map((note) => note.at + note.ms));
      // 400 rather than 300 since tones gained decay tails, which are mostly
      // inaudible — but a notification is still under half a second, always.
      expect(end).toBeLessThanOrEqual(400);
    }
  });

  it('has unique ids, and a default that is one of them', () => {
    const ids = CHAT_TONES.map((tone) => tone.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isChatToneId(DEFAULT_CHAT_TONE)).toBe(true);
  });

  /**
   * ⚠ THE TRAP IN THE WEB AUDIO API, and the one a catalogue entry can spring
   * without anybody noticing. `exponentialRampToValueAtTime` THROWS on a
   * non-positive target, so a sweep written with `toHz: 0` — or a typo that
   * produced one — would fail at the moment a message arrives, inside the
   * try/catch that exists to keep a tone from breaking a render. It would be
   * silent, and the tone would simply never play.
   */
  it('⚠ gives every frequency a positive value, because a zero would throw at playback', () => {
    for (const tone of CHAT_TONES) {
      for (const note of tone.notes) {
        expect(note.hz).toBeGreaterThan(0);
        if (note.toHz !== undefined) expect(note.toHz).toBeGreaterThan(0);
      }
    }
  });

  /** Levels are relative to the one peak gain, so anything outside 0..1 is a bug. */
  it('keeps every relative level inside its range, and every note audible', () => {
    for (const tone of CHAT_TONES) {
      for (const note of tone.notes) {
        expect(note.ms).toBeGreaterThan(0);
        if (note.level !== undefined) {
          expect(note.level).toBeGreaterThan(0);
          expect(note.level).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  /**
   * ⚠ NAMED FOR WHAT THEY SOUND LIKE, NEVER FOR A PRODUCT. These are original
   * sounds in a familiar genre, not imitations of a specific app's asset —
   * which somebody owns — and a tone named after another messenger sets an
   * expectation this cannot meet.
   */
  it('⚠ names no tone after a product', () => {
    const brands = ['messenger', 'whatsapp', 'slack', 'discord', 'imessage', 'telegram', 'signal', 'teams'];
    for (const tone of CHAT_TONES) {
      const name = `${tone.id} ${tone.label}`.toLowerCase();
      for (const brand of brands) expect(name).not.toContain(brand);
    }
  });

  /**
   * ⚠ A stored id this build no longer ships must be rejected on the way IN,
   * not discovered at the moment a message arrives — the one moment there is
   * nothing useful to do about it.
   */
  it('⚠ refuses an id it does not ship', () => {
    expect(isChatToneId('fanfare')).toBe(false);
    expect(isChatToneId(undefined)).toBe(false);
    expect(isChatToneId(42)).toBe(false);
  });
});
