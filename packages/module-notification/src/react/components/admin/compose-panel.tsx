'use client';

import { cn } from '@kwtech/web-ui/react';
import { useId, useState } from 'react';
import { NOTIFICATION_BODY_MAX, NOTIFICATION_TITLE_MAX } from '../../../domain/compose.js';
import { NOTIFICATION_SEVERITIES, type NotificationSeverity } from '../../../types.js';
import type { NotificationBatchView, NotificationClient } from '../../notification-client.js';
import {
  buttonOpensNewTab,
  type ComposeDraft,
  type ComposeErrors,
  composeButton,
  counter,
  EMPTY_COMPOSE_DRAFT,
  recipientSummary,
  severityHint,
  validateComposeDraft,
} from '../../view/compose-view.js';
import { severityLook } from '../../view/severity-view.js';
import { NotificationIcon } from '../notification-icons.js';
import { NotificationPreview } from './notification-preview.js';
import { RecipientPicker } from './recipient-picker.js';

export interface ComposePanelProps {
  client: NotificationClient;
  /** A send went out; the page shows "View in Sent". */
  onSent: (batch: NotificationBatchView) => void;
  onViewSent: () => void;
}

/**
 * Writing a notification: the form on the left, what the recipient will see on
 * the right, and one clear line beside Send saying who it goes to.
 */
