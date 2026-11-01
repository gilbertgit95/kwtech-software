'use client';

import { cn, LIST_KEYS, ListDrawer, listNeighbours } from '@kwtech/web-ui/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { loanStatement } from '../../domain/statements.js';
import type { BooksBorrowerView, BooksLoanView, BooksOverviewView } from '../books-client.js';
import { type BooksContext, useBooksAction, useBooksData } from '../use-books.js';
import { formatDay, kindLabel, placeLabel, whoName } from '../view/labels.js';
import { ledgerLines } from '../view/ledger.js';
import {
  BOOKS_LOANS_CAPPED_NOTE,
  BOOKS_LOANS_VIEW_STORAGE_KEY,
  BOOKS_LOANS_VIEWS,
  type BooksLoansView,
  borrowerSummary,
  isLoansCapped,
  loanCountLabel,
  parseLoansView,
} from '../view/loans.js';
import { formatPeso, formatSignedPeso } from '../view/money.js';
import { buttonClass, Modal } from './controls.js';
import { LendDialog, RecordEntryDialog } from './dialogs.js';
import { Figure, FormActions, TextField } from './form-fields.js';
import { Alert, Empty, RowButton, StatusChip, Tabs } from './layout.js';

function readLoansView(): BooksLoansView {
  try {
    return parseLoansView(window.localStorage.getItem(BOOKS_LOANS_VIEW_STORAGE_KEY));
  } catch {
    // Storage is blocked: the tab opens on Loans every time, nothing worse.
    return 'loans';
  }
}

function writeLoansView(view: BooksLoansView): void {
  try {
    window.localStorage.setItem(BOOKS_LOANS_VIEW_STORAGE_KEY, view);
  } catch {
    // As above: remembering is a convenience.
  }
}

/**
 * Money the business lent: to whom, how much is still owed, and every amount
 * lent and repaid. A loan is never edited — lending more and repayments are
 * entries — only who it is with. "By borrower" adds a person's loans up
 * (grouped by name on the server, `borrowerTotals`), so what one person owes
 * in all is one row.
 */
export function LoansSection({
  books,
  overview,
  canRecord,
  onChanged,
}: {
  books: BooksContext;
  overview: BooksOverviewView;
  canRecord: boolean;
  onChanged: () => void;
}) {
  const [view, setView] = useState<BooksLoansView>('loans');
  // Restored after the first render, not in useState: the server renders
  // without storage, and a different first frame would not hydrate.
  useEffect(() => setView(readLoansView()), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [lending, setLending] = useState<BooksLoanView | 'new' | null>(null);
  const selected = overview.loans.find((loan) => loan.id === selectedId) ?? null;
  const selectedBorrower = overview.borrowers.find((borrower) => borrower.key === selectedKey) ?? null;
  const showingBorrowers = view === 'borrowers' && selectedBorrower !== null;
  const around = showingBorrowers
    ? listNeighbours(
        overview.borrowers.map((borrower) => borrower.key),
        selectedBorrower.key,
      )
    : listNeighbours(
        overview.loans.map((loan) => loan.id),
        selected?.id ?? null,
      );
  const step = (to: string | null) => (showingBorrowers ? setSelectedKey(to) : setSelectedId(to));
  /** From a borrower's list of loans to that loan, on the Loans view where it can be repaid. */
  const openLoan = (loanId: string) => {
    setView('loans');
    setSelectedKey(null);
    setSelectedId(loanId);
  };

  const loansList = (
    <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto" {...LIST_KEYS}>
      {overview.loans.length === 0 ? <Empty>The business has not lent anybody money.</Empty> : null}
      {overview.loans.map((loan) => (
        <RowButton key={loan.id} selected={loan.id === selectedId} onClick={() => setSelectedId(loan.id)}>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{loan.borrowerName}</span>
            <span className="text-xs text-muted-foreground">Lent {formatPeso(loan.lent)}</span>
          </span>
          {loan.outstanding > 0 ? (
            <span className="shrink-0 text-xs tabular-nums">Owes {formatPeso(loan.outstanding)}</span>
          ) : (
            <StatusChip label="Paid" tone="success" />
          )}
        </RowButton>
      ))}
    </div>
  );

  const list = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canRecord ? (
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setLending('new')}>
            Lend money
          </button>
        ) : null}
        <Tabs
          tabs={BOOKS_LOANS_VIEWS}
          current={view}
          onChange={(next) => {
            setView(next);
            writeLoansView(next);
            setSelectedId(null);
            setSelectedKey(null);
          }}
          label="Show loans"
        />
      </div>
      {view === 'loans' ? (
        loansList
      ) : (
        <BorrowersList overview={overview} selectedKey={selectedKey} onSelect={setSelectedKey} />
      )}
    </>
  );

  return (
    <>
      <ListDrawer
        list={list}
        detail={
          showingBorrowers ? (
            <BorrowerDetail borrower={selectedBorrower} loans={overview.loans} onOpenLoan={openLoan} />
          ) : view === 'loans' && selected ? (
            <LoanDetail
              key={selected.id}
              books={books}
              overview={overview}
              loan={selected}
              canRecord={canRecord}
              onLendMore={() => setLending(selected)}
              onChanged={onChanged}
            />
          ) : null
        }
        onClose={() => (showingBorrowers ? setSelectedKey(null) : setSelectedId(null))}
        label={showingBorrowers ? 'borrower' : 'loan'}
        step={{
          onPrevious: around.previous ? () => step(around.previous) : null,
          onNext: around.next ? () => step(around.next) : null,
          position: around.position,
        }}
      />
      <LendDialog
        open={lending !== null}
        loan={lending === 'new' ? null : lending}
        books={books}
        today={overview.today}
        onClose={() => setLending(null)}
        onDone={(loanId) => {
          setView('loans');
          setSelectedKey(null);
          setSelectedId(loanId);
          onChanged();
        }}
      />
    </>
  );
}

