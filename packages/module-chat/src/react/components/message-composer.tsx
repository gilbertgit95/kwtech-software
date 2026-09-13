'use client';

import { cn } from '@kwtech/web-ui/react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { MAX_BODY_CODE_POINTS } from '../../domain/messages.js';
import {
  type ChatSettings,
  DEFAULT_CHAT_SETTINGS,
  readChatSettings,
  resolveQuickEmoji,
  writeChatSettings,
} from '../chat-settings.js';
import { insertEmoji, withRecentEmoji } from '../emoji.js';
import { EmojiPicker } from './emoji-picker.js';

/**
 * Writing a message.
 *
 * ⚠ THE CAP IS COUNTED IN CODE POINTS, from the module's own domain constant —
 * not `value.length`, which counts UTF-16 units. A 4000-unit cap cuts a message
 * of 2000 emoji in half, and the first report of it comes from exactly the
 * people most likely to use them. `[...value]` iterates code points, which is
 * the same thing the server's `prepareBody` measures, so the counter here and
 * the refusal there agree.
 *
 * ⚠ EMOJI NEED NO PICKER AND NO SCHEMA. They are Unicode text: the OS picker
 * puts them in this box like any other character. A bundled picker is 200KB–1MB
 * of data hanging off a text field, which is the cost this defers.
 */
export function MessageComposer({
  conversationId,
  onSend,
  onTyping,
  disabled,
}: {
  onSend: (body: string) => void;
  /**
   * Called on every keystroke. ⚠ THROTTLED BY THE CALLER, not here: the hook
   * already holds the one timer that decides how often the server hears about
   * it, and a second throttle in the component would be two answers to one
   * question.
   */
  onTyping?: () => void;
  disabled?: boolean;
  /**
   * Which conversation this composer is writing into.
   *
   * ⚠ Only the QUICK BUTTON needs it, and only to decide which emoji this
   * conversation was given. Sending does not go through here — `onSend` is the
   * caller's, which already knows where the message goes.
   */
  conversationId?: string;
}) {
  const [body, setBody] = useState('');
  const [picking, setPicking] = useState(false);
  /*
   * ⚠ Read ONCE on mount, not per render: `readChatSettings` touches
   * localStorage, and this component re-renders on every keystroke.
   */
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  useEffect(() => setSettings(readChatSettings()), []);

  const box = useRef<HTMLTextAreaElement>(null);

  /*
   * ⚠ THIS CONVERSATION'S BUTTON, not the person's default. The fallback order
   * lives in `resolveQuickEmoji` so this screen and the settings screen cannot
   * disagree about which emoji a given thread shows.
   */
  const quickEmoji = resolveQuickEmoji(settings, conversationId);

  const length = [...body].length;
  const tooLong = length > MAX_BODY_CODE_POINTS;
  const sendable = body.trim() !== '' && !tooLong && !disabled;

  function send() {
    if (!sendable) return;
    onSend(body);
    setBody('');
  }

  /**
   * Put the chosen emoji where the caret is, and leave the caret after it.
   *
   * ⚠ THE SELECTION IS READ FROM THE DOM, not from React state, because the
   * textarea owns it and nothing else knows where the caret went. The insertion
   * ITSELF is `insertEmoji`, a pure function with tests — this is the ten lines
   * that cannot be tested without a browser, kept as small as possible.
   */
  function pick(emoji: string) {
    const field = box.current;
    const at = field
      ? { start: field.selectionStart, end: field.selectionEnd }
      : { start: body.length, end: body.length };

    const { text, caret } = insertEmoji(body, emoji, at);
    setBody(text);
    remember(emoji);

    /*
     * ⚠ AFTER THE RENDER, or the caret is set on a textarea that still holds
     * the old value and React overwrites it. The picker stays OPEN — people
     * send several in a row, and a panel that closes after one is a panel
     * somebody reopens four times.
     */
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  }

  /** Move it to the front of the recents, and persist. */
  function remember(emoji: string) {
    setSettings((current) => {
      const next = { ...current, recentEmoji: withRecentEmoji(current.recentEmoji, emoji) };
      writeChatSettings(next);
      return next;
    });
  }

  /**
   * ⚠ SENDS IMMEDIATELY, and does NOT touch what is in the box.
   *
   * The quick button is a reply, not a shortcut for typing one — appending to a
   * half-written message and sending THAT would destroy the draft. Somebody
   * mid-sentence who taps 👍 means "yes, and I am still writing".
   */
  function sendQuick() {
    if (disabled || !quickEmoji) return;
    onSend(quickEmoji);
    remember(quickEmoji);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    /*
     * ⚠ Enter sends, Shift+Enter breaks a line — the convention of every chat
     * anybody has used, and getting it backwards is the kind of thing people
     * notice once and resent forever.
     *
     * `isComposing` is the one that is easy to miss: while an IME is open,
     * Enter COMMITS the candidate word. Sending there would cut a Japanese or
     * Chinese sentence off mid-word, every time.
     */
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            onTyping?.();
          }}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={disabled}
          aria-label="Message"
          placeholder="Write a message"
          className={cn(
            'min-h-0 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50',
          )}
        />
        {/*
          `relative`, because the picker is absolutely positioned against this
          and opens UPWARDS — a panel below the composer would be off the bottom
          of the screen on every phone.
        */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPicking((open) => !open)}
            disabled={disabled}
            aria-expanded={picking}
            aria-label="Choose an emoji"
            className="rounded-md px-2 py-2 text-lg leading-none hover:bg-accent disabled:opacity-50"
          >
            🙂
          </button>
          {picking ? (
            <EmojiPicker recent={settings.recentEmoji} onPick={pick} onClose={() => setPicking(false)} />
          ) : null}
        </div>

        {/*
          ⚠ THE QUICK BUTTON, and it is hidden rather than disabled when unset —
          somebody who cleared it in preferences asked for it to be gone, not
          greyed out. Set in /chat/preferences.
        */}
        {quickEmoji ? (
          <button
            type="button"
            onClick={sendQuick}
            disabled={disabled}
            title={`Send ${quickEmoji}`}
            aria-label={`Send ${quickEmoji}`}
            className="shrink-0 rounded-md border border-border px-2 py-2 text-lg leading-none hover:bg-accent disabled:opacity-50"
          >
            {quickEmoji}
          </button>
        ) : null}

        <button
          type="button"
          onClick={send}
          disabled={!sendable}
          className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {/*
        The counter appears only as the cap comes into view. A character count
        on an empty box is furniture; one at 3900 of 4000 is information.
      */}
      {length > MAX_BODY_CODE_POINTS * 0.9 ? (
        <p className={cn('mt-1 text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
          {length} / {MAX_BODY_CODE_POINTS}
        </p>
      ) : null}
    </div>
  );
}
