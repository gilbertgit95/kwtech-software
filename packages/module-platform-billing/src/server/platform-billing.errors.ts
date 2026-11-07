import { type PlatformBillingRefusal, refusalText } from '../domain/refusals.js';

/**
 * One error type for every refusal billing makes, carrying the reason code and
 * its sentence from `PLATFORM_BILLING_REFUSALS`, so the server and the pages
 * read the same words (plan §6). Counts and dates go in `detail`; the page adds
 * them, and the sentence never carries a number.
 */
export class PlatformBillingWriteError extends Error {
  constructor(
    readonly reason: PlatformBillingRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PlatformBillingWriteError';
  }
}

/** The error for `reason`: its sentence, then the next step. */
export function billingRefusal(
  reason: PlatformBillingRefusal,
  detail: Record<string, unknown> = {},
): PlatformBillingWriteError {
  const text = refusalText(reason);
  return new PlatformBillingWriteError(reason, `${text.message} ${text.nextStep}`, detail);
}
