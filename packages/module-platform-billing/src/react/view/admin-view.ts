import { isDayKey } from '../../domain/days.js';
import {
  BILLING_GRACE_MAX,
  BILLING_ISSUER_DETAILS_MAX,
  BILLING_TEXT_MAX,
  isPaymentMethod,
} from '../../domain/payments.js';
import type {
  BillingQueueFlagsView,
  BillingQueueItemView,
  BillingSettingsInput,
  BillingSettingsView,
} from '../billing-admin-client.js';
import type { BillingRequestView } from '../billing-client.js';
import { formatMoney } from './billing-view.js';
import { type PaymentDraft, parseAmount } from './payment-form.js';

/**
 * THE PLATFORM'S BILLING PAGES, as pure rules (phase 7): what each check on
 * a request means, which requests are ready to check, what the approval
 * form starts from, and what the settings form refuses before sending.
 */

/** One check on a request, in words, with what triggered it. A check flags; the approver decides (plan §4). */
export interface QueueCheck {
  /** `warning` asks for a closer look; `info` is worth knowing. */
  tone: 'warning' | 'info';
  text: string;
}

/** Every check that flags on `flags`, each saying what triggered it. */
export function queueChecks(flags: BillingQueueFlagsView, currency: string): QueueCheck[] {
  const checks: QueueCheck[] = [];
  if (flags.missingDetails) {
    checks.push({ tone: 'warning', text: 'No payment details yet: there is nothing to check against the bill.' });
  }
  if (flags.amount === 'short') {
    checks.push({
      tone: 'warning',
      text: `The details are ${formatMoney(flags.amountDifference, currency)} short of the bill: it cannot be approved until the rest is paid.`,
    });
  }
  if (flags.amount === 'over') {
    checks.push({
      tone: 'info',
      text: `The details are ${formatMoney(flags.amountDifference, currency)} over the bill: the difference becomes credit.`,
    });
  }
  if (flags.referenceUsedOn.length > 0) {
    const count = flags.referenceUsedOn.length;
    checks.push({
      tone: 'warning',
      text: `The same reference was used on ${count === 1 ? 'another request' : `${count} other requests`}: check it is not the same payment twice.`,
    });
  }
  if (flags.holdInForce) {
    checks.push({ tone: 'info', text: 'Access is held while this waits: deciding it ends the hold.' });
  }
  if (flags.selfRequest) {
    checks.push({ tone: 'info', text: 'You made this request: approving it is recorded as a self-approval.' });
  }
  if (flags.viewerIsMember) {
    checks.push({ tone: 'info', text: 'You belong to this organization: it is recorded with the decision.' });
  }
  return checks;
}

/** Whether a waiting request is ready to check: its payment details cover the bill. */
export function isReadyToCheck(request: Pick<BillingRequestView, 'coveredOn' | 'state'>): boolean {
  return request.state === 'pending' && request.coveredOn !== null;
}

/** The queue as an approver works it: ready to check first, then the oldest first. */
export function sortQueue(items: readonly BillingQueueItemView[]): BillingQueueItemView[] {
  return [...items].sort(
    (a, b) =>
      Number(isReadyToCheck(b.request)) - Number(isReadyToCheck(a.request)) ||
      a.request.requestedAt.localeCompare(b.request.requestedAt),
  );
}

/**
 * The approval form, pre-filled from the owner's latest details (plan §4):
 * the approver confirms what actually arrived, which is usually what was
 * said. With no details, the bill's total and today.
 */
export function approvalDraft(request: Pick<BillingRequestView, 'payments' | 'bill'>, today: string): PaymentDraft {
  const latest = request.payments.at(-1) ?? null;
  const amount = latest?.amount ?? request.bill?.total ?? 0;
  return {
    method: latest?.method ?? 'cash',
    amount: (amount / 100).toFixed(2),
    paidOn: latest?.paidOn ?? today,
    reference: latest?.reference ?? '',
    sender: latest?.sender ?? '',
    note: '',
  };
}

/** The words for a missing or overlong reason (a rejection, a void, a close), or null when it will do. */
export function checkDecisionReason(reason: string, required: boolean): string | null {
  const text = reason.trim();
  if (required && !text) return 'Say why. The organization reads it in its history.';
  if (text.length > BILLING_TEXT_MAX) return `Keep it to ${BILLING_TEXT_MAX} characters.`;
  return null;
}

