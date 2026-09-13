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
  it('offers between three and five, each with notes and a label', () => {
    // Fewer is not a choice; more is a menu nobody reads.
    expect(CHAT_TONES.length).toBeGreaterThanOrEqual(3);
    expect(CHAT_TONES.length).toBeLessThanOrEqual(5);
    for (const tone of CHAT_TONES) {
      expect(tone.label.length).toBeGreaterThan(0);
      expect(tone.notes.length).toBeGreaterThan(0);
    }
  });

  /** ⚠ A notification that outlasts the glance is a notification people mute. */
  it('⚠ keeps every tone under a third of a second', () => {
    for (const tone of CHAT_TONES) {
      const end = Math.max(...tone.notes.map((note) => note.at + note.ms));
      expect(end).toBeLessThanOrEqual(300);
    }
  });

  it('has unique ids, and a default that is one of them', () => {
    const ids = CHAT_TONES.map((tone) => tone.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isChatToneId(DEFAULT_CHAT_TONE)).toBe(true);
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
