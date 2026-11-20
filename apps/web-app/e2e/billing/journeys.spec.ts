import { billingPath, expect, fixture, NOT_SET_UP, resetBilling, test } from './fixtures';
import {
  approve,
  openBilling,
  openQueuedRequest,
  previewPlan,
  requestPlan,
  savePayment,
  subscribeAndApprove,
} from './steps';

/**
 * The money, across perspectives (#178, sections 3–6 and the journeys of
 * section 9): an owner asks and pays, an admin pays for the owner, an
 * approver decides, and each side sees the other's step.
 *
 * Each journey starts from `e2e:billing reset`: E2E Billing back on Free with
 * no history, the test payment accounts in the settings, the numbering
 * rewound. The steps inside one journey run in order and depend on each
 * other (`serial`): a failure stops that journey and reports the step, and the
 * next journey starts clean.
 */

test.skip(!fixture, NOT_SET_UP);

/** The prices the local database is seeded with (`seed/plans.ts`), as the bill prints them. */
const BASIC = '₱1,000.00';

test.describe
  .serial('Journey 1: the first paid month (O3–O10, P1–P4, P11–P13)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('O3: the preview shows the bill, what to pay, and that requesting issues the bill', async ({ as }) => {
      const owner = await as('owner');
      await previewPlan(owner, 'Basic');
      await expect(owner.getByText('One month', { exact: true })).toBeVisible();
      await expect(owner.getByText('To pay', { exact: true })).toBeVisible();
      await expect(owner.getByText(BASIC).first()).toBeVisible();
      await expect(owner.getByText(/^Making the request issues its bill now\./)).toBeVisible();
    });

    test('O4: requesting issues a numbered, unpaid bill and says where to pay', async ({ as }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');
      await expect(
        owner.getByText('Requested. Pay outside the app, then add your payment details below.'),
      ).toBeVisible();
      await expect(owner.getByText(/^B-\d{6}$/)).toBeVisible();
      await expect(owner.getByText('Unpaid', { exact: true })).toBeVisible();
      // The test payment accounts the fixture put in the settings, one per method.
      await expect(owner.getByText('E2E e-wallet')).toBeVisible();
      await expect(owner.getByText('E2E bank')).toBeVisible();
    });

    test('O5: e-wallet details with no reference are refused at the field, and nothing is saved', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await savePayment(owner, { method: 'E-wallet', amount: '1000' });
      await expect(owner.getByText('An e-wallet or bank transfer needs its reference number.')).toBeVisible();
      await expect(owner.getByText('Nothing can be approved until you add how and when you paid.')).toBeVisible();
    });

    test('O6: a smaller amount than the bill is saved and said not to cover it', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await savePayment(owner, { method: 'E-wallet', amount: '500', reference: 'E2E-SHORT-1' });
      await expect(
        owner.getByText(/Saved: E-wallet, ₱500\.00, paid .*\. It does not cover the bill yet\./),
      ).toBeVisible();
    });

    test('O7: the full amount is a new version that covers the bill', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await savePayment(owner, { method: 'E-wallet', amount: '1000', reference: 'E2E-FULL-1' });
      await expect(
        owner.getByText(/Saved: E-wallet, ₱1,000\.00, paid .*\. It covers the bill; we will check it and approve\./),
      ).toBeVisible();
      await expect(owner.getByText('Payment submitted, pending verification').first()).toBeVisible();
    });

    test('O8: while one waits, no second request is offered', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await expect(owner.getByText('Subscribe: waiting for approval')).toBeVisible();
      await expect(owner.getByRole('button', { name: 'Choose a plan' })).toHaveCount(0);
    });

    test('P1: the queue lists the request with its checks', async ({ as }) => {
      const approver = await as('approver');
      await approver.goto('/admin/billing');
      const row = approver.getByRole('link', { name: /^E2E Billing: Subscribe, Basic/ });
      await expect(row).toBeVisible();
      await expect(approver.getByText(/Bill B-\d{6}: ₱1,000\.00/)).toBeVisible();
    });

    test('P2: the request shows the bill, every version of the details, and Decide filled from the latest', async ({
      as,
    }) => {
      const approver = await as('approver');
      await openQueuedRequest(approver);
      await expect(approver.getByText('Version 2 (latest)')).toBeVisible();
      await expect(approver.getByText(/₱1,000\.00 by E-wallet, paid .*, reference E2E-FULL-1/)).toBeVisible();
      await expect(approver.getByText('Version 1', { exact: true })).toBeVisible();
      await expect(approver.getByText(/₱500\.00 by E-wallet, paid .*, reference E2E-SHORT-1/)).toBeVisible();
      await expect(approver.getByLabel('Amount received')).toHaveValue('1000.00');
      await expect(approver.getByLabel('Reference number')).toHaveValue('E2E-FULL-1');
      await expect(approver.getByText('Payment details entered: ₱500.00.')).toBeVisible();
    });

    test('P3: approving less than the bill is refused, and the request still waits', async ({ as }) => {
      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approve(approver, '500');
      await expect(
        approver.getByText('The payment received is less than the bill, so it cannot be approved.'),
      ).toBeVisible();
      await expect(approver.getByText(/Basic · Waiting for approval/)).toBeVisible();
    });

    test('P4: approving the full payment applies the plan and issues a receipt', async ({ as }) => {
      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approve(approver, '1000');
      await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();
      await expect(approver.getByText(/^Receipt R-\d{6} issued for ₱1,000\.00\.$/)).toBeVisible();
      await expect(approver.getByText('Approved: the payment was confirmed.')).toBeVisible();
    });

    test('O9: the owner sees Basic active, its period and due day, and the request with bill and receipt', async ({
      as,
    }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await expect(owner.getByRole('heading', { name: 'Basic is active' })).toBeVisible();
      await expect(owner.getByText(/^Due on .*, in \d+ days\.$/)).toBeVisible();
      await expect(owner.getByText(/^Subscribe: Basic$/)).toBeVisible();
      await expect(owner.getByText(/^Approved · /)).toBeVisible();
      // The history entry opens to its bill and receipt.
      await owner.getByText(/^Approved · /).click();
      await expect(owner.getByRole('link', { name: 'Print' })).toHaveCount(2);
    });

    test('O10: the receipt and the bill open as documents', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await owner.getByText(/^Approved · /).click();
      const [bill, receipt] = await owner.getByRole('link', { name: 'Print' }).all();
      const receiptHref = (await receipt?.getAttribute('href')) ?? '';
      const billHref = (await bill?.getAttribute('href')) ?? '';
      expect(receiptHref).toContain('kind=receipt');
      expect(billHref).toContain('kind=bill');

      await owner.goto(receiptHref);
      await expect(owner.getByText(/Acknowledgement receipt/i).first()).toBeVisible();
      await expect(owner.getByText(/R-\d{6}/).first()).toBeVisible();
      await expect(owner.getByText(BASIC).first()).toBeVisible();

      await owner.goto(billHref);
      await expect(owner.getByText(/B-\d{6}/).first()).toBeVisible();
      await expect(owner.getByText(BASIC).first()).toBeVisible();
    });

    test('P11: the Decided tab lists it, with its decision', async ({ as }) => {
      const approver = await as('approver');
      await approver.goto('/admin/billing');
      await approver.getByRole('tab', { name: 'Decided' }).click();
      await expect(approver.getByRole('link', { name: /^E2E Billing: Subscribe, Basic/ })).toBeVisible();
    });

    test("P12: Organizations' billing shows E2E Billing on Basic", async ({ as }) => {
      const approver = await as('approver');
      await approver.goto('/admin/billing');
      await approver.getByRole('navigation').getByRole('link', { name: 'Organizations’ billing', exact: true }).click();
      const row = approver.getByRole('row', { name: /E2E Billing/ });
      await expect(row).toBeVisible();
      await expect(row.getByText('Basic')).toBeVisible();
    });

    test("P13: the reports count today's approval", async ({ as }) => {
      const approver = await as('approver');
      await approver.goto('/admin/billing');
      await approver.getByRole('navigation').getByRole('link', { name: 'Billing reports', exact: true }).click();
      await expect(approver.getByRole('heading', { name: 'Billing reports', exact: true })).toBeVisible();
      await expect(approver.getByText(BASIC).first()).toBeVisible();
    });

    test('A1: the admin sees the paid plan, renews when open, and never changes or cancels it', async ({ as }) => {
      const admin = await as('admin');
      await openBilling(admin);
      await expect(admin.getByRole('heading', { name: 'Basic is active' })).toBeVisible();
      await expect(admin.getByRole('button', { name: 'Renew' })).toBeVisible();
      await expect(admin.getByRole('button', { name: 'Change plan' })).toBeDisabled();
      await expect(
        admin.getByText("Only the organization's owner can choose, change or cancel the plan.").first(),
      ).toBeVisible();
    });
  });