/**
 * Every borrower, their loans added up, under a strip of the totals. The
 * unpaid total is the overview's `lentOutstanding` by another road.
 */
function BorrowersList({
  overview,
  selectedKey,
  onSelect,
}: {
  overview: BooksOverviewView;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const totals = borrowerSummary(overview.borrowers);

  return (
    <>
      {overview.borrowers.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 @md:grid-cols-4">
          <Figure label="Total lent" value={formatPeso(totals.lent)} />
          <Figure label="Repaid" value={formatPeso(totals.repaid)} />
          <Figure label="Unpaid" value={formatPeso(totals.unpaid)} />
          <Figure label="Still owing" value={`${totals.owing} of ${totals.borrowers}`} />
        </div>
      ) : null}
      {isLoansCapped(overview.loans.length) ? (
        <p className="text-xs text-muted-foreground">{BOOKS_LOANS_CAPPED_NOTE}</p>
      ) : null}
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto" {...LIST_KEYS}>
        {overview.borrowers.length === 0 ? <Empty>The business has not lent anybody money.</Empty> : null}
        {overview.borrowers.map((borrower) => (
          <RowButton key={borrower.key} selected={borrower.key === selectedKey} onClick={() => onSelect(borrower.key)}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{borrower.borrowerName}</span>
              <span className="text-xs text-muted-foreground">
                Lent {formatPeso(borrower.lent)} · {loanCountLabel(borrower)}
                {borrower.lastDay ? ` · ${formatDay(borrower.lastDay)}` : ''}
              </span>
            </span>
            {borrower.outstanding > 0 ? (
              <span className="shrink-0 text-xs tabular-nums">Owes {formatPeso(borrower.outstanding)}</span>
            ) : (
              <StatusChip label="Paid" tone="success" />
            )}
          </RowButton>
        ))}
      </div>
    </>
  );
}

/** One borrower's totals and their loans; a loan opens on the Loans view, where repayments are recorded. */
function BorrowerDetail({
  borrower,
  loans,
  onOpenLoan,
}: {
  borrower: BooksBorrowerView;
  loans: readonly BooksLoanView[];
  onOpenLoan: (loanId: string) => void;
}) {
  const byId = new Map(loans.map((loan) => [loan.id, loan]));
  const theirs = borrower.loanIds.flatMap((id) => {
    const loan = byId.get(id);
    return loan ? [loan] : [];
  });

  return (
    <div className="flex flex-col gap-3">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">{borrower.borrowerName}</h2>
        <p className="text-xs text-muted-foreground">
          {loanCountLabel(borrower)}
          {borrower.lastDay ? ` · last activity ${formatDay(borrower.lastDay)}` : ''}
        </p>
      </header>
      <div className="grid grid-cols-3 gap-3 rounded-lg border border-border p-3">
        <Figure label="Total borrowed" value={formatPeso(borrower.lent)} />
        <Figure label="Paid" value={formatPeso(borrower.repaid)} />
        <Figure label="Unpaid" value={formatPeso(borrower.outstanding)} />
      </div>
      <div className="flex flex-col gap-1.5">
        {theirs.map((loan) => (
          <RowButton key={loan.id} selected={false} onClick={() => onOpenLoan(loan.id)}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">Lent {formatPeso(loan.lent)}</span>
              <span className="text-xs text-muted-foreground">
                Repaid {formatPeso(loan.repaid)}
                {loan.lastDay ? ` · ${formatDay(loan.lastDay)}` : ''}
              </span>
            </span>
            {loan.outstanding > 0 ? (
              <span className="shrink-0 text-xs tabular-nums">Owes {formatPeso(loan.outstanding)}</span>
            ) : (
              <StatusChip label="Paid" tone="success" />
            )}
          </RowButton>
        ))}
      </div>
    </div>
  );
}