/** One payment account as typed, with a key of its own so a list of them keeps its rows apart while edited. */
export interface PaymentAccountDraft {
  key: string;
  method: string;
  label: string;
  details: string;
}

/** The settings form as typed. */
export interface SettingsDraft {
  currency: string;
  timeZone: string;
  graceDays: string;
  issuerName: string;
  issuerDetails: string;
  paymentAccounts: PaymentAccountDraft[];
}

/**
 * The settings form, started from the settings in force. Each account gets
 * a key from its place: the rows are rebuilt on every read, so the key only
 * has to stay put while one draft is edited.
 */
export function settingsDraft(settings: BillingSettingsView): SettingsDraft {
  return {
    currency: settings.currency,
    timeZone: settings.timeZone,
    graceDays: String(settings.graceDays),
    issuerName: settings.issuerName,
    issuerDetails: settings.issuerDetails,
    paymentAccounts: settings.paymentAccounts.map((account, index) => ({ key: `saved-${index}`, ...account })),
  };
}

export type SettingsDraftErrors = Partial<Record<keyof SettingsDraft, string>>;

/** What is wrong with the settings draft, by field: the server's rules (D16), said before sending. */
export function checkSettingsDraft(draft: SettingsDraft): SettingsDraftErrors {
  const errors: SettingsDraftErrors = {};
  if (!/^[A-Z]{3}$/.test(draft.currency)) errors.currency = 'Use a three-letter currency code, like PHP.';
  if (!draft.timeZone.trim()) errors.timeZone = 'Give a time zone, like Asia/Manila.';
  const grace = Number(draft.graceDays);
  if (!/^\d+$/.test(draft.graceDays) || grace > BILLING_GRACE_MAX) {
    errors.graceDays = `Use a whole number of days from 0 to ${BILLING_GRACE_MAX}.`;
  }
  if (draft.issuerName.length > BILLING_TEXT_MAX) errors.issuerName = `Keep it to ${BILLING_TEXT_MAX} characters.`;
  if (draft.issuerDetails.length > BILLING_ISSUER_DETAILS_MAX) {
    errors.issuerDetails = `Keep it to ${BILLING_ISSUER_DETAILS_MAX.toLocaleString('en-US')} characters.`;
  }
  if (draft.paymentAccounts.some((account) => !isPaymentMethod(account.method) || !account.label.trim())) {
    errors.paymentAccounts = 'Every account needs a method and a label.';
  }
  return errors;
}

/**
 * The change the draft makes, as the server takes it: only the fields that
 * changed, so a locked currency or time zone left as it is is never sent and
 * never refused.
 */
export function settingsChange(
  draft: SettingsDraft,
  current: Pick<
    BillingSettingsView,
    'currency' | 'timeZone' | 'graceDays' | 'issuerName' | 'issuerDetails' | 'paymentAccounts'
  >,
): BillingSettingsInput {
  const change: BillingSettingsInput = {};
  if (draft.currency !== current.currency) change.currency = draft.currency;
  if (draft.timeZone.trim() !== current.timeZone) change.timeZone = draft.timeZone.trim();
  if (Number(draft.graceDays) !== current.graceDays) change.graceDays = Number(draft.graceDays);
  if (draft.issuerName !== current.issuerName) change.issuerName = draft.issuerName;
  if (draft.issuerDetails !== current.issuerDetails) change.issuerDetails = draft.issuerDetails;
  // Compared without the draft's row keys, which the server never sees.
  const accounts = draft.paymentAccounts.map((account) => ({
    method: account.method,
    label: account.label.trim(),
    details: account.details.trim(),
  }));
  const before = current.paymentAccounts.map(({ method, label, details }) => ({ method, label, details }));
  if (JSON.stringify(accounts) !== JSON.stringify(before)) change.paymentAccounts = accounts;
  return change;
}

/** The price form as typed. */
export interface PriceDraft {
  planKey: string;
  amount: string;
  effectiveFrom: string;
}

export type PriceDraftErrors = Partial<Record<keyof PriceDraft, string>>;

/** What is wrong with the price draft, by field: the server's rules, said before sending. */
export function checkPriceDraft(draft: PriceDraft): PriceDraftErrors {
  const errors: PriceDraftErrors = {};
  if (!draft.planKey) errors.planKey = 'Choose a plan.';
  if (parseAmount(draft.amount) === null) errors.amount = 'Enter the monthly price, like 1,000.00.';
  if (!isDayKey(draft.effectiveFrom)) errors.effectiveFrom = 'Choose the day it applies from.';
  return errors;
}