test.describe
  .serial('Journey 2: the admin pays the owner’s request (O4, A5, A6, P4)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('A5: the admin saves payment details on the owner’s request, and the owner sees them', async ({ as }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');

      const admin = await as('admin');
      await openBilling(admin);
      await savePayment(admin, { method: 'Bank transfer', amount: '1000', reference: 'E2E-ADMIN-1' });
      await expect(admin.getByText(/Saved: Bank transfer, ₱1,000\.00, .*It covers the bill/)).toBeVisible();

      await openBilling(owner);
      await expect(owner.getByText(/Saved: Bank transfer, ₱1,000\.00, .*It covers the bill/)).toBeVisible();
    });

    test('P4: the approver approves what the admin entered', async ({ as }) => {
      const approver = await as('approver');
      await openQueuedRequest(approver);
      await expect(approver.getByLabel('Reference number')).toHaveValue('E2E-ADMIN-1');
      await approve(approver);
      await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();
    });
  });

test.describe
  .serial('Withdraw (A6)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('A6: the admin withdraws a waiting request through the confirm dialog, and its bill is cancelled', async ({
      as,
    }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');

      const admin = await as('admin');
      await openBilling(admin);
      await admin.getByRole('button', { name: 'Withdraw request' }).click();
      const dialog = admin.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Withdraw it' }).click();
      await expect(admin.getByRole('button', { name: 'Choose a plan' })).toBeDisabled();
      await expect(admin.getByText(/^Withdrawn · /)).toBeVisible();
    });
  });

