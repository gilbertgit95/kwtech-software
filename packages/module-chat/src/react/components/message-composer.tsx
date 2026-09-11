'use client';

import { cn } from '@kwtech/web-ui/react';
import { type KeyboardEvent, useState } from 'react';
import { MAX_BODY_CODE_POINTS } from '../../domain/messages.js';

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
export function MessageComposer({ onSend, disabled }: { onSend: (body: string) => void; disabled?: boolean }) {
  const [body, setBody] = useState('');

  const length = [...body].length;
  const tooLong = length > MAX_BODY_CODE_POINTS;
  const sendable = body.trim() !== '' && !tooLong && !disabled;

  function send() {
    if (!sendable) return;
    onSend(body);
    setBody('');
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
          value={body}
          onChange={(event) => setBody(event.target.value)}
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
