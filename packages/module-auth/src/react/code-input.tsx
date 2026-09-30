'use client';

import { cn } from '@kwtech/web-ui/react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { TOTP_DIGITS } from '../domain/policy.js';
import { cleanCode, isCodeComplete } from './view/code-entry.js';

/** One entry per digit, with a stable key: box three is always box three. */
const BOXES = Array.from({ length: TOTP_DIGITS }, (_, index) => ({ id: `digit-${index + 1}`, index }));

export interface CodeInputProps {
  /** The form field the code is sent as. */
  name: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  /**
   * Sends the enclosing form the moment the last digit arrives, typed, pasted
   * or autofilled, so there is no button to find afterwards. The same code is
   * never sent twice in a row. After a refusal the caller clears the boxes, and
   * the next whole code goes again.
   */
  submitOnComplete?: boolean;
  /** Shown while the code is being checked: the boxes stop taking input. */
  busy?: boolean;
  /** Draws the boxes in the error colour, after a refusal. */
  invalid?: boolean;
  autoFocus?: boolean;
  /** For a caller that refocuses the field, after clearing it on a refusal. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * A six-digit one-time code as six boxes that fill as you type.
 *
 * ⚠ ONE REAL INPUT, laid invisibly over the boxes, never six inputs. Six
 * would break the things that make a code quick to enter: the phone's
 * "from Messages" / "from Mail" suggestion (`autoComplete="one-time-code"`)
 * fills ONE field, a password manager fills one field, a paste lands in one
 * field, and a screen reader hears one labelled field rather than six unnamed
 * ones. The boxes are only a picture of that input's value.
 *
 * NOT `type="number"`: it strips leading zeros, which one code in ten has.
 * `inputMode="numeric"` brings up the keypad without that.
 */
export function CodeInput({
  name,
  label,
  value,
  onChange,
  submitOnComplete = false,
  busy = false,
  invalid = false,
  autoFocus = false,
  inputRef,
}: CodeInputProps) {
  const id = useId();
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;
  const [focused, setFocused] = useState(false);
  const sent = useRef<string | null>(null);

  /*
   * In an effect, after the commit, so the form reads the CLEANED value. From
   * inside onChange, the DOM would still hold what was typed ("123 456").
   */
  useEffect(() => {
    if (!isCodeComplete(value, 'digits')) {
      sent.current = null;
      return;
    }
    if (!submitOnComplete || sent.current === value) return;
    sent.current = value;
    ref.current?.form?.requestSubmit();
  }, [value, submitOnComplete, ref]);

  const half = TOTP_DIGITS % 2 === 0 ? TOTP_DIGITS / 2 : -1;

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <div aria-hidden className="flex items-center gap-2">
          {BOXES.map(({ id: boxId, index }) => {
            const char = value[index] ?? '';
            // The box the next digit goes in; the last one once all are filled.
            const active = focused && !busy && index === Math.min(value.length, TOTP_DIGITS - 1);
            return (
              <div key={boxId} className="contents">
                {index === half ? <span className="h-0.5 w-2 shrink-0 rounded bg-border" /> : null}
                <div
                  className={cn(
                    'flex aspect-square min-w-0 flex-1 items-center justify-center rounded-lg border bg-background',
                    'text-xl font-semibold tabular-nums text-foreground transition-[border-color,box-shadow]',
                    invalid
                      ? 'border-destructive'
                      : active
                        ? 'border-primary ring-2 ring-ring/40'
                        : char
                          ? 'border-foreground/30'
                          : 'border-input',
                    busy && 'opacity-60',
                  )}
                >
                  {char ||
                    (active ? (
                      <span className="h-6 w-px animate-pulse rounded bg-foreground motion-reduce:animate-none" />
                    ) : null)}
                </div>
              </div>
            );
          })}
        </div>
        <input
          ref={ref}
          id={id}
          name={name}
          value={value}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          // biome-ignore lint/a11y/noAutofocus: the only field on a step whose whole job is this code
          autoFocus={autoFocus}
          readOnly={busy}
          aria-invalid={invalid || undefined}
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(cleanCode(event.target.value, 'digits'))}
          /*
           * A paste REPLACES the code. Left to the browser it would append to
           * whatever is there, and with six digits already in the boxes a
           * freshly copied code would be cut off and ignored.
           */
          onPaste={(event) => {
            event.preventDefault();
            onChange(cleanCode(event.clipboardData.getData('text'), 'digits'));
          }}
          /*
           * The caret always sits at the end. The boxes draw it there, and an
           * invisible caret anywhere else would put the next digit somewhere
           * the person is not looking.
           */
          onSelect={(event) => {
            const end = event.currentTarget.value.length;
            if (event.currentTarget.selectionStart !== end) event.currentTarget.setSelectionRange(end, end);
          }}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
        />
      </div>
    </div>
  );
}
