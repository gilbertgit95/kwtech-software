import { BILLING_TEXT_MAX, isPaymentMethod, needsReference } from '../../domain/payments.js';
import type { BillingPaymentInput } from '../billing-client.js';

/**
 * THE PAYMENT DETAILS FORM, as pure rules: the draft as typed (strings, as
 * inputs hold them), the per-field checks the server repeats
 * (`preparePayment`), and the conversion to centavos.
 */

/** The form as typed. `amount` is in the currency's units (`1,000.50`), turned into centavos on save. */
export interface PaymentDraft {
  method: string;
  amount: string;
  paidOn: string;
  reference: string;
  sender: string;
  note: string;
}

export type PaymentDraftErrors = Partial<Record<keyof PaymentDraft, string>>;

/** `1,000.50` → 100050 centavos, or null when it is not an amount of money. */
export function parseAmount(text: string): number | null {
  const plain = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(plain)) return null;
  const [whole = '0', fraction = ''] = plain.split('.');
  const centavos = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** What is wrong with `draft`, by field: the same rules the server applies, said before anything is sent. */
export function checkPaymentDraft(draft: PaymentDraft): PaymentDraftErrors {
  const errors: PaymentDraftErrors = {};
  if (!isPaymentMethod(draft.method)) errors.method = 'Choose how it was paid.';
  if (parseAmount(draft.amount) === null) errors.amount = 'Enter the amount paid, like 1,000.00.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.paidOn)) errors.paidOn = 'Choose the day it was paid.';
  if (isPaymentMethod(draft.method) && needsReference(draft.method) && !draft.reference.trim()) {
    errors.reference = 'An e-wallet or bank transfer needs its reference number.';
  }
  for (const field of ['reference', 'sender', 'note'] as const) {
    if (draft[field].trim().length > BILLING_TEXT_MAX) errors[field] = `Keep it to ${BILLING_TEXT_MAX} characters.`;
  }
  return errors;
}

/** The draft as the server takes it: centavos, and empty text as absent. Call only after `checkPaymentDraft` passed. */
export function paymentInput(draft: PaymentDraft): BillingPaymentInput {
  const text = (value: string) => (value.trim() ? value.trim() : null);
  return {
    method: draft.method,
    amount: parseAmount(draft.amount) ?? 0,
    paidOn: draft.paidOn,
    reference: text(draft.reference),
    sender: text(draft.sender),
    note: text(draft.note),
  };
}