function LoanDetail({
  books,
  overview,
  loan,
  canRecord,
  onLendMore,
  onChanged,
}: {
  books: BooksContext;
  overview: BooksOverviewView;
  loan: BooksLoanView;
  canRecord: boolean;
  onLendMore: () => void;
  onChanged: () => void;
}) {
  const load = useCallback(
    () => books.client.entries(books.scope, { loanId: loan.id }),
    [books.client, books.scope, loan.id],
  );
  const page = useBooksData(books.scope, load, 'Could not load the loan.');
  const [repaying, setRepaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const lines = page.data ? loanStatement(ledgerLines(page.data.entries)) : [];
  const done = () => {
    void page.reload();
    onChanged();
  };
  const about = [loan.contact, loan.note].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-3">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">{loan.borrowerName}</h2>
        <p className="text-xs text-muted-foreground">{about === '' ? 'No contact or note.' : about}</p>
      </header>
      <div className="grid grid-cols-3 gap-3 rounded-lg border border-border p-3">
        <Figure label="Lent" value={formatPeso(loan.lent)} />
        <Figure label="Repaid" value={formatPeso(loan.repaid)} />
        <Figure label="Still owed" value={formatPeso(loan.outstanding)} />
      </div>
      {canRecord ? (
        <div className="flex flex-wrap gap-2">
          {loan.outstanding > 0 ? (
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setRepaying(true)}>
              Record repayment
            </button>
          ) : null}
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={onLendMore}>
            Lend more
          </button>
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setEditing(true)}>
            Edit borrower
          </button>
        </div>
      ) : null}

      <Alert message={page.error} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">What</th>
              <th className="py-1 text-right font-medium">Amount</th>
              <th className="py-1 text-right font-medium">Still owed</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const view = line.entry.view;
              return (
                <tr key={view.id} className={cn('border-t border-border align-top', line.voided ? 'opacity-60' : null)}>
                  <td className="whitespace-nowrap py-1 pr-2">{formatDay(view.day)}</td>
                  <td className="py-1 pr-2">
                    <div className={cn(line.voided ? 'line-through' : null)}>
                      {kindLabel(view.kind)} · {placeLabel(view.place)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[view.description, `by ${whoName(view.recordedByName)}`].filter(Boolean).join(' · ')}
                    </div>
                    {view.voidedAt ? <div className="text-xs text-destructive">Voided: {view.voidReason}</div> : null}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right tabular-nums">
                    {line.voided ? formatPeso(view.amount) : formatSignedPeso(line.change)}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right tabular-nums">{formatPeso(line.outstanding)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {page.data && lines.length === 0 ? <Empty>Nothing recorded on this loan.</Empty> : null}
      </div>

      <RecordEntryDialog
        open={repaying}
        kind="loan_repayment"
        loanId={loan.id}
        books={books}
        overview={overview}
        onClose={() => setRepaying(false)}
        onDone={done}
      />
      <BorrowerDialog open={editing} loan={loan} books={books} onClose={() => setEditing(false)} onDone={onChanged} />
    </div>
  );
}

/** Correcting who a loan is with. The money is in the entries and never edited. */
function BorrowerDialog({
  open,
  loan,
  books,
  onClose,
  onDone,
}: {
  open: boolean;
  loan: BooksLoanView;
  books: BooksContext;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(loan.borrowerName);
  const [contact, setContact] = useState(loan.contact ?? '');
  const [note, setNote] = useState(loan.note ?? '');
  const action = useBooksAction();
  useEffect(() => {
    if (!open) return;
    setName(loan.borrowerName);
    setContact(loan.contact ?? '');
    setNote(loan.note ?? '');
  }, [open, loan]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await action.run(
      () =>
        books.client.saveLoan(books.scope, loan.id, {
          borrowerName: name,
          contact: contact.trim() === '' ? null : contact,
          note: note.trim() === '' ? null : note,
        }),
      'Could not save the borrower.',
    );
    if (!saved) return;
    onDone();
    onClose();
  }

  return (
    <Modal open={open} title="Edit borrower" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <TextField label="Borrower" value={name} onChange={setName} autoFocus />
        <TextField label="Contact (optional)" value={contact} onChange={setContact} />
        <TextField label="Note (optional)" value={note} onChange={setNote} />
        <FormActions
          busy={action.busy}
          error={action.error}
          submitLabel="Save"
          busyLabel="Saving…"
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}
