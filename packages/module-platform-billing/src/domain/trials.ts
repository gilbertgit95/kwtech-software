import type { PlatformBillingRefusal } from './refusals.js';

/**
 * WHY AN ORGANIZATION HAS NO TRIAL (D2, #199). A new organization gets one
 * 14-day trial per FOUNDER ACCOUNT. The founder's second organization starts
 * on Free, as designed, but silently: its Billing page read "No paid plan"
 * like any Free organization, and a founder who expected the trial they had
 * before had no way to learn why it did not start (#99: a surprising outcome
 * explains itself).
 */

/** What the subscriptions port knows about trials, for one organization. */
export interface BillingTrialHistory {
  /** This organization had a trial of its own, live or ended. */
  ownTrial: boolean;
  /** The organization's founder used their one trial on ANOTHER organization. */
  founderTrialElsewhere: boolean;
}

/** The organization's state the check reads, besides the trial history. */
export interface TrialNoticeInput {
  /** The live row is a trial: it is explained as one. */
  liveTrial: boolean;
  /** A live row on a priced plan (the standing has something to renew): not a Free organization. */
  hasPaidSubscription: boolean;
  /** Any request was ever approved for it (a subscribe, a renewal, an adjustment): it had a plan. */
  everApproved: boolean;
}

/**
 * `trial_used` when the Billing page owes the founder the reason there is no
 * trial: the organization is on Free, never had a plan or a trial of its own,
 * and its founder's trial went to another organization. Otherwise null.
 *
 * ⚠ Only while it never had a plan. Once it paid, or had a trial, "no trial
 * here" is no longer surprising, and saying it would read as a refusal of
 * something the owner did not ask for.
 */
export function checkTrialUsedElsewhere(
  history: BillingTrialHistory,
  input: TrialNoticeInput,
): Extract<PlatformBillingRefusal, 'trial_used'> | null {
  if (input.liveTrial || input.hasPaidSubscription || input.everApproved) return null;
  if (history.ownTrial || !history.founderTrialElsewhere) return null;
  return 'trial_used';
}