test.describe
  .serial('Refused, then fixed (P7, O11)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('P7: a rejection needs a reason, and cancels the bill', async ({ as }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');
      await savePayment(owner, { method: 'Cash', amount: '1000' });

      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approver.getByRole('button', { name: 'Reject', exact: true }).click();
      const dialog = approver.getByRole('dialog');
      await dialog.getByRole('button', { name: /^Reject/ }).click();
      await expect(dialog.getByText(/reason/i).first()).toBeVisible();
      await dialog.getByLabel('Reason').fill('E2E: no such payment arrived at the counter.');
      await dialog.getByRole('button', { name: /^Reject/ }).click();
      await expect(approver.getByText('Rejected. Its bill is cancelled.')).toBeVisible();
    });

    test('O11: the owner sees the rejection and its reason, and may request again', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await expect(owner.getByText(/^Rejected · /)).toBeVisible();
      // The history entry opens to its detail.
      await owner.getByText(/^Rejected · /).click();
      await expect(owner.getByText('Reason given: E2E: no such payment arrived at the counter.')).toBeVisible();
      await expect(owner.getByRole('button', { name: 'Choose a plan' })).toBeEnabled();
    });
  });

test.describe
  .serial('Kept as credit (P8)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('P8: closing as credit keeps what was received as the organization’s credit', async ({ as }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');
      await savePayment(owner, { method: 'Cash', amount: '400' });

      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approver.getByRole('button', { name: 'Close as credit', exact: true }).click();
      const dialog = approver.getByRole('dialog');
      await dialog.getByLabel('Reason').fill('E2E: short payment kept as credit.');
      await dialog.getByRole('button', { name: 'Close as credit' }).click();
      await expect(approver.getByText(/^Closed as credit/)).toBeVisible();

      await openBilling(owner);
      await expect(owner.getByText('₱400.00').first()).toBeVisible();
      await expect(owner.getByText(/^Kept as credit · /)).toBeVisible();
    });
  });

