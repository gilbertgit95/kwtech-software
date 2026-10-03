'use client';

import { type FormEvent, useEffect, useState } from 'react';
import type { BooksOverviewView } from '../books-client.js';
import { type BooksContext, useBooksAction } from '../use-books.js';
import { formatDay } from '../view/labels.js';
import { DayField, FormActions } from './form-fields.js';

/**
 * How profit is shared, and whether sales come in from the point of sale — the
 * two choices the owners make once (BOOKKEEPING-PLAN §3, §6), bound to
 * `books:manage_investors`.
 */
export function SettingsSection({
  books,
  overview,
  onChanged,
}: {
  books: BooksContext;
  overview: BooksOverviewView;
  onChanged: () => void;
}) {
  const [shareMode, setShareMode] = useState(overview.shareMode);
  const [fromPos, setFromPos] = useState(overview.pos.connected);
  const [importFrom, setImportFrom] = useState(overview.pos.importFrom ?? overview.today);
  const [saved, setSaved] = useState(false);
  const action = useBooksAction();
  useEffect(() => {
    setShareMode(overview.shareMode);
    setFromPos(overview.pos.connected);
    setImportFrom(overview.pos.importFrom ?? overview.today);
  }, [overview.shareMode, overview.pos.connected, overview.pos.importFrom, overview.today]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const result = await action.run(
      () => books.client.saveSettings(books.scope, shareMode, fromPos ? importFrom : null),
      'Could not save the settings.',
    );
    if (!result) return;
    setSaved(true);
    onChanged();
  }

  return (
    <form className="mx-auto flex w-full max-w-xl flex-col gap-4 overflow-y-auto" onSubmit={submit} noValidate>
      <fieldset className="m-0 flex flex-col gap-2 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold">How profit is shared</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="books-share-mode"
            className="mt-0.5"
            checked={shareMode === 'capital'}
            onChange={() => setShareMode('capital')}
          />
          <span>
            <span className="font-medium">By capital put in.</span>{' '}
            <span className="text-muted-foreground">
              ₱15,000 of ₱25,000 is 60%. Shares move as capital goes in and is returned.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="books-share-mode"
            className="mt-0.5"
            checked={shareMode === 'agreed'}
            onChange={() => setShareMode('agreed')}
          />
          <span>
            <span className="font-medium">By an agreed percentage.</span>{' '}
            <span className="text-muted-foreground">
              Such as 50/50. Set each investor’s on their page; they must add up to 100%.
            </span>
          </span>
        </label>
        <p className="text-xs text-muted-foreground">A change applies to the next profit share, not to past ones.</p>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold">Sales from the point of sale</legend>
        {overview.pos.available ? (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={fromPos}
                onChange={(event) => setFromPos(event.target.checked)}
              />
              <span>
                Bring sales in from the point of sale — cash, e-wallet and card takings, with the cost of what was sold.
                Profit then waits until each day’s sales are in.
              </span>
            </label>
            {fromPos ? (
              <DayField
                label="First day to bring in"
                value={importFrom}
                onChange={setImportFrom}
                max={overview.today}
                hint={
                  overview.pos.recordedThrough
                    ? `Brought in through ${formatDay(overview.pos.recordedThrough)}. A later first day skips the days between.`
                    : 'Sales before this day are not brought in: record what the business had then as an opening balance.'
                }
              />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This workspace has no point of sale to read, so sales are recorded by hand under Money.
          </p>
        )}
      </fieldset>

      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      ) : null}
      <FormActions
        busy={action.busy}
        error={action.error}
        submitLabel="Save settings"
        busyLabel="Saving…"
        onCancel={() => {
          setShareMode(overview.shareMode);
          setFromPos(overview.pos.connected);
          setImportFrom(overview.pos.importFrom ?? overview.today);
        }}
      />
    </form>
  );
}
