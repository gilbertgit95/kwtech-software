import { planPayment } from '../../domain/orders.js';
import type { PosPaymentMethod, PosRefusal } from '../../types.js';
import { formatPeso } from './money.js';

/**
 * The payment screen's arithmetic (D12–D14), by the SAME `planPayment` the
 * server runs — so the till never shows "Change ₱10" for a payment the server
 * will refuse. The server's answer still wins.
 */

export interface PaymentDraft {
  method: PosPaymentMethod;
  /** Centavos, or null while what was typed is not an amount. */
  received: number | null;
  /** Keep all of the change as a tip. */
  keepTip: boolean;
  /** The change could not be handed over: owe it (cash only). */
  owe: boolean;
}

export type PaymentPreview =
  | { ok: true; change: number; tip: number; changeOwed: number }
  | { ok: false; problem: string };

/** What the draft comes to — the change handed back, the tip kept, the change owed — or what is wrong with it. */
export function previewPayment(
  total: number,
  draft: PaymentDraft,
  customer: { name: string | null; contact: string | null },
): PaymentPreview {
  if (draft.received === null) return { ok: false, problem: 'Enter the amount received.' };
  const over = draft.received - total;
  const tip = draft.keepTip && over > 0 ? over : 0;
  const changeOwed = draft.owe && draft.method === 'cash' && over - tip > 0 ? over - tip : 0;
  const planned = planPayment(total, { method: draft.method, received: draft.received, tip, changeOwed }, customer);
  if ('refused' in planned) return { ok: false, problem: paymentProblem(planned.refused, total) };
  return { ok: true, change: planned.change, tip, changeOwed };
}

function paymentProblem(refusal: PosRefusal, total: number): string {
  switch (refusal) {
    case 'insufficient_payment':
      return `That is less than the total, ${formatPeso(total)}.`;
    case 'change_not_allowed':
      return 'E-wallet and card have no change: enter the total, or keep what is over as a tip.';
    case 'customer_required':
      return 'Owing change needs the customer’s name and contact.';
    default:
      return 'Those amounts do not add up.';
  }
}