test.describe
  .serial('Overpaid (P5)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('P5: an overpayment is approved and the extra becomes credit', async ({ as }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');
      await savePayment(owner, { method: 'Cash', amount: '1200' });

      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approve(approver);
      await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();

      await openBilling(owner);
      await expect(owner.getByRole('heading', { name: 'Basic is active' })).toBeVisible();
      await expect(owner.getByText('₱200.00').first()).toBeVisible();
    });
  });

test.describe
  .serial('Reversed (P9, O12, P13)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('P9: a void needs a reason and reverses the approval', async ({ as }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');
      await savePayment(owner, { method: 'Cash', amount: '1000' });
      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approve(approver);
      await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();

      await approver.getByRole('button', { name: 'Void this approval' }).click();
      const dialog = approver.getByRole('dialog');
      await dialog.getByLabel('Reason').fill('E2E: approved by mistake.');
      await dialog.getByRole('button', { name: /^Void/ }).click();
      await expect(approver.getByText('Voided: the approval is reversed.')).toBeVisible();
    });

    test('O12: the owner is back on Free, and the receipt reads VOID with the reason', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await expect(owner.getByText('No paid plan')).toBeVisible();
      await expect(owner.getByText(/^Reversed · /)).toBeVisible();
      // The history entry opens to its bill and receipt.
      await owner.getByText(/^Reversed · /).click();
      const receipt = owner.getByRole('link', { name: 'Print' }).last();
      await owner.goto((await receipt.getAttribute('href')) ?? billingPath());
      await expect(owner.getByText('VOID').first()).toBeVisible();
      await expect(owner.getByText('E2E: approved by mistake.').first()).toBeVisible();
    });
  });

test.describe
  .serial('An approver who belongs to the organization (Q1, Q2)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('Q1–Q2: their own organization’s request is flagged, and approving it is allowed with the flag kept', async ({
      as,
    }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');
      await savePayment(owner, { method: 'Cash', amount: '1000' });

      const approverMember = await as('approverMember');
      await openQueuedRequest(approverMember);
      await expect(
        approverMember.getByText('You belong to this organization: it is recorded with the decision.'),
      ).toBeVisible();
      await approve(approverMember);
      await expect(approverMember.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();
      // The flag stays with the decision (#188), on the request and in the queue.
      await expect(
        approverMember.getByText('Decided by somebody who belongs to this organization: recorded with the decision.'),
      ).toBeVisible();
      await approverMember.goto('/admin/billing');
      await approverMember.getByRole('tab', { name: 'Decided' }).click();
      await expect(
        approverMember.getByRole('link', { name: /^E2E Billing: Subscribe, Basic/ }).getByText('Your organization'),
      ).toBeVisible();
    });
  });

test.describe
  .serial('Changing plan (O15–O17)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('O15: an upgrade mid-period bills the days left, at the request', async ({ as }) => {
      const owner = await as('owner');
      await subscribeAndApprove(owner, await as('approver'), 'Basic', '1000');
      await previewPlan(owner, 'Pro', { opener: 'Change plan' });
      await expect(owner.getByText(/^Unused days of the current plan \(\d+ days\)$/)).toBeVisible();
      await expect(owner.getByText(/^New plan for the rest of the period \(\d+ days\)$/)).toBeVisible();
      await expect(owner.getByText(/^Making the request issues its bill now\./)).toBeVisible();
    });

    test("O17: a downgrade while over the smaller plan's limits is refused, each limit named", async ({ as }) => {
      const owner = await as('owner');
      // E2E Billing has 4 members; Free allows 3 (seed/plans.ts).
      await previewPlan(owner, 'Free', { opener: 'Change plan' });
      const refusal = owner.getByRole('alert');
      await expect(refusal.getByText('The organization has more than that plan allows.')).toBeVisible();
      await expect(
        refusal.getByText(/^Organization members: the plan allows 3 and you have 4\. Remove 1\.$/),
      ).toBeVisible();
      await expect(refusal.getByText(/organization:members/)).toHaveCount(0);
      await expect(owner.getByRole('button', { name: 'Request this plan' })).toBeDisabled();
    });
  });

