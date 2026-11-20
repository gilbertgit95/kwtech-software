import type { Page } from '@playwright/test';
import { billingPath, expect } from './fixtures';

/**
 * The steps the billing journeys repeat, each as the person on screen does
 * it: by role and accessible name, the way the e2e rules ask, so a renamed
 * button fails here as it would confuse a customer.
 */

/** A plan offered by "Choose a plan" / "Change plan", by its label on the radio. */
export type PlanLabel = 'Basic' | 'Pro' | 'Free';

/** Opens the organization's Billing page and waits for its heading. */
export async function openBilling(page: Page): Promise<void> {
  await page.goto(billingPath());
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
}

/**
 * Opens the plan panel (`Choose a plan` on Free, `Change plan` on a paid
 * plan) and picks `plan` for `months`, leaving the preview on screen.
 */
export async function previewPlan(
  page: Page,
  plan: PlanLabel,
  options: { months?: 1 | 3 | 6 | 12; opener?: 'Choose a plan' | 'Change plan' } = {},
): Promise<void> {
  await openBilling(page);
  await page.getByRole('button', { name: options.opener ?? 'Choose a plan' }).click();
  await page.getByLabel(new RegExp(`^${plan}\\b`)).check();
  if (options.months && options.months > 1) {
    await page.getByLabel('Pay for').selectOption({ label: `${options.months} months` });
  }
}

/** Requests the previewed plan and waits for the request to be on the page. */
export async function requestPlan(
  page: Page,
  plan: PlanLabel,
  options: { months?: 1 | 3 | 6 | 12; opener?: 'Choose a plan' | 'Change plan' } = {},
): Promise<void> {
  await previewPlan(page, plan, options);
  await page.getByRole('button', { name: /^Request (this plan|renewal)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Requested[.,]/ })).toBeVisible();
}

/** The payment details as an owner or admin types them, amount in pesos. */
export interface PaymentEntry {
  method: 'Cash' | 'E-wallet' | 'Bank transfer';
  amount: string;
  reference?: string;
}

/**
 * Saves payment details on the pending request. The button reads "Save
 * payment details" the first time and "Save new payment details" after: each
 * save is a new version, never an edit.
 */
export async function savePayment(page: Page, entry: PaymentEntry): Promise<void> {
  await page.getByLabel('Paid by').selectOption({ label: entry.method });
  await page.getByLabel('Amount paid').fill(entry.amount);
  if (entry.reference !== undefined) await page.getByLabel('Reference number').fill(entry.reference);
  await page.getByRole('button', { name: /^Save (new )?payment details$/ }).click();
}

/** Opens E2E Billing's request from the approver's queue, on the tab named. */
export async function openQueuedRequest(page: Page, tab: 'Waiting' | 'Decided' = 'Waiting'): Promise<void> {
  await page.goto('/admin/billing');
  await expect(page.getByRole('heading', { name: 'Billing queue', exact: true })).toBeVisible();
  if (tab === 'Decided') await page.getByRole('tab', { name: 'Decided' }).click();
  await page
    .getByRole('link', { name: /^E2E Billing:/ })
    .first()
    .click();
  await page.waitForURL(/\/admin\/billing\/requests\//);
  await expect(page.getByRole('heading', { name: /^E2E Billing:/ })).toBeVisible();
}

/** Approves the open request as received, after setting the amount when given. */
export async function approve(page: Page, amount?: string): Promise<void> {
  if (amount !== undefined) await page.getByLabel('Amount received').fill(amount);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
}

/**
 * The whole first paid month in one go, for a journey that starts from it:
 * the owner requests `plan` and pays it in full, an approver approves.
 */
export async function subscribeAndApprove(
  owner: Page,
  approver: Page,
  plan: PlanLabel,
  amount: string,
  options: { months?: 1 | 3 | 6 | 12 } = {},
): Promise<void> {
  await requestPlan(owner, plan, options);
  await savePayment(owner, { method: 'E-wallet', amount, reference: `E2E-${Date.now()}` });
  await expect(owner.getByText(/It covers the bill/)).toBeVisible();
  await openQueuedRequest(approver);
  await approve(approver);
  await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();
}
