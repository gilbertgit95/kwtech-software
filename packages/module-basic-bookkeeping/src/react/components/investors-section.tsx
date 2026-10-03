'use client';

import { cn, LIST_KEYS } from '@kwtech/web-ui/react';
import { useCallback, useState } from 'react';
import { investorStatement } from '../../domain/statements.js';
import type { BooksInvestorView, BooksOverviewView, BooksProfitShareView } from '../books-client.js';
import { type BooksContext, useBooksAction, useBooksData } from '../use-books.js';
import type { InvestorEntryDraft } from '../view/forms.js';
import { entryTitle, formatDay, formatDays, placeLabel, whoName } from '../view/labels.js';
import { ledgerLines } from '../view/ledger.js';
import { formatPercent, formatPeso, formatSignedPeso } from '../view/money.js';
import { buttonClass } from './controls.js';
import { InvestorDialog, InvestorEntryDialog, ShareProfitDialog, VoidDialog } from './dialogs.js';
import { Figure } from './form-fields.js';
import { Alert, Empty, ListDetail, RowButton, StatusChip } from './layout.js';

/**
 * The investors: who put in what, their share, what they have been given and
 * what they are still owed — each with a statement whose running balances end
 * where the overview's figures are (BOOKKEEPING-PLAN §3–5). Sharing profit
 * starts here, and so does every payment to an investor.
 */
export function InvestorsSection({
  books,
  overview,
  canManage,
  onChanged,
}: {
  books: BooksContext;
  overview: BooksOverviewView;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BooksInvestorView | 'new' | null>(null);
  const [sharing, setSharing] = useState(false);
  const [voidingShare, setVoidingShare] = useState<BooksProfitShareView | null>(null);
  const selected = overview.investors.find((investor) => investor.id === selectedId) ?? null;
  const latestShare = overview.shares.find((share) => share.voidedAt === null) ?? null;

  const list = (
    <>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setSharing(true)}>
            Share profit
          </button>
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setEditing('new')}>
            Add investor
          </button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Profit is shared {overview.shareMode === 'agreed' ? 'by the agreed percentages' : 'by capital put in'}
        {overview.sharedThrough ? `, and has been shared through ${formatDay(overview.sharedThrough)}.` : '.'}
      </p>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto" {...LIST_KEYS}>
        {overview.investors.length === 0 ? <Empty>No investors yet.</Empty> : null}
        {overview.investors.map((investor) => (
          <RowButton key={investor.id} selected={investor.id === selectedId} onClick={() => setSelectedId(investor.id)}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{investor.name}</span>
              <span className="text-xs text-muted-foreground">
                Capital {formatPeso(investor.capital)}
                {investor.share === null ? '' : ` · ${formatPercent(investor.share)}`}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {investor.formerAt ? <StatusChip label="Former" tone="neutral" /> : null}
              <span className={cn('text-xs tabular-nums', investor.owed < 0 ? 'text-destructive' : null)}>
                Owed {formatPeso(investor.owed)}
              </span>
            </span>
          </RowButton>
        ))}
      </div>
      <SharesHistory
        shares={overview.shares}
        investors={overview.investors}
        latestId={latestShare?.id ?? null}
        canManage={canManage}
        onVoid={setVoidingShare}
      />
    </>
  );

  return (
    <>
      <ListDetail
        list={list}
        detail={
          selected ? (
            <InvestorDetail
              key={selected.id}
              books={books}
              overview={overview}
              investor={selected}
              canManage={canManage}
              onEdit={() => setEditing(selected)}
              onChanged={onChanged}
            />
          ) : null
        }
        onBack={() => setSelectedId(null)}
        backLabel="All investors"
      />
      <InvestorDialog
        open={editing !== null}
        investor={editing === 'new' ? null : editing}
        books={books}
        shareMode={overview.shareMode}
        onClose={() => setEditing(null)}
        onDone={(investorId) => {
          setSelectedId(investorId);
          onChanged();
        }}
      />
      <ShareProfitDialog
        open={sharing}
        books={books}
        overview={overview}
        onClose={() => setSharing(false)}
        onDone={onChanged}
      />
      <VoidDialog
        open={voidingShare !== null}
        title="Void this profit share"
        description="What it gave each investor is taken back, and its period opens again to be shared anew. Payouts already made stay — an investor paid more than they are then owed shows as an advance."
        onClose={() => setVoidingShare(null)}
        onVoid={async (reason) => {
          if (!voidingShare) return null;
          try {
            await books.client.voidShare(books.scope, voidingShare.id, reason);
            onChanged();
            return null;
          } catch (caught) {
            return caught instanceof Error ? caught.message : 'Could not void the share.';
          }
        }}
      />
    </>
  );
}