test.describe
  .serial('Paying ahead and auto-renew (O21, O22, A4, A7)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('O21: three months at once: the extra is credit, a paid-up-to line, auto-renew on', async ({ as }) => {
      const owner = await as('owner');
      await previewPlan(owner, 'Basic', { months: 3 });
      await expect(owner.getByText(/^2 months paid ahead, kept as credit/)).toBeVisible();
      await expect(owner.getByLabel(/^Renew automatically from credit, so the months paid ahead/)).toBeChecked();
      await subscribeAndApprove(owner, await as('approver'), 'Basic', '3000', { months: 3 });

      await openBilling(owner);
      await expect(owner.getByRole('heading', { name: 'Basic is active' })).toBeVisible();
      await expect(
        owner.getByText(/^Pays renewals up to .* \(2 months, at the price on the due date\)\.$/),
      ).toBeVisible();
      await expect(owner.getByLabel('Renew automatically from credit')).toBeChecked();
      await expect(owner.getByText(/^Renews by itself on .*, paid from credit\. Nothing to pay\.$/)).toBeVisible();
    });

    test('O22: the owner turns auto-renew off, then on', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await owner.getByLabel('Renew automatically from credit').click();
      await expect(owner.getByText('Auto-renew is off. Renew and pay as usual.')).toBeVisible();
      await owner.getByLabel('Renew automatically from credit').click();
      await expect(owner.getByText('Auto-renew is on.')).toBeVisible();
    });

    test('A7: the admin sees the switch, off for them, with the owner-only reason', async ({ as }) => {
      const admin = await as('admin');
      await openBilling(admin);
      await expect(admin.getByLabel('Renew automatically from credit')).toBeDisabled();
      await expect(admin.getByRole('button', { name: 'Cancel at the end of the period' })).toBeDisabled();
    });
  });

test.describe
  .serial('Cancel (O27)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('O27: cancel at the end of the period, through its dialog; renewing stays open to undo it', async ({ as }) => {
      const owner = await as('owner');
      await subscribeAndApprove(owner, await as('approver'), 'Basic', '1000');
      await openBilling(owner);
      await owner.getByRole('button', { name: 'Cancel at the end of the period' }).click();
      const dialog = owner.getByRole('dialog');
      await expect(dialog.getByText('Cancel Basic?')).toBeVisible();
      await expect(
        dialog.getByText(/^Access ends on .*, with no grace after it and no credit for what is left\./),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel at the end of the period' }).click();

      await expect(owner.getByText('Cancelled. Access ends at the close of the period.')).toBeVisible();
      await expect(owner.getByRole('heading', { name: /^Basic ends on / })).toBeVisible();
      await expect(owner.getByRole('button', { name: 'Renew' })).toBeEnabled();
      // The plan's name, never its key (#192).
      await expect(owner.getByText('Cancel: Basic')).toBeVisible();
    });
  });

test.describe
  .serial('Approver edge cases (P6, P10)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('P6: details changed while the approver reviewed them are refused, and the new ones shown', async ({ as }) => {
      const owner = await as('owner');
      await requestPlan(owner, 'Basic');
      await savePayment(owner, { method: 'Cash', amount: '1000' });

      const approver = await as('approver');
      await openQueuedRequest(approver);
      await savePayment(owner, { method: 'E-wallet', amount: '1000', reference: 'E2E-CHANGED-1' });
      await expect(owner.getByText(/It covers the bill/)).toBeVisible();

      await approve(approver);
      await expect(approver.getByText('The payment details changed while you were reviewing them.')).toBeVisible();
      await expect(approver.getByText(/reference E2E-CHANGED-1/)).toBeVisible();
    });

    test('P10: an older approval cannot be voided once a later one exists', async ({ as }) => {
      const owner = await as('owner');
      const approver = await as('approver');
      // Approve the waiting subscribe (its details as they now are), then upgrade and approve that too.
      await openQueuedRequest(approver);
      await approve(approver);
      await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();
      await requestPlan(owner, 'Pro', { opener: 'Change plan' });
      await savePayment(owner, { method: 'Cash', amount: '1500' });
      await openQueuedRequest(approver);
      await approve(approver);
      await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();

      // The subscribe, from the Decided tab: the older of the two.
      await approver.goto('/admin/billing');
      await approver.getByRole('tab', { name: 'Decided' }).click();
      await approver.getByRole('link', { name: /^E2E Billing: Subscribe, Basic/ }).click();
      await approver.getByRole('button', { name: 'Void this approval' }).click();
      const dialog = approver.getByRole('dialog');
      await dialog.getByLabel('Reason').fill('E2E: trying the older one.');
      await dialog.getByRole('button', { name: /^Void/ }).click();
      await expect(
        approver.getByText('A later request of this organization was approved after this one.'),
      ).toBeVisible();
    });
  });

