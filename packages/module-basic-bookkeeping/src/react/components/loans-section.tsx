'use client';

import { cn, LIST_KEYS } from '@kwtech/web-ui/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { loanStatement } from '../../domain/statements.js';
import type { BooksLoanView, BooksOverviewView } from '../books-client.js';
import { type BooksContext, useBooksAction, useBooksData } from '../use-books.js';
import { formatDay, kindLabel, placeLabel, whoName } from '../view/labels.js';
import { ledgerLines } from '../view/ledger.js';
import { formatPeso, formatSignedPeso } from '../view/money.js';
import { buttonClass, Modal } from './controls.js';
import { LendDialog, RecordEntryDialog } from './dialogs.js';
import { Figure, FormActions, TextField } from './form-fields.js';
import { Alert, Empty, ListDetail, RowButton, StatusChip } from './layout.js';

/**
 * Money the business lent: to whom, how much is still owed, and every amount
 * lent and repaid. A loan is never edited — lending more and repayments are
 * entries — only who it is with.
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lending, setLending] = useState<BooksLoanView | 'new' | null>(null);
  const selected = overview.loans.find((loan) => loan.id === selectedId) ?? null;

  const list = (
    <>
      {canRecord ? (
        <div>
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setLending('new')}>
            Lend money
          </button>
        </div>
      ) : null}
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
    </>
  );

  return (
    <>
      <ListDetail
        list={list}
        detail={
          selected ? (
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
        onBack={() => setSelectedId(null)}
        backLabel="All loans"
      />
      <LendDialog
        open={lending !== null}
        loan={lending === 'new' ? null : lending}
        books={books}
        today={overview.today}
        onClose={() => setLending(null)}
        onDone={(loanId) => {
          setSelectedId(loanId);
          onChanged();
        }}
      />
    </>
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
