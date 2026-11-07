/**
 * EVERY REFUSAL IS A NAMED REASON WITH A SENTENCE AND A NEXT STEP
 * (PLATFORM-BILLING-PLAN §6, the operator's rule: the screen always says why).
 *
 * Here, in the pure root, so the server's error, the pages and the tests read
 * the same words. Never "Not permitted" alone. `PLATFORM_BILLING_REFUSALS` is a
 * `Record` over the union, so a reason added without its words fails the
 * compile, and a test checks none is empty.
 *
 * Messages carry no numbers: where a refusal has counts or dates (short by 100,
 * remove 2 members), they travel in the error's `detail` and the page adds them.
 */
export type PlatformBillingRefusal =
  | 'not_found'
  | 'invalid'
  | 'not_permitted'
  | 'owner_only'
  | 'pending_request_exists'
  | 'no_subscription'
  | 'already_subscribed'
  | 'renewal_not_open'
  | 'renew_first'
  | 'same_plan'
  | 'plan_not_offered'
  | 'plan_archived'
  | 'over_new_plan_caps'
  | 'reference_required'
  | 'not_pending'
  | 'details_changed'
  | 'payment_short'
  | 'quote_expired'
  | 'void_not_latest'
  | 'not_approved'
  | 'subscription_changed'
  | 'nothing_received'
  | 'already_cancelled'
  | 'trial_used'
  | 'currency_locked'
  | 'time_zone_locked'
  | 'price_not_set'
  | 'subscription_expired';

/** What a person reads when refused: why, and what to do about it. */
export interface RefusalText {
  message: string;
  nextStep: string;
}

export const PLATFORM_BILLING_REFUSALS: Readonly<Record<PlatformBillingRefusal, RefusalText>> = {
  not_found: {
    message: 'That request, bill or plan does not exist, or is not yours to see.',
    nextStep: 'Go back to the Billing page and open it from there.',
  },
  invalid: {
    message: 'Something in this request is not filled in correctly.',
    nextStep: 'Check the highlighted fields and submit again.',
  },
  not_permitted: {
    message: 'Your role does not include billing.',
    nextStep: "Ask your organization's owner.",
  },
  owner_only: {
    message: "Only the organization's owner can choose, change or cancel the plan.",
    nextStep: 'You can still renew the current plan and add payment details. Ask the owner for anything else.',
  },
  pending_request_exists: {
    message: 'There is already a request waiting for approval.',
    nextStep: 'Add its payment details, or withdraw it before making another.',
  },
  no_subscription: {
    message: 'This organization has no paid plan to renew, change or cancel.',
    nextStep: 'Request a plan instead.',
  },
  already_subscribed: {
    message: 'This organization already has a paid plan.',
    nextStep: 'Renew it, or change plan.',
  },
  renewal_not_open: {
    message: 'Renewing is not open yet for this subscription.',
    nextStep: 'Come back on the day it opens; you will be reminded.',
  },
  renew_first: {
    message: 'Your subscription is overdue, so the plan cannot be changed yet.',
    nextStep: 'Renew first, then you can change plan.',
  },
  same_plan: {
    message: 'That is already your plan.',
    nextStep: 'Choose a different plan, or renew this one.',
  },
  plan_not_offered: {
    message: 'That plan is not offered to new subscribers.',
    nextStep: 'Choose one of the listed plans, or contact us about it.',
  },
  plan_archived: {
    message: 'That plan is no longer offered, and gives no access.',
    nextStep: 'Choose another plan; any paid days you lost were added as credit.',
  },
  over_new_plan_caps: {
    message: 'The organization has more than that plan allows.',
    nextStep: 'Remove what is over the plan’s limits, then change plan.',
  },
  reference_required: {
    message: 'An e-wallet or bank transfer needs its reference number.',
    nextStep: 'Copy the reference from the payment confirmation.',
  },
  not_pending: {
    message: 'This request has already been decided.',
    nextStep: 'Open its history to see what happened.',
  },
  details_changed: {
    message: 'The payment details changed while you were reviewing them.',
    nextStep: 'Review the new details, then approve again.',
  },
  payment_short: {
    message: 'The payment received is less than the bill, so it cannot be approved.',
    nextStep: 'Ask the organization to pay the rest, or reject the request with the reason.',
  },
  quote_expired: {
    message: 'This plan change was priced for a period that has ended.',
    nextStep: 'Close it as credit if it was paid, so the organization can request it again.',
  },
  void_not_latest: {
    message: 'A later request in the same period was approved after this one.',
    nextStep: 'Void the later request first.',
  },
  not_approved: {
    message: 'Only an approved request can be voided.',
    nextStep: 'A request still waiting is rejected or withdrawn instead.',
  },
  subscription_changed: {
    message:
      'The subscription is no longer the one this approval wrote, or the approval did not record what it replaced, so it cannot be reversed by itself.',
    nextStep: 'Correct the subscription with an adjustment on the subscriptions page, giving the reason.',
  },
  nothing_received: {
    message: 'Nothing was received for this request, so there is no payment to keep as credit.',
    nextStep: 'Reject the request with the reason instead.',
  },
  already_cancelled: {
    message: 'This subscription is already set to end at the close of its period.',
    nextStep: 'Nothing more to do. To keep the plan after all, renew it.',
  },
  trial_used: {
    message: 'A free trial was already used by this account.',
    nextStep: 'Request a plan to keep using the business apps.',
  },
  currency_locked: {
    message:
      'The currency cannot change once a bill has been issued in it, or bills and reports would add up different currencies.',
    nextStep: 'Keep the current currency. A different one needs a new billing setup.',
  },
  time_zone_locked: {
    message:
      'The time zone cannot change once a bill has been issued, or the days already billed would move under the organizations that paid for them.',
    nextStep: 'Keep the current time zone. Changing it for new periods only is not built yet.',
  },
  price_not_set: {
    message: 'That plan has no price yet, so it cannot be billed.',
    nextStep: 'Choose another plan, or ask us to set its price.',
  },
  subscription_expired: {
    message: "Your organization's plan has ended.",
    nextStep: 'Billing stays open so you can renew; everything else is paused until a renewal is approved.',
  },
};

/** The words for `reason`. */
export function refusalText(reason: PlatformBillingRefusal): RefusalText {
  return PLATFORM_BILLING_REFUSALS[reason];
}