test.describe
  .serial('Settings and adjustments (P14, U1–U3, U5)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('P14: the approver reads the settings and can change nothing', async ({ as }) => {
      const approver = await as('approver');
      await approver.goto('/admin/billing/settings');
      await expect(approver.getByRole('heading', { name: 'Billing settings', exact: true })).toBeVisible();
      await expect(
        approver.getByText('Changing these needs the billing settings key; you can read them.'),
      ).toBeVisible();
      await expect(approver.getByLabel('Grace days')).toBeDisabled();
      await expect(approver.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    });

    test('U2: the super admin changes a payment account, and the owner sees it with the bill', async ({ as }) => {
      const superAdmin = await as('superAdmin');
      await superAdmin.goto('/admin/billing/settings');
      await superAdmin.getByLabel('Account 2: details').fill('Test only (#178): 0911 111 1111.');
      await superAdmin.getByRole('button', { name: 'Save settings' }).click();
      await expect(superAdmin.getByText('Saved.')).toBeVisible();

      const owner = await as('owner');
      await requestPlan(owner, 'Basic');
      await expect(owner.getByText('Test only (#178): 0911 111 1111.')).toBeVisible();
    });

    test('U3: once a bill exists, the currency and time zone are fixed, and say why', async ({ as }) => {
      const superAdmin = await as('superAdmin');
      await superAdmin.goto('/admin/billing/settings');
      await expect(superAdmin.getByLabel('Currency')).toBeDisabled();
      await expect(superAdmin.getByText('Fixed: bills have been issued in it.')).toBeVisible();
      await expect(superAdmin.getByLabel('Time zone')).toBeDisabled();
      await expect(superAdmin.getByText('Fixed: billed periods are counted in it.')).toBeVisible();
    });

    test('U5: an adjustment by hand needs a reason, and shows in the billing history', async ({ as }) => {
      const superAdmin = await as('superAdmin');
      await superAdmin.goto('/admin/subscriptions');
      // The grid opens a row on double-click (web-ui DataGrid's onRowActivate).
      await superAdmin.getByText('E2E Billing', { exact: true }).first().dblclick();
      await superAdmin.waitForURL(/\/admin\/subscriptions\/[^/]+\/edit$/);
      await superAdmin.getByRole('button', { name: 'Save changes' }).click();
      await expect(
        superAdmin.getByText(
          'Say why. The reason is kept in the organization’s billing history, as an adjustment with no payment.',
        ),
      ).toBeVisible();
      // The form's own field: a closed dialog on the page has a Reason too.
      await superAdmin.getByRole('textbox', { name: 'Reason' }).first().fill('E2E: an adjustment by hand.');
      await superAdmin.getByRole('button', { name: 'Save changes' }).click();

      const owner = await as('owner');
      await openBilling(owner);
      await expect(owner.getByText(/^Adjustment by our staff \(no payment\): Free$/)).toBeVisible();
    });
  });

test.describe('Statement (A8)', () => {
  test('A8: the admin opens the statement of account, with its CSV and print', async ({ as }) => {
    const admin = await as('admin');
    await openBilling(admin);
    await admin.getByRole('link', { name: 'Statement of account' }).click();
    await expect(admin.getByRole('heading', { name: 'Statement of account', exact: true })).toBeVisible();
    await expect(admin.getByRole('button', { name: 'Download CSV' })).toBeVisible();
  });
});