export function ComposePanel({ client, onSent, onViewSent }: ComposePanelProps) {
  const ids = useId();
  const [draft, setDraft] = useState<ComposeDraft>(EMPTY_COMPOSE_DRAFT);
  const [errors, setErrors] = useState<ComposeErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<NotificationBatchView | null>(null);
  // Fixed per mount: the preview says "just now", and a ticking clock would
  // re-render the whole form for nothing.
  const [now] = useState(() => new Date());

  const update = (change: Partial<ComposeDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
    setSent(null);
    // A field's error clears as soon as it is edited; the rest wait for Send.
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(change)) {
        if (key === 'recipients') delete next.recipients;
        if (key === 'title') delete next.title;
        if (key === 'body') delete next.body;
        if (key === 'linkHref' || key === 'withButton') delete next.linkHref;
      }
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validateComposeDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setFailure(null);
    try {
      const batch = await client.send({
        recipientIds: draft.recipients.map((person) => person.userId),
        severity: draft.severity,
        title: draft.title.trim(),
        body: draft.body.trim() || null,
        ...composeButton(draft),
      });
      setDraft(EMPTY_COMPOSE_DRAFT);
      setSent(batch);
      onSent(batch);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not send the notification.');
    } finally {
      setSaving(false);
    }
  };

  const title = counter(draft.title, NOTIFICATION_TITLE_MAX);
  const body = counter(draft.body, NOTIFICATION_BODY_MAX);

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        {sent ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-status-success px-4 py-3 text-sm text-status-success-foreground"
          >
            <span className="flex items-center gap-2 font-medium">
              <NotificationIcon name="success" className="size-4" />
              Sent to {sent.recipientCount === 1 ? '1 person' : `${sent.recipientCount} people`}: “{sent.title}”
            </span>
            <button type="button" onClick={onViewSent} className="font-medium underline underline-offset-2">
              View in Sent
            </button>
          </div>
        ) : null}

        <Section title="Recipients" icon="users">
          <label htmlFor={`${ids}-to`} className="sr-only">
            Recipients
          </label>
          <RecipientPicker
            id={`${ids}-to`}
            client={client}
            value={draft.recipients}
            onChange={(recipients) => update({ recipients })}
            error={errors.recipients}
          />
        </Section>

        <Section title="Type" icon="bell">
          <fieldset>
            <legend className="sr-only">Type</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {NOTIFICATION_SEVERITIES.map((severity) => (
                <SeverityCard
                  key={severity}
                  name={`${ids}-severity`}
                  severity={severity}
                  checked={draft.severity === severity}
                  onSelect={() => update({ severity })}
                />
              ))}
            </div>
          </fieldset>
        </Section>

        <Section title="Message" icon="compose">
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <label htmlFor={`${ids}-title`} className="text-sm font-medium">
                  Title
                </label>
                <Counter {...title} />
              </div>
              <input
                id={`${ids}-title`}
                value={draft.title}
                onChange={(event) => update({ title: event.target.value })}
                placeholder="What happened, in one line"
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={errors.title ? `${ids}-title-error` : undefined}
                className={cn(fieldClass, errors.title ? 'border-destructive' : null)}
              />
              {errors.title ? (
                <p id={`${ids}-title-error`} className="mt-1 text-xs text-destructive">
                  {errors.title}
                </p>
              ) : null}
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <label htmlFor={`${ids}-body`} className="text-sm font-medium">
                  Details <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Counter {...body} />
              </div>
              <textarea
                id={`${ids}-body`}
                rows={4}
                value={draft.body}
                onChange={(event) => update({ body: event.target.value })}
                placeholder="Anything they need to know. Plain text."
                aria-invalid={errors.body ? true : undefined}
                aria-describedby={errors.body ? `${ids}-body-error` : undefined}
                className={cn(fieldClass, 'resize-y', errors.body ? 'border-destructive' : null)}
              />
              {errors.body ? (
                <p id={`${ids}-body-error`} className="mt-1 text-xs text-destructive">
                  {errors.body}
                </p>
              ) : null}
            </div>
          </div>
        </Section>

        <Section title="Button" icon="link" hint="Optional — opens a page or a link">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={draft.withButton}
              onChange={(event) => update({ withButton: event.target.checked })}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-5 w-9 shrink-0 rounded-full bg-muted-foreground/30 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-background after:shadow after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
            />
            <span className="text-sm">Add a button to the notification</span>
          </label>
          {draft.withButton ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <div>
                <label htmlFor={`${ids}-link-label`} className="mb-1 block text-sm font-medium">
                  Label
                </label>
                <input
                  id={`${ids}-link-label`}
                  value={draft.linkLabel}
                  onChange={(event) => update({ linkLabel: event.target.value })}
                  placeholder="Open"
                  maxLength={40}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor={`${ids}-link-href`} className="mb-1 block text-sm font-medium">
                  Link
                </label>
                <input
                  id={`${ids}-link-href`}
                  value={draft.linkHref}
                  onChange={(event) => update({ linkHref: event.target.value })}
                  placeholder="/admin/users or https://…"
                  aria-invalid={errors.linkHref ? true : undefined}
                  aria-describedby={`${ids}-link-hint`}
                  className={cn(fieldClass, errors.linkHref ? 'border-destructive' : null)}
                />
                <p
                  id={`${ids}-link-hint`}
                  className={cn('mt-1 text-xs', errors.linkHref ? 'text-destructive' : 'text-muted-foreground')}
                >
                  {errors.linkHref ??
                    (buttonOpensNewTab(draft.linkHref)
                      ? 'An outside address — it opens in a new tab.'
                      : 'A page in this app opens in the same tab.')}
                </p>
              </div>
            </div>
          ) : null}
        </Section>

        {failure ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {failure}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <NotificationIcon name="users" className="size-4" />
            {recipientSummary(draft.recipients.length)}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_COMPOSE_DRAFT);
                setErrors({});
                setFailure(null);
              }}
              disabled={saving}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <NotificationIcon name="send" className="size-4" />
              {saving ? 'Sending…' : 'Send notification'}
            </button>
          </div>
        </div>
      </div>

      <aside aria-label="Preview" className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="mb-3 text-sm font-semibold">Preview</p>
          <NotificationPreview draft={draft} now={now} />
          <p className="mt-4 text-xs text-muted-foreground">
            Recipients see it from “Platform”, not from you. To message someone personally, use chat.
          </p>
        </div>
      </aside>
    </form>
  );
}

const fieldClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';

function Section({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon: 'users' | 'bell' | 'compose' | 'link';
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <NotificationIcon name={icon} className="size-4 text-muted-foreground" />
        {title}
        {hint ? <span className="font-normal text-muted-foreground">· {hint}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function SeverityCard({
  name,
  severity,
  checked,
  onSelect,
}: {
  name: string;
  severity: NotificationSeverity;
  checked: boolean;
  onSelect: () => void;
}) {
  const look = severityLook(severity);
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', look.chip)}>
        <NotificationIcon name={look.icon} className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{look.label}</span>
        <span className="block text-xs text-muted-foreground">{severityHint(severity)}</span>
      </span>
      {checked ? <NotificationIcon name="check" className="ml-auto size-4 shrink-0 text-primary" /> : null}
    </label>
  );
}

function Counter({ text, near, over }: { text: string; near: boolean; over: boolean }) {
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        over ? 'text-destructive' : near ? 'text-status-warning-foreground' : 'text-muted-foreground',
      )}
    >
      {text}
    </span>
  );
}
