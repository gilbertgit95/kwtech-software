'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { previousBooksDay } from '../../domain/days.js';
import { BOOKS_EXPENSE_CATEGORIES, BOOKS_PURCHASE_CATEGORIES, BOOKS_RECORDED_KINDS } from '../../domain/entries.js';
import { prepareBooksReason } from '../../domain/text.js';
import type { BooksEntryKind } from '../../types.js';
import type {
  BooksInvestorView,
  BooksLoanView,
  BooksOverviewView,
  BooksPosSalesView,
  BooksSharePlanView,
} from '../books-client.js';
import type { BooksContext } from '../use-books.js';
import { useBooksAction } from '../use-books.js';
import {
  type EntryDraft,
  emptyEntryDraft,
  emptyInvestorEntryDraft,
  emptyLendDraft,
  type FieldErrors,
  type InvestorDraft,
  type InvestorEntryDraft,
  type InvestorField,
  type LendDraft,
  newClientId,
  validateEntryDraft,
  validateInvestorDraft,
  validateInvestorEntryDraft,
  validateLendDraft,
} from '../view/forms.js';
import { formatDay, formatDays, KIND_HINT, KIND_LABEL } from '../view/labels.js';
import { formatPercent, formatPeso, parsePeso, percentInputValue } from '../view/money.js';
import { Modal } from './controls.js';
import { AmountField, DayField, Figure, FormActions, PlaceField, SelectField, TextField } from './form-fields.js';

/*
 * Every form the books open. Each validates with the same domain checks the
 * server runs (`view/forms.ts`), sends a fresh client id per opening — so a
 * double press records once — and closes on success. The screens re-read when
 * the books' event arrives; `onDone` reloads for when it does not (not live).
 */

const MONEY_IN: readonly BooksEntryKind[] = ['sales', 'adjustment_in', 'loan_repayment'];
const MONEY_OUT: readonly BooksEntryKind[] = ['expense', 'purchase', 'refund', 'adjustment_out'];

/** Which group a kind is listed under in the record form. */
function recordGroup(kind: BooksEntryKind): string {
  if (MONEY_IN.includes(kind)) return 'Money in';
  if (MONEY_OUT.includes(kind)) return 'Money out';
  return 'Moved';
}

/** The record form's kinds, grouped by which way the money went. */
const RECORD_OPTIONS = BOOKS_RECORDED_KINDS.map((kind) => ({
  value: kind,
  label: KIND_LABEL[kind],
  group: recordGroup(kind),
}));

/** The suggested categories for a kind: what it was for. None for kinds that take none. */
function categoriesFor(kind: BooksEntryKind): readonly string[] {
  if (kind === 'expense') return BOOKS_EXPENSE_CATEGORIES;
  if (kind === 'purchase') return BOOKS_PURCHASE_CATEGORIES;
  return [];
}

/** What an investor form says the most is, for the kinds that have a most. */
function investorLimit(kind: InvestorEntryDraft['kind'], investor: BooksInvestorView): string | undefined {
  if (kind === 'capital_return') return `They have ${formatPeso(investor.capital)} in the business.`;
  if (kind === 'capital') return undefined;
  return `They are owed ${formatPeso(investor.owed)}.`;
}

/** A client id per OPENING of a form: a second press sends the same one, a second opening a new one. */
function useClientId(open: boolean): string {
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new id exactly when the form opens again.
  return useMemo(() => newClientId(), [open]);
}

