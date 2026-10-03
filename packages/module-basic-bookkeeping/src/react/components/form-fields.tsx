'use client';

import { cn } from '@kwtech/web-ui/react';
import type { ReactNode } from 'react';
import { BOOKS_PLACES } from '../../domain/entries.js';
import { PLACE_LABEL } from '../view/labels.js';
import { buttonClass, Field, INPUT_CLASS } from './controls.js';

/*
 * The inputs every bookkeeping form is made of. Each is a labelled `Field`
 * whose error replaces its hint, with `aria-invalid` and `aria-describedby`
 * set, so a form is a list of these and nothing else.
 */

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  autoFocus,
  inputMode,
  list,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
  autoFocus?: boolean | undefined;
  inputMode?: 'decimal' | 'text' | undefined;
  /** A `<datalist>` id: suggestions, free text still allowed. */
  list?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error ?? null}>
      {(id, describedBy) => (
        <input
          id={id}
          className={INPUT_CLASS}
          value={value}
          placeholder={placeholder}
          // biome-ignore lint/a11y/noAutofocus: a dialog's first field; `Modal` mounts the content after showModal() so this lands.
          autoFocus={autoFocus}
          inputMode={inputMode}
          list={list}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** An amount in pesos, as typed: parsed by `parsePeso` when the form is checked. */
export function AmountField(props: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  autoFocus?: boolean | undefined;
}) {
  return (
    <TextField
      label={props.label ?? 'Amount (₱)'}
      value={props.value}
      onChange={props.onChange}
      error={props.error}
      hint={props.hint}
      placeholder="0.00"
      inputMode="decimal"
      autoFocus={props.autoFocus}
    />
  );
}

/** A day of the workspace's calendar. `max` is its today: nothing is dated in the future. */
export function DayField({
  label = 'Date',
  value,
  onChange,
  error,
  hint,
  max,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  max: string;
}) {
  return (
    <Field label={label} hint={hint} error={error ?? null}>
      {(id, describedBy) => (
        <input
          id={id}
          type="date"
          className={INPUT_CLASS}
          value={value}
          max={max}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** Where the money was: cash, e-wallet or bank, as a row of choices. */
export function PlaceField({
  label = 'Where',
  value,
  onChange,
  error,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {BOOKS_PLACES.map((place) => (
          <button
            key={place}
            type="button"
            aria-pressed={value === place}
            className={cn(buttonClass(value === place ? 'primary' : 'secondary', 'sm'))}
            onClick={() => onChange(place)}
          >
            {PLACE_LABEL[place]}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** A select over labelled options. */
export function SelectField<K extends string>({
  label,
  value,
  onChange,
  options,
  error,
  hint,
}: {
  label: string;
  value: K;
  onChange: (value: K) => void;
  options: readonly { value: K; label: string; group?: string }[];
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const groups = [...new Set(options.map((option) => option.group ?? ''))];
  return (
    <Field label={label} hint={hint} error={error ?? null}>
      {(id, describedBy) => (
        <select
          id={id}
          className={INPUT_CLASS}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          // The options are the ones listed, so the value is one of them.
          onChange={(event) => onChange(event.target.value as K)}
        >
          {groups.map((group) =>
            group === '' ? (
              options
                .filter((option) => !option.group)
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))
            ) : (
              <optgroup key={group} label={group}>
                {options
                  .filter((option) => option.group === group)
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </optgroup>
            ),
          )}
        </select>
      )}
    </Field>
  );
}

/** The footer every form dialog ends with: the error, then Cancel and the verb. */
export function FormActions({
  busy,
  error,
  submitLabel,
  busyLabel,
  onCancel,
  danger = false,
  disabled = false,
}: {
  busy: boolean;
  error: string | null;
  submitLabel: string;
  busyLabel: string;
  onCancel: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass('secondary')} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={buttonClass(danger ? 'danger' : 'primary')} disabled={busy || disabled}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </>
  );
}

/** Label and value, side by side: a figure in a summary. */
export function Figure({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: string;
  tone?: 'negative' | 'muted' | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-base font-semibold tabular-nums',
          tone === 'negative' ? 'text-destructive' : null,
          tone === 'muted' ? 'text-muted-foreground' : null,
        )}
      >
        {value}
      </span>
      {children}
    </div>
  );
}
