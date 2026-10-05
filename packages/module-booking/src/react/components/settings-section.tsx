'use client';

import { ConfirmDialog, cn, QrCode } from '@kwtech/web-ui/react';
import { Bell, CalendarRange, Check, Clock, Copy, ExternalLink, Globe, type LucideIcon, RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import {
  BOOKING_DEFAULT_SETTINGS,
  BOOKING_PUBLIC_NOTE_MAX,
  BOOKING_PUBLIC_TITLE_MAX,
  BOOKING_SLOT_MINUTES,
  prepareBookingSettings,
} from '../../domain/catalogue.js';
import type { BookingSettingsView } from '../booking-client.js';
import type { BookingAppState } from '../booking-state.js';
import { bookingPublicHref } from '../routes.js';
import { useBookingAction, useBookingData } from '../use-booking-data.js';
import {
  CUTOFF_OPTIONS,
  customerRulesSummary,
  daysText,
  HORIZON_OPTIONS,
  hoursText,
  isSettingsChanged,
  LAPSE_OPTIONS,
  LEAD_OPTIONS,
  REMINDER_OPTIONS,
  type SettingOption,
  type SettingsDraft,
  spanText,
  withCurrent,
} from '../view/settings.js';
import { durationText } from '../view/time.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { Alert, Empty, StatusChip } from './layout.js';

/** The stored settings without the link, which is the server's to make — what the form starts from and is compared to. */
function draftOf(settings: BookingSettingsView | null): SettingsDraft {
  if (!settings) return { ...BOOKING_DEFAULT_SETTINGS };
  const { publicLinkId: _link, ...values } = settings;
  return values;
}

/**
 * The workspace's booking settings, as choices a person makes rather than
 * numbers they type: "1 hr before", a switch, a row of slot sizes.
 *
 * - Two cards: how the DESK works (times, reminders), and the PUBLIC PAGE —
 *   whether customers can book for themselves, what it is called, the rules
 *   that bind them, and its link.
 * - Nothing is saved until Save is pressed. A bar appears at the bottom as soon
 *   as something is changed, with Save and Discard, so a change is never
 *   half-made and never forgotten.
 * - ⚠ The public page is OFF until somebody turns it on here, and none of its
 *   rules binds staff.
 */
export function SettingsSection({ state }: { state: BookingAppState }) {
  const { client, scope } = state;
  const load = useCallback(() => client.settings(scope), [client, scope]);
  const settings = useBookingData(scope, load, ['settings'], 'Could not load the settings.');
  const action = useBookingAction('Could not save the settings.');
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(null));
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const set = (patch: Partial<SettingsDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  // What is stored fills the form — when it first arrives, and when somebody else changes it.
  const stored = settings.data;
  useEffect(() => {
    if (stored) setDraft(draftOf(stored));
  }, [stored]);

  if (stored === null) {
    return settings.error ? <Alert message={settings.error} /> : <Empty>Loading the settings…</Empty>;
  }

  const changed = isSettingsChanged(draft, draftOf(stored));

  async function save() {
    setSaved(false);
    // The server's own check, run first: the one thing a choice cannot get right for somebody is the page's name.
    const prepared = prepareBookingSettings(draft);
    if ('refused' in prepared) {
      setTitleError(
        draft.publicTitle.trim() === ''
          ? 'Give the page a name before turning it on, so customers know whose it is.'
          : `Use at most ${BOOKING_PUBLIC_TITLE_MAX} characters, with no invisible formatting.`,
      );
      return;
    }
    setTitleError(null);
    if (await action.run(() => client.saveSettings(scope, draft))) {
      setSaved(true);
      await settings.reload();
    }
  }

  const discard = () => {
    setDraft(draftOf(stored));
    setTitleError(null);
    action.dismissError();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <Alert message={settings.error ?? action.error} onDismiss={action.error ? action.dismissError : undefined} />

          <Card
            icon={Clock}
            title="At the desk"
            description="How times are offered to book, and when staff hear about them."
          >
            <Row title="Start times" description="How far apart the times a booking can start are." stacked>
              <Segmented
                label="Start times"
                value={draft.slotMinutes}
                options={BOOKING_SLOT_MINUTES.map((minutes) => ({ value: minutes, label: durationText(minutes) }))}
                onChange={(slotMinutes) => set({ slotMinutes })}
              />
            </Row>
            <Row
              icon={Bell}
              title="Remind staff"
              description="A notification to whoever the booking is with — or to everybody at the desk, for a place or a machine."
            >
              <Choice
                label="Remind staff"
                value={draft.reminderMinutes}
                options={withCurrent(REMINDER_OPTIONS, draft.reminderMinutes, (m) => `${spanText(m)} before`)}
                onChange={(reminderMinutes) => set({ reminderMinutes })}
              />
            </Row>
          </Card>

          <Card
            icon={Globe}
            title="Online booking"
            description="A page customers open to ask for a booking themselves, with no account. Each one is a request you confirm or decline."
            aside={
              <StatusChip
                label={stored.publicEnabled ? 'On' : 'Off'}
                tone={stored.publicEnabled ? 'success' : 'neutral'}
              />
            }
          >
            <Row
              title="Take bookings online"
              description={
                draft.publicEnabled
                  ? 'Customers with your link can ask for a time.'
                  : 'Off: your link shows that bookings are not being taken. Bookings already asked for keep their own links.'
              }
            >
              <Switch
                label="Take bookings online"
                checked={draft.publicEnabled}
                onChange={(publicEnabled) => set({ publicEnabled })}
              />
            </Row>

            {stored.publicLinkId ? (
              <PublicLink
                linkId={stored.publicLinkId}
                enabled={stored.publicEnabled}
                title={stored.publicTitle}
                onReset={() => setResetting(true)}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                Your booking link and its QR code appear here once the page has been turned on and saved.
              </p>
            )}

            <Row title="Name shown to customers" description="Your business as customers know it." stacked>
              <TextControl
                label="Name shown to customers"
                value={draft.publicTitle}
                maxLength={BOOKING_PUBLIC_TITLE_MAX}
                error={titleError}
                placeholder="Your business name"
                onChange={(publicTitle) => {
                  set({ publicTitle });
                  setTitleError(null);
                }}
              />
            </Row>
            <Row title="A note under the name" description="Optional: where to find you, what to bring." stacked>
              <TextControl
                label="A note under the name"
                value={draft.publicNote}
                maxLength={BOOKING_PUBLIC_NOTE_MAX}
                multiline
                onChange={(publicNote) => set({ publicNote })}
              />
            </Row>

            <div className="flex flex-col gap-1 border-border border-t pt-4">
              <h3 className="flex items-center gap-2 font-semibold text-sm">
                <CalendarRange aria-hidden="true" className="size-4 text-muted-foreground" />
                Rules for customers
              </h3>
              <p className="text-muted-foreground text-xs">
                These bind customers only. Staff can always book, move and cancel.
              </p>
            </div>
            <div className="@container">
              <div className="grid gap-3 @lg:grid-cols-2">
                <RuleChoice
                  title="How soon"
                  description="The notice you need."
                  value={draft.leadMinutes}
                  options={withCurrent(LEAD_OPTIONS, draft.leadMinutes, (m) => `At least ${spanText(m)} ahead`)}
                  onChange={(leadMinutes) => set({ leadMinutes })}
                />
                <RuleChoice
                  title="How far ahead"
                  description="The furthest day on offer."
                  value={draft.horizonDays}
                  options={withCurrent(HORIZON_OPTIONS, draft.horizonDays, (d) => `Up to ${daysText(d)} ahead`)}
                  onChange={(horizonDays) => set({ horizonDays })}
                />
                <RuleChoice
                  title="Cancel or change"
                  description="After this, they contact you."
                  value={draft.cutoffMinutes}
                  options={withCurrent(CUTOFF_OPTIONS, draft.cutoffMinutes, (m) => `Until ${spanText(m)} before`)}
                  onChange={(cutoffMinutes) => set({ cutoffMinutes })}
                />
                <RuleChoice
                  title="Unanswered requests lapse"
                  description="Or when the time arrives, if sooner."
                  value={draft.lapseHours}
                  options={withCurrent(LAPSE_OPTIONS, draft.lapseHours, (h) => `After ${hoursText(h)}`)}
                  onChange={(lapseHours) => set({ lapseHours })}
                />
              </div>
            </div>
            {/* The four controls, read back as one sentence: what was set, without decoding it. */}
            <p className="rounded-xl bg-muted px-4 py-3 text-sm">{customerRulesSummary(draft)}</p>
            <p className="text-muted-foreground text-xs">
              Customers are not sent anything yet — no confirmation and no reminder. They see where their booking stands
              on the private link they are shown when they ask.
            </p>
          </Card>
        </div>
      </div>

      {/* ⚠ Outside the scrolling area, so it is in sight wherever the change was made. */}
      {changed || saved ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 shadow-lg',
            changed ? 'border-primary bg-card' : 'border-border bg-card',
          )}
        >
          {changed ? (
            <>
              <p role="status" className="mr-auto font-medium text-sm">
                You have changes that are not saved.
              </p>
              <button type="button" className={buttonClass('ghost')} onClick={discard} disabled={action.busy}>
                Discard
              </button>
              <button
                type="button"
                className={buttonClass('primary')}
                onClick={() => void save()}
                disabled={action.busy}
              >
                {action.busy ? 'Saving…' : 'Save changes'}
              </button>
            </>
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-status-success-foreground">
              <Check aria-hidden="true" className="size-4" />
              Saved.
            </p>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={resetting}
        title="Replace the booking link?"
        description="The current link stops working at once, wherever it has been posted or printed, and a new one is made. Customers who already asked for a booking keep their own links."
        confirmLabel="Replace the link"
        pending={action.busy}
        onCancel={() => setResetting(false)}
        onConfirm={async () => {
          const done = await action.run(() => client.resetPublicLink(scope));
          setResetting(false);
          if (done) await settings.reload();
        }}
      />
    </div>
  );
}

/** One group of settings: what it is about, then its rows. */
function Card({
  icon: Icon,
  title,
  description,
  aside,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs" aria-label={title}>
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="font-semibold text-lg tracking-tight">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/**
 * One setting: what it is and what it does on the left, its control on the
 * right — under it when the card is narrow, or when the control is a text box
 * that wants the width (`stacked`).
 */
function Row({
  icon: Icon,
  title,
  description,
  stacked = false,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="@container border-border border-t pt-4">
      <div className={cn('flex flex-col gap-2.5', stacked ? null : '@lg:flex-row @lg:items-center @lg:gap-6')}>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 font-medium text-sm">
            {Icon ? <Icon aria-hidden="true" className="size-4 text-muted-foreground" /> : null}
            {title}
          </span>
          <span className="text-muted-foreground text-xs">{description}</span>
        </div>
        <div className={cn(stacked ? null : '@lg:w-64 @lg:shrink-0')}>{children}</div>
      </div>
    </div>
  );
}

/** A choice from a short list, as a row of buttons: every option is in sight, and one press picks it. */
function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: readonly SettingOption[];
  onChange: (value: number) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-wrap gap-1 rounded-xl border-0 bg-muted p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={cn(
            'h-8 flex-1 whitespace-nowrap rounded-lg px-2.5 font-medium text-xs transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            option.value === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/** A choice from a longer list, in words: "1 hr before", never a number and a unit to work out. */
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: readonly SettingOption[];
  onChange: (value: number) => void;
}) {
  return (
    <select
      aria-label={label}
      className={INPUT_CLASS}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** One of the customer's rules, as a small tile: its name, its choice, and a word on what it does. */
function RuleChoice({
  title,
  description,
  value,
  options,
  onChange,
}: {
  title: string;
  description: string;
  value: number;
  options: readonly SettingOption[];
  onChange: (value: number) => void;
}) {
  const id = useId();
  const noteId = useId();
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
      <label htmlFor={id} className="font-medium text-sm">
        {title}
      </label>
      <select
        id={id}
        className={INPUT_CLASS}
        value={value}
        aria-describedby={noteId}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p id={noteId} className="text-muted-foreground text-xs">
        {description}
      </p>
    </div>
  );
}

/**
 * On or off, as a switch. A real `role="switch"` button, so it is announced as
 * one and Space flips it; the words beside it say what each state means.
 */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-5 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

/** A line or a few lines of text, with how much room is left and its error under it. */
function TextControl({
  label,
  value,
  maxLength,
  multiline = false,
  error = null,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  multiline?: boolean;
  error?: string | null;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const noteId = useId();
  const shared = {
    'aria-label': label,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': noteId,
    value,
    maxLength,
    placeholder,
  };
  return (
    <div className="flex flex-col gap-1">
      {multiline ? (
        <textarea
          {...shared}
          rows={2}
          className={cn(INPUT_CLASS, 'h-auto py-2', error ? 'border-destructive' : null)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          className={cn(INPUT_CLASS, error ? 'border-destructive' : null)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <p id={noteId} className="flex justify-between gap-3 text-xs">
        <span role={error ? 'alert' : undefined} className={error ? 'text-destructive' : 'text-muted-foreground'}>
          {error ?? ''}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {[...value].length}/{maxLength}
        </span>
      </p>
    </div>
  );
}

/**
 * The public page's address: to copy, to open, and as a code to print for the
 * counter. Shown from what is STORED, never from the form, so it is always a
 * link that works as it reads.
 */
function PublicLink({
  linkId,
  enabled,
  title,
  onReset,
}: {
  linkId: string;
  enabled: boolean;
  title: string;
  onReset: () => void;
}) {
  const path = bookingPublicHref(linkId);
  // The whole address. Only the browser knows the site it is on; until it says, the path alone is shown.
  const [link, setLink] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setLink(new URL(path, window.location.origin).toString());
    setCopied(false);
  }, [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard: the link is on screen to be copied by hand.
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        '@container rounded-xl border p-4',
        enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/40',
      )}
    >
      <div className="flex flex-col gap-4 @md:flex-row @md:items-center">
        <div
          className={cn(
            'shrink-0 self-center rounded-xl border border-border bg-background p-2',
            enabled ? null : 'opacity-40',
          )}
        >
          <QrCode
            value={link}
            size={120}
            label={`A code that opens the booking page of ${title || 'this workspace'}`}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-col">
            <h3 className="font-semibold text-sm">Your booking link</h3>
            <p className="text-muted-foreground text-xs">
              {enabled
                ? 'Share it wherever customers find you, or print the code for the counter.'
                : 'Online booking is off, so this link shows that bookings are not being taken.'}
            </p>
          </div>
          <p className="break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">{link}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass(enabled ? 'primary' : 'secondary', 'sm')} onClick={copy}>
              {copied ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <Copy aria-hidden="true" className="size-3.5" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className={buttonClass('secondary', 'sm')} href={path} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Open page
            </a>
            <button type="button" className={cn(buttonClass('ghost', 'sm'), 'ml-auto')} onClick={onReset}>
              <RefreshCw aria-hidden="true" className="size-3.5" />
              Replace link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