/** Recording the day's money: sales, refunds, expenses, purchases, transfers, count adjustments, repayments. */
export function RecordEntryDialog({
  open,
  kind,
  loanId,
  books,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: BooksEntryKind;
  /** A repayment opened from a loan: that loan, fixed. */
  loanId?: string | undefined;
  books: BooksContext;
  overview: BooksOverviewView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<EntryDraft>(() => emptyEntryDraft(kind, overview.today));
  const [errors, setErrors] = useState<FieldErrors<keyof EntryDraft>>({});
  const action = useBooksAction();
  const clientId = useClientId(open);
  useEffect(() => {
    if (!open) return;
    setDraft({ ...emptyEntryDraft(kind, overview.today), loanId: loanId ?? '' });
    setErrors({});
    action.dismissError();
  }, [open, kind, loanId, overview.today, action.dismissError]);

  const set = (patch: Partial<EntryDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const openLoans = overview.loans.filter((loan) => loan.outstanding > 0);
  const loan = overview.loans.find((candidate) => candidate.id === draft.loanId) ?? null;
  const categories = categoriesFor(draft.kind);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateEntryDraft(draft, { today: overview.today, clientId, loan });
    if ('errors' in checked) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    const saved = await action.run(() => books.client.record(books.scope, checked.input), 'Could not record it.');
    if (!saved) return;
    onDone();
    onClose();
  }

  return (
    <Modal open={open} title="Record money" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <SelectField
          label="What happened"
          value={draft.kind}
          onChange={(next) => set({ kind: next, category: '' })}
          options={RECORD_OPTIONS}
          hint={KIND_HINT[draft.kind]}
        />
        <AmountField value={draft.amount} onChange={(amount) => set({ amount })} error={errors.amount} autoFocus />
        <PlaceField
          label={draft.kind === 'transfer' ? 'From' : 'Where'}
          value={draft.place}
          onChange={(place) => set({ place })}
          error={errors.place}
        />
        {draft.kind === 'transfer' ? (
          <PlaceField
            label="To"
            value={draft.toPlace}
            onChange={(toPlace) => set({ toPlace })}
            error={errors.toPlace}
          />
        ) : null}
        {draft.kind === 'loan_repayment' ? (
          <LoanPicker
            loans={openLoans}
            value={draft.loanId}
            onChange={(next) => set({ loanId: next })}
            error={errors.loanId}
          />
        ) : null}
        {categories.length > 0 || draft.kind === 'adjustment_in' ? (
          <>
            <TextField
              label={draft.kind === 'adjustment_in' ? 'Reason (optional)' : 'For'}
              value={draft.category}
              onChange={(category) => set({ category })}
              error={errors.category}
              placeholder={draft.kind === 'adjustment_in' ? 'Opening balance' : categories[0]}
              list={categories.length > 0 ? 'books-categories' : undefined}
            />
            <datalist id="books-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </>
        ) : null}
        <DayField value={draft.day} onChange={(day) => set({ day })} error={errors.day} max={overview.today} />
        <TextField
          label="Note (optional)"
          value={draft.description}
          onChange={(description) => set({ description })}
          error={errors.description}
        />
        <TextField
          label="Receipt or reference (optional)"
          value={draft.reference}
          onChange={(reference) => set({ reference })}
          error={errors.reference}
        />
        <FormActions
          busy={action.busy}
          error={action.error}
          submitLabel="Record"
          busyLabel="Recording…"
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

/** Which loan a repayment is for — or why there is none to choose. */
function LoanPicker({
  loans,
  value,
  onChange,
  error,
}: {
  loans: readonly BooksLoanView[];
  value: string;
  onChange: (loanId: string) => void;
  error?: string | undefined;
}) {
  if (loans.length === 0)
    return <p className="text-sm text-muted-foreground">Nobody owes the business money right now.</p>;
  return (
    <SelectField
      label="Which loan"
      value={value}
      onChange={onChange}
      options={[
        { value: '', label: 'Choose…' },
        ...loans.map((loan) => ({
          value: loan.id,
          label: `${loan.borrowerName} — owes ${formatPeso(loan.outstanding)}`,
        })),
      ]}
      error={error}
    />
  );
}

const INVESTOR_TITLE: Readonly<Record<InvestorEntryDraft['kind'], string>> = {
  capital: 'Record capital put in',
  payout: 'Pay out profit',
  capital_return: 'Return capital',
  reinvest: 'Reinvest owed profit',
};

const INVESTOR_HINT: Readonly<Record<InvestorEntryDraft['kind'], string>> = {
  capital: 'Money the investor puts into the business. It raises their capital — and, by capital, their share.',
  payout: 'Paid from the profit they are owed. Their capital and share stay as they are.',
  capital_return: 'Part of what they put in, given back. It lowers their capital — and, by capital, their share.',
  reinvest: 'Profit they are owed, left in the business as capital. No money moves.',
};

/** An investor's money: capital in, a payout, a capital return, a reinvestment. */
export function InvestorEntryDialog({
  open,
  kind,
  investor,
  books,
  today,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: InvestorEntryDraft['kind'];
  investor: BooksInvestorView;
  books: BooksContext;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<InvestorEntryDraft>(() => emptyInvestorEntryDraft(kind, today));
  const [errors, setErrors] = useState<FieldErrors<keyof InvestorEntryDraft>>({});
  const action = useBooksAction();
  const clientId = useClientId(open);
  useEffect(() => {
    if (!open) return;
    setDraft(emptyInvestorEntryDraft(kind, today));
    setErrors({});
    action.dismissError();
  }, [open, kind, today, action.dismissError]);
  const set = (patch: Partial<InvestorEntryDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateInvestorEntryDraft(draft, investor, { today, clientId });
    if ('errors' in checked) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    const saved = await action.run(
      () => books.client.recordInvestor(books.scope, checked.input),
      'Could not record it.',
    );
    if (!saved) return;
    onDone();
    onClose();
  }

  const limit = investorLimit(kind, investor);

  return (
    <Modal open={open} title={`${INVESTOR_TITLE[kind]} — ${investor.name}`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <p className="text-sm text-muted-foreground">{INVESTOR_HINT[kind]}</p>
        <AmountField
          value={draft.amount}
          onChange={(amount) => set({ amount })}
          error={errors.amount}
          hint={limit}
          autoFocus
        />
        {kind === 'reinvest' ? null : (
          <PlaceField
            label={kind === 'capital' ? 'Put into' : 'Paid from'}
            value={draft.place}
            onChange={(place) => set({ place })}
            error={errors.place}
          />
        )}
        {kind === 'payout' ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.advance}
              onChange={(event) => set({ advance: event.target.checked })}
            />
            <span>An advance — paid ahead of profit. It leaves them owing, and comes off their next share.</span>
          </label>
        ) : null}
        <DayField value={draft.day} onChange={(day) => set({ day })} error={errors.day} max={today} />
        <TextField
          label="Note (optional)"
          value={draft.description}
          onChange={(description) => set({ description })}
          error={errors.description}
        />
        <TextField
          label="Receipt or reference (optional)"
          value={draft.reference}
          onChange={(reference) => set({ reference })}
          error={errors.reference}
        />
        <FormActions
          busy={action.busy}
          error={action.error}
          submitLabel="Record"
          busyLabel="Recording…"
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

/** Lending money: to somebody new, or more to a borrower already owing. */
export function LendDialog({
  open,
  loan,
  books,
  today,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Lend more to this borrower; null for a new loan. */
  loan: BooksLoanView | null;
  books: BooksContext;
  today: string;
  onClose: () => void;
  onDone: (loanId: string) => void;
}) {
  const [draft, setDraft] = useState<LendDraft>(() => emptyLendDraft(today, loan?.id ?? ''));
  const [errors, setErrors] = useState<FieldErrors<keyof LendDraft>>({});
  const action = useBooksAction();
  const clientId = useClientId(open);
  useEffect(() => {
    if (!open) return;
    setDraft(emptyLendDraft(today, loan?.id ?? ''));
    setErrors({});
    action.dismissError();
  }, [open, today, loan?.id, action.dismissError]);
  const set = (patch: Partial<LendDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateLendDraft(draft, { today, clientId });
    if ('errors' in checked) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    const saved = await action.run(() => books.client.lend(books.scope, checked.input), 'Could not record the loan.');
    if (!saved) return;
    onDone(saved.id);
    onClose();
  }

  return (
    <Modal open={open} title={loan ? `Lend more to ${loan.borrowerName}` : 'Lend money'} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        {loan ? null : (
          <>
            <TextField
              label="Borrower"
              value={draft.borrowerName}
              onChange={(borrowerName) => set({ borrowerName })}
              error={errors.borrowerName}
              autoFocus
            />
            <TextField
              label="Contact (optional)"
              value={draft.contact}
              onChange={(contact) => set({ contact })}
              error={errors.contact}
            />
          </>
        )}
        <AmountField
          value={draft.amount}
          onChange={(amount) => set({ amount })}
          error={errors.amount}
          autoFocus={loan !== null}
        />
        <PlaceField label="Paid from" value={draft.place} onChange={(place) => set({ place })} error={errors.place} />
        <DayField value={draft.day} onChange={(day) => set({ day })} error={errors.day} max={today} />
        <TextField
          label="Note (optional)"
          value={loan ? draft.description : draft.note}
          onChange={(text) => set(loan ? { description: text } : { note: text })}
          error={loan ? errors.description : errors.note}
          hint={loan ? undefined : 'What it is for, or when they will pay it back.'}
        />
        <FormActions
          busy={action.busy}
          error={action.error}
          submitLabel="Lend"
          busyLabel="Recording…"
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

/** Voiding: kept, with who and why, and counted for nothing. A reason is required. */
export function VoidDialog({
  open,
  title,
  description,
  onClose,
  onVoid,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  /** Resolves null when it went through, or the sentence saying why not. */
  onVoid: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ('refused' in prepareBooksReason(reason)) {
      setError('Say why, in one line — it stays with the voided entry.');
      return;
    }
    setBusy(true);
    const failed = await onVoid(reason);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <p className="text-sm text-muted-foreground">{description}</p>
        <TextField label="Why" value={reason} onChange={setReason} autoFocus placeholder="Entered twice" />
        <FormActions busy={busy} error={error} submitLabel="Void" busyLabel="Voiding…" onCancel={onClose} danger />
      </form>
    </Modal>
  );
}

/** Bringing the point of sale's sales in, through a day the person chooses, with a preview first. */
export function PosSalesDialog({
  open,
  books,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  books: BooksContext;
  overview: BooksOverviewView;
  onClose: () => void;
  onDone: () => void;
}) {
  const yesterday = useMemo(() => previousBooksDay(overview.today), [overview.today]);
  const [toDay, setToDay] = useState(yesterday);
  const [preview, setPreview] = useState<BooksPosSalesView | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const action = useBooksAction();
  const clientId = useClientId(open);
  const fromDay = overview.pos.nextFromDay;

  useEffect(() => {
    if (!open) return;
    setToDay(fromDay && fromDay > yesterday ? overview.today : yesterday);
    action.dismissError();
  }, [open, yesterday, fromDay, overview.today, action.dismissError]);

  useEffect(() => {
    if (!open || !toDay) return;
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    books.client
      .posSalesPreview(books.scope, toDay)
      .then((answer) => {
        if (!cancelled) setPreview(answer);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setPreviewError(caught instanceof Error ? caught.message : 'Could not read the sales.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, toDay, books.client, books.scope]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await action.run(
      () => books.client.recordPosSales(books.scope, toDay, clientId),
      'Could not bring the sales in.',
    );
    if (!saved) return;
    onDone();
    onClose();
  }

  return (
    <Modal open={open} title="Bring in point-of-sale sales" onClose={onClose} wide>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <p className="text-sm text-muted-foreground">
          {fromDay
            ? `From ${formatDay(fromDay)} — the first day not yet in the books — through the day you choose. Bring in whole days: today is still selling.`
            : 'Choose the first day to bring in, in Settings.'}
        </p>
        <DayField label="Through" value={toDay} onChange={setToDay} max={overview.today} />
        {previewError ? (
          <p role="alert" className="text-sm text-destructive">
            {previewError}
          </p>
        ) : null}
        {preview ? (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 @md:grid-cols-4">
            <Figure label="Cash" value={formatPeso(preview.cash)} />
            <Figure label="E-wallet" value={formatPeso(preview.ewallet)} />
            <Figure label="Bank (cards)" value={formatPeso(preview.bank)} />
            <Figure label="Orders" value={String(preview.orders)} />
            <Figure label="Cost of goods" value={formatPeso(preview.costOfGoods)}>
              {preview.costCoverage < 10_000 ? (
                <span className="text-xs text-muted-foreground">
                  Only {formatPercent(preview.costCoverage)} of sales have a cost, so profit will read high.
                </span>
              ) : null}
            </Figure>
          </div>
        ) : null}
        {preview?.truncated ? (
          <p role="alert" className="text-sm text-destructive">
            Too many orders to count at once — choose an earlier day.
          </p>
        ) : null}
        <FormActions
          busy={action.busy}
          error={action.error}
          submitLabel="Bring them in"
          busyLabel="Bringing in…"
          onCancel={onClose}
          disabled={!preview || preview.truncated}
        />
      </form>
    </Modal>
  );
}

/** Adding or editing an investor. */
export function InvestorDialog({
  open,
  investor,
  books,
  shareMode,
  onClose,
  onDone,
}: {
  open: boolean;
  investor: BooksInvestorView | null;
  books: BooksContext;
  shareMode: string;
  onClose: () => void;
  onDone: (investorId: string) => void;
}) {
  const initial = (): InvestorDraft => ({
    name: investor?.name ?? '',
    contact: investor?.contact ?? '',
    note: investor?.note ?? '',
    agreedShare: percentInputValue(investor?.agreedShare ?? null),
  });
  const [draft, setDraft] = useState<InvestorDraft>(initial);
  const [errors, setErrors] = useState<FieldErrors<InvestorField>>({});
  const action = useBooksAction();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset exactly when the dialog opens, from the investor it opened on.
  useEffect(() => {
    if (!open) return;
    setDraft(initial());
    setErrors({});
    action.dismissError();
  }, [open]);
  const set = (patch: Partial<InvestorDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateInvestorDraft(draft, investor?.id ?? null);
    if ('errors' in checked) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    const saved = await action.run(
      () => books.client.saveInvestor(books.scope, checked.input),
      'Could not save the investor.',
    );
    if (!saved) return;
    onDone(saved.id);
    onClose();
  }

  return (
    <Modal open={open} title={investor ? `Edit ${investor.name}` : 'Add an investor'} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <TextField label="Name" value={draft.name} onChange={(name) => set({ name })} error={errors.name} autoFocus />
        <TextField
          label="Contact (optional)"
          value={draft.contact}
          onChange={(contact) => set({ contact })}
          error={errors.contact}
        />
        <TextField label="Note (optional)" value={draft.note} onChange={(note) => set({ note })} error={errors.note} />
        <TextField
          label="Agreed share (%)"
          value={draft.agreedShare}
          onChange={(agreedShare) => set({ agreedShare })}
          error={errors.agreedShare}
          inputMode="decimal"
          hint={
            shareMode === 'agreed'
              ? 'Profit is shared by agreement: every current investor needs one, adding up to 100%.'
              : 'Only used if profit is shared by agreement (Settings). Profit is shared by capital now.'
          }
        />
        <FormActions
          busy={action.busy}
          error={action.error}
          submitLabel={investor ? 'Save' : 'Add investor'}
          busyLabel="Saving…"
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

/** Sharing a period's profit: through a day, keeping some in the business, previewed by the server's own plan. */
export function ShareProfitDialog({
  open,
  books,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  books: BooksContext;
  overview: BooksOverviewView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [toDay, setToDay] = useState(overview.today);
  const [kept, setKept] = useState('0');
  const [plan, setPlan] = useState<BooksSharePlanView | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const action = useBooksAction();
  const clientId = useClientId(open);
  const keptAmount = parsePeso(kept);

  useEffect(() => {
    if (!open) return;
    setToDay(overview.today);
    setKept('0');
    action.dismissError();
  }, [open, overview.today, action.dismissError]);

  useEffect(() => {
    if (!open || keptAmount === null || !toDay) return;
    let cancelled = false;
    setPlanError(null);
    books.client
      .sharePreview(books.scope, toDay, keptAmount)
      .then((answer) => {
        if (!cancelled) setPlan(answer);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setPlanError(caught instanceof Error ? caught.message : 'Could not work out the shares.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, toDay, keptAmount, books.client, books.scope]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (keptAmount === null) return;
    const saved = await action.run(
      () => books.client.shareProfit(books.scope, toDay, keptAmount, clientId),
      'Could not share the profit.',
    );
    if (!saved) return;
    onDone();
    onClose();
  }

  const names = new Map(overview.investors.map((investor) => [investor.id, investor.name]));

  return (
    <Modal open={open} title="Share profit" onClose={onClose} wide>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <p className="text-sm text-muted-foreground">
          Each investor’s part is added to what they are owed; pay it out from their page, whenever and in as many parts
          as you like. Once shared, the period’s sales, expenses and capital are closed.
        </p>
        <div className="grid gap-3 @md:grid-cols-2">
          <DayField label="Share profit through" value={toDay} onChange={setToDay} max={overview.today} />
          <AmountField
            label="Keep in the business (₱)"
            value={kept}
            onChange={setKept}
            error={keptAmount === null ? 'Enter an amount, or 0.' : undefined}
            hint="Profit to reinvest rather than share."
          />
        </div>
        {planError ? (
          <p role="alert" className="text-sm text-destructive">
            {planError}
          </p>
        ) : null}
        {plan?.profit ? (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 @md:grid-cols-3">
            <Figure label="Sales" value={formatPeso(plan.profit.sales - plan.profit.refunds)} />
            <Figure label="Cost of goods" value={formatPeso(plan.profit.costOfGoods)} />
            <Figure label="Expenses" value={formatPeso(plan.profit.expenses)} />
            <Figure
              label={plan.fromDay ? `Profit, ${formatDays(plan.fromDay, plan.toDay)}` : 'Profit'}
              value={formatPeso(plan.profit.profit)}
              tone={plan.profit.profit < 0 ? 'negative' : undefined}
            />
            <Figure label="Kept" value={formatPeso(plan.kept)} />
            <Figure label="To share" value={formatPeso(plan.shared)} />
          </div>
        ) : null}
        {plan && !plan.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {plan.refusal}
          </p>
        ) : null}
        {plan?.ok ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Investor</th>
                <th className="py-1 text-right font-medium">Share</th>
                <th className="py-1 text-right font-medium">Gets</th>
              </tr>
            </thead>
            <tbody>
              {plan.parts.map((part) => (
                <tr key={part.investorId} className="border-t border-border">
                  <td className="py-1">{names.get(part.investorId) ?? 'A former investor'}</td>
                  <td className="py-1 text-right tabular-nums">{formatPercent(part.share)}</td>
                  <td className="py-1 text-right tabular-nums">{formatPeso(part.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <FormActions
          busy={action.busy}
          error={action.error}
          submitLabel="Share profit"
          busyLabel="Sharing…"
          onCancel={onClose}
          disabled={!plan?.ok}
        />
      </form>
    </Modal>
  );
}
