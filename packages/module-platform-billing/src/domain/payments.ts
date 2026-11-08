import { assertCentavos, type Centavos } from './money.js';

/**
 * WHAT AN OWNER SAYS THEY PAID, AND THE CHECKS THAT HELP AN APPROVER READ IT
 * (PLATFORM-BILLING-PLAN §4). The checks flag; they never decide. An approver
 * looks up the reference in the e-wallet or the bank, and that is the decision.
 */

/** How the money was sent. A fixed list in code, with room for a provider later. */
export const PLATFORM_BILLING_PAYMENT_METHODS = ['cash', 'e_wallet', 'bank_transfer'] as const;

export type PaymentMethod = (typeof PLATFORM_BILLING_PAYMENT_METHODS)[number];

/** Whether a wire string is a payment method. */
export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PLATFORM_BILLING_PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Whether `method` needs a reference: e-wallet and bank transfer do; cash says when and to whom in the note. */
export function needsReference(method: PaymentMethod): boolean {
  return method !== 'cash';
}

/**
 * A reference as compared: spaces and dashes removed, case ignored, so "TRX 55",
 * "trx-55" and "trx55" are one reference. What is shown is still what was typed.
 */
export function normaliseReference(reference: string): string {
  return reference.replace(/[\s-]+/gu, '').toLowerCase();
}

/** Another request that already carries a reference, from any organization. */
export interface ReferenceUse {
  requestId: string;
  organizationId: string;
  reference: string;
}

/**
 * The other requests using the same reference as `reference`, so the queue can
 * flag "already used on request X". An empty reference matches nothing.
 */
export function findReferenceReuse(
  reference: string,
  requestId: string,
  others: readonly ReferenceUse[],
): readonly ReferenceUse[] {
  const wanted = normaliseReference(reference);
  if (!wanted) return [];
  return others.filter((other) => other.requestId !== requestId && normaliseReference(other.reference) === wanted);
}

/** How an amount sent compares with a bill. Short cannot be approved; over becomes credit (D7). */
export type AmountCheck = { kind: 'exact' } | { kind: 'short'; by: Centavos } | { kind: 'over'; by: Centavos };

/** `sent` against `total`. */
export function checkAmount(sent: Centavos, total: Centavos): AmountCheck {
  // `sent` is what an owner typed: NaN or a float here would reach the credit path as "over".
  assertCentavos(sent, 'An amount sent');
  assertCentavos(total, 'A bill total');
  if (sent === total) return { kind: 'exact' };
  if (sent < total) return { kind: 'short', by: total - sent };
  return { kind: 'over', by: sent - total };
}

/**
 * The longest free text a person types into billing (a reference, a sender, a
 * note, a reason), in characters. Refused past it, never cut. One number for
 * the payment form and the server (`PLATFORM_BILLING_TEXT_MAX`).
 */
export const BILLING_TEXT_MAX = 500;