/** The profit shares made so far, newest first. Only the latest live one may be voided. */
function SharesHistory({
  shares,
  investors,
  latestId,
  canManage,
  onVoid,
}: {
  shares: readonly BooksProfitShareView[];
  investors: readonly BooksInvestorView[];
  latestId: string | null;
  canManage: boolean;
  onVoid: (share: BooksProfitShareView) => void;
}) {
  if (shares.length === 0) return null;
  const names = new Map(investors.map((investor) => [investor.id, investor.name]));
  return (
    <section aria-labelledby="books-shares" className="flex flex-col gap-1.5">
      <h3 id="books-shares" className="text-xs font-semibold text-muted-foreground">
        Profit shared
      </h3>
      {shares.map((share) => (
        <div
          key={share.id}
          className={cn('rounded-md border border-border px-3 py-2 text-xs', share.voidedAt ? 'opacity-60' : null)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={cn('font-medium', share.voidedAt ? 'line-through' : null)}>
              {formatDays(share.fromDay, share.toDay)}: {formatPeso(share.shared)} shared
              {share.kept > 0 ? `, ${formatPeso(share.kept)} kept` : ''}
            </span>
            {canManage && share.id === latestId ? (
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => onVoid(share)}>
                Void
              </button>
            ) : null}
          </div>
          {share.voidedAt ? (
            <p className="text-destructive">Voided: {share.voidReason}</p>
          ) : (
            <p className="text-muted-foreground">
              {share.parts
                .map((part) => `${names.get(part.investorId) ?? 'A former investor'} ${formatPeso(part.amount)}`)
                .join(' · ')}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

/** One investor: their figures, what can be done with their money, and their statement. */
function InvestorDetail({
  books,
  overview,
  investor,
  canManage,
  onEdit,
  onChanged,
}: {
  books: BooksContext;
  overview: BooksOverviewView;
  investor: BooksInvestorView;
  canManage: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const load = useCallback(
    () => books.client.entries(books.scope, { investorId: investor.id }),
    [books.client, books.scope, investor.id],
  );
  const page = useBooksData(books.scope, load, 'Could not load their statement.');
  const [recording, setRecording] = useState<InvestorEntryDraft['kind'] | null>(null);
  const former = useBooksAction();
  const lines = page.data ? investorStatement(ledgerLines(page.data.entries)) : [];
  const done = () => {
    void page.reload();
    onChanged();
  };
  const isFormer = investor.formerAt !== null;
  const about = [investor.contact, investor.note].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{investor.name}</h2>
          <p className="text-xs text-muted-foreground">{about === '' ? 'No contact or note.' : about}</p>
        </div>
        {isFormer ? <StatusChip label="Former investor" tone="neutral" /> : null}
      </header>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 @md:grid-cols-3">
        <Figure label="Capital in the business" value={formatPeso(investor.capital)} />
        <Figure
          label="Share of profit"
          value={investor.share === null ? '—' : formatPercent(investor.share)}
          tone={investor.share === null ? 'muted' : undefined}
        />
        <Figure label="Still owed" value={formatPeso(investor.owed)} tone={investor.owed < 0 ? 'negative' : undefined}>
          {investor.owed < 0 ? (
            <span className="text-xs text-muted-foreground">An advance, taken from their next share.</span>
          ) : null}
        </Figure>
        <Figure label="Put in" value={formatPeso(investor.putIn)} />
        <Figure label="Profit shared" value={formatPeso(investor.profitShared)} />
        <Figure label="Paid back" value={formatPeso(investor.paidOut + investor.capitalReturned)} />
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {isFormer ? null : (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setRecording('capital')}>
              Capital in
            </button>
          )}
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setRecording('payout')}>
            Pay out
          </button>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            onClick={() => setRecording('capital_return')}
          >
            Return capital
          </button>
          {isFormer ? null : (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setRecording('reinvest')}>
              Reinvest
            </button>
          )}
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            disabled={former.busy}
            onClick={async () => {
              const saved = await former.run(
                () => books.client.setInvestorFormer(books.scope, investor.id, !isFormer),
                'Could not change that.',
              );
              if (saved) onChanged();
            }}
          >
            {isFormer ? 'Restore as investor' : 'Mark as former'}
          </button>
        </div>
      ) : null}
      <Alert message={former.error} onDismiss={former.dismissError} />

      <section aria-labelledby="books-statement" className="flex flex-col gap-1">
        <h3 id="books-statement" className="text-sm font-semibold">
          Statement
        </h3>
        <Alert message={page.error} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 font-medium">What</th>
                <th className="py-1 text-right font-medium">Capital</th>
                <th className="py-1 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const view = line.entry.view;
                return (
                  <tr
                    key={view.id}
                    className={cn('border-t border-border align-top', line.voided ? 'opacity-60' : null)}
                  >
                    <td className="whitespace-nowrap py-1 pr-2">{formatDay(view.day)}</td>
                    <td className="py-1 pr-2">
                      <div className={cn(line.voided ? 'line-through' : null)}>
                        {entryTitle(view)} {formatPeso(view.amount)}
                        {view.place ? <span className="text-muted-foreground"> · {placeLabel(view.place)}</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[view.description, `by ${whoName(view.recordedByName)}`].filter(Boolean).join(' · ')}
                      </div>
                      {view.voidedAt ? <div className="text-xs text-destructive">Voided: {view.voidReason}</div> : null}
                    </td>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums">
                      {line.capitalChange === 0 ? '' : `${formatSignedPeso(line.capitalChange)} → `}
                      {formatPeso(line.capital)}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap py-1 text-right tabular-nums',
                        line.owed < 0 ? 'text-destructive' : null,
                      )}
                    >
                      {line.owedChange === 0 ? '' : `${formatSignedPeso(line.owedChange)} → `}
                      {formatPeso(line.owed)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {page.data && lines.length === 0 ? <Empty>Nothing recorded for {investor.name} yet.</Empty> : null}
        </div>
      </section>

      {recording ? (
        <InvestorEntryDialog
          open
          kind={recording}
          investor={investor}
          books={books}
          today={overview.today}
          onClose={() => setRecording(null)}
          onDone={done}
        />
      ) : null}
    </div>
  );
}
