import {
  billingDay,
  expect,
  fixture,
  movePeriod,
  NOT_SET_UP,
  requireFixture,
  resetBilling,
  runDailyCheck,
  test,
} from './fixtures';
import { approve, openBilling, openQueuedRequest, previewPlan, savePayment, subscribeAndApprove } from './steps';

/**
 * The cases that turn on dates (#178, sections 2–4 and journeys 5 and 6):
 * the renewal window, grace, the hold, expiry, the notices, and paying ahead.
 *
 * Nobody waits a month: `movePeriod` moves E2E Billing's live period to end N
 * days from today (`e2e:billing period`), and `runDailyCheck` runs the daily
 * check for E2E Billing alone (`e2e:billing daily`), never the whole run,
 * which would remind and renew the real organizations too.
 */

test.skip(!fixture, NOT_SET_UP);

/** The member's view of the workspace's queue: a sub-app on Basic, not on Free. */
function queuePath(): string {
  const { organizationId, workspaceId } = requireFixture();
  return `/organizations/${organizationId}/workspaces/${workspaceId}/queue`;
}

test.describe
  .serial('The renewal window (O19, A3, A4, O20)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('O19: more than 7 days before the due day, Renew is off and says when it opens', async ({ as }) => {
      const owner = await as('owner');
      await subscribeAndApprove(owner, await as('approver'), 'Basic', '1000');
      movePeriod(10);
      await openBilling(owner);
      await expect(owner.getByRole('button', { name: 'Renew' })).toBeDisabled();
      await expect(
        owner.getByText(`Renewing opens on ${billingDay(3)}, 7 days before the due date. You will be reminded.`),
      ).toBeVisible();
    });

    test('A4: the admin renews for 3 months: the months hint, and no auto-renew box', async ({ as }) => {
      movePeriod(3);
      const admin = await as('admin');
      await openBilling(admin);
      await admin.getByRole('button', { name: 'Renew' }).click();
      await admin.getByLabel('Pay for').selectOption({ label: '3 months' });
      await expect(admin.getByText(/^2 months paid ahead, kept as credit/)).toBeVisible();
      // The switch is the owner's (#129): the admin's renewal panel offers none.
      await expect(admin.getByLabel(/^Renew automatically from credit, so the months paid ahead/)).toHaveCount(0);
    });

    test('A3: inside the window the admin renews for 1 month: preview, bill, and where to pay', async ({ as }) => {
      const admin = await as('admin');
      await openBilling(admin);
      await admin.getByRole('button', { name: 'Renew' }).click();
      await expect(admin.getByText('Another month of Basic.')).toBeVisible();
      await admin.getByRole('button', { name: 'Request renewal' }).click();
      await expect(admin.getByRole('status').filter({ hasText: /^Requested[.,]/ })).toBeVisible();
      await expect(admin.getByText('Renewal: waiting for approval')).toBeVisible();
      await expect(admin.getByText('E2E e-wallet')).toBeVisible();
    });

    test('O20: approved, the new period starts at the old period end, not at approval', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await savePayment(owner, { method: 'Cash', amount: '1000' });
      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approve(approver);
      await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();

      // Renewed 3 days early: the next due day is a month after the OLD end, not a month after today.
      await openBilling(owner);
      await expect(owner.getByText(new RegExp(`^Due on ${billingDay(3, 1)}, in \\d+ days\\.$`))).toBeVisible();
      await expect(owner.getByText('The next month is already paid.')).toBeVisible();
    });
  });

test.describe
  .serial('Lapse and recovery (journey 5: O23, M5, O18, O24, O25, M6, O26)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('O23: three days past due, overdue with the days of grace left, and the plan still works', async ({ as }) => {
      const owner = await as('owner');
      await subscribeAndApprove(owner, await as('approver'), 'Basic', '1000');
      movePeriod(-3);
      await openBilling(owner);
      await expect(owner.getByRole('heading', { name: /^Basic is overdue: \d+ days of access left$/ })).toBeVisible();
      await expect(owner.getByText(/the due date plus 7 days of grace\.$/)).toBeVisible();
    });

    test('M5: in grace, the member’s sub-app still works, and nothing about billing is shown to them', async ({
      as,
    }) => {
      const member = await as('member');
      await member.goto(queuePath());
      await expect(member.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible();
      // Not the organization's name ("E2E Billing"): what a refusal or a billing state would say.
      await expect(member.getByText(/plan has ended|does not include this|is overdue|renew/i)).toHaveCount(0);
    });

    test('O18: changing plan while overdue is refused, with renew as the next step', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await expect(owner.getByRole('button', { name: 'Change plan' })).toBeDisabled();
      await expect(
        owner.getByText('Your subscription is overdue, so the plan cannot be changed yet. Renew first.').first(),
      ).toBeVisible();
    });

    test('O24: renewing in grace with payment details holds access while it waits, and says so', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await owner.getByRole('button', { name: 'Renew' }).click();
      await owner.getByRole('button', { name: 'Request renewal' }).click();
      await savePayment(owner, { method: 'Cash', amount: '1000' });
      await expect(
        owner.getByText(/^It was due on .*\. Your payment details came in, so access is held until /),
      ).toBeVisible();
    });

    test('O25: grace and hold both over: expired, on Free, and Billing still opens', async ({ as }) => {
      // The waiting renewal is rejected so no hold is left, then the access end goes into the past.
      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approver.getByRole('button', { name: 'Reject', exact: true }).click();
      await approver.getByRole('dialog').getByLabel('Reason').fill('E2E: let it lapse.');
      await approver
        .getByRole('dialog')
        .getByRole('button', { name: /^Reject/ })
        .click();
      await expect(approver.getByText('Rejected. Its bill is cancelled.')).toBeVisible();
      movePeriod(-20, -2);

      const owner = await as('owner');
      await openBilling(owner);
      await expect(owner.getByRole('heading', { name: /^Basic ended on / })).toBeVisible();
      await expect(owner.getByText(/^The organization is back on the free plan; nothing was deleted\./)).toBeVisible();
      await expect(owner.getByRole('button', { name: 'Renew to restore access' })).toBeEnabled();
    });

    test('M6: after expiry, the member’s paid sub-app says the plan ended and to ask for a renewal', async ({ as }) => {
      const member = await as('member');
      await member.goto(queuePath());
      await expect(member.getByText(/^Your organization's plan has ended, so this is paused\./)).toBeVisible();
      await expect(
        member.getByText("Ask the organization's owner or an admin to renew it on the Billing page."),
      ).toBeVisible();
    });

    test('O26: renewing after expiry bills the access used past the end, and starts from approval', async ({ as }) => {
      const owner = await as('owner');
      await openBilling(owner);
      await owner.getByRole('button', { name: 'Renew to restore access' }).click();
      await expect(owner.getByText(/^Access used after the due date/)).toBeVisible();
      await owner.getByRole('button', { name: 'Request renewal' }).click();
      await expect(owner.getByRole('status').filter({ hasText: /^Requested[.,]/ })).toBeVisible();
      const bill = owner.getByText('To pay', { exact: true }).locator('xpath=following-sibling::*[1]');
      const total = ((await bill.textContent()) ?? '').replace(/[^\d.]/g, '');
      await savePayment(owner, { method: 'Cash', amount: total });

      const approver = await as('approver');
      await openQueuedRequest(approver);
      await approve(approver);
      await expect(approver.getByText('Approved: the plan is applied and a receipt issued.')).toBeVisible();

      await openBilling(owner);
      await expect(owner.getByRole('heading', { name: 'Basic is active' })).toBeVisible();
      await expect(owner.getByText(new RegExp(`^${billingDay(0)} – `))).toBeVisible();
    });
  });

test.describe
  .serial('Notices through the bell (O28, O29)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    /** The notice titles in a person's inbox. */
    async function inbox(page: import('@playwright/test').Page): Promise<string> {
      await page.goto('/notifications');
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
      await expect(page.getByText('Loading…')).toHaveCount(0);
      return (await page.locator('main').innerText()) ?? '';
    }

    test('O28: each milestone, once, to the owner and the admin, never to a member', async ({ as }) => {
      const owner = await as('owner');
      await subscribeAndApprove(owner, await as('approver'), 'Basic', '1000');
      // Day by day through the period's end, the daily check run for E2E Billing on each.
      const milestones: [number, number | undefined, RegExp][] = [
        [7, undefined, /Basic renews in 7 days/],
        [3, undefined, /Basic renews in 3 days/],
        [1, undefined, /Basic renews in 1 day\b/],
        [0, undefined, /Basic is due today/],
        [-1, undefined, /Basic is overdue: \d+ days? of access left/],
        [-6, undefined, /Last day of access to Basic/],
        [-8, undefined, /Basic has ended/],
      ];
      for (const [ends, access] of milestones) {
        movePeriod(ends, access);
        runDailyCheck();
      }
      // A second run on the last day sends nothing new.
      runDailyCheck();

      const ownerInbox = await inbox(owner);
      const adminInbox = await inbox(await as('admin'));
      for (const [, , title] of milestones) {
        expect(ownerInbox).toMatch(title);
        expect(adminInbox).toMatch(title);
      }
      expect(ownerInbox.match(/Basic is due today/g)?.length).toBe(1);

      const memberInbox = await inbox(await as('member'));
      expect(memberInbox).not.toMatch(/Basic (renews|is due|is overdue|has ended)|Last day of access/);
    });

    test('O29: a waiting request with no payment details does not count as paid: still warned', async ({ as }) => {
      resetBilling();
      const owner = await as('owner');
      await subscribeAndApprove(owner, await as('approver'), 'Basic', '1000');
      movePeriod(3);
      await openBilling(owner);
      await owner.getByRole('button', { name: 'Renew' }).click();
      await owner.getByRole('button', { name: 'Request renewal' }).click();
      await expect(owner.getByRole('status').filter({ hasText: /^Requested[.,]/ })).toBeVisible();
      runDailyCheck();
      expect(await inbox(owner)).toMatch(/Basic renews in 3 days/);
    });
  });

test.describe
  .serial('Paid ahead (journey 6: O21 → the renewal day → O9)', () => {
    test.beforeAll(() => {
      if (fixture) resetBilling();
    });

    test('on the due day the daily check renews from credit, with no request and nothing to pay', async ({ as }) => {
      const owner = await as('owner');
      await subscribeAndApprove(owner, await as('approver'), 'Basic', '3000', { months: 3 });
      movePeriod(0);
      runDailyCheck();

      await openBilling(owner);
      await expect(owner.getByRole('heading', { name: 'Basic is active' })).toBeVisible();
      await expect(owner.getByText(new RegExp(`^${billingDay(0)} – `))).toBeVisible();
      // One of the two months paid ahead is used: ₱1,000.00 of credit left.
      await expect(owner.getByText('Credit of ₱1,000.00 is applied to your next bill.')).toBeVisible();
      await expect(owner.getByText(/^Approved · /).first()).toBeVisible();
    });
  });

test.describe('A downgrade (O16)', () => {
  test.beforeAll(() => {
    if (fixture) resetBilling();
  });

  test('O16: Pro to Basic is billed on the day it is approved, its credit an estimate', async ({ as }) => {
    const owner = await as('owner');
    await subscribeAndApprove(owner, await as('approver'), 'Pro', '1500');
    await previewPlan(owner, 'Basic', { opener: 'Change plan' });
    await expect(
      owner.getByText(/^Credit is worked out on the day the change is approved\. Today's estimate: ₱500\.00\.$/),
    ).toBeVisible();
    await expect(owner.getByText(/^Making the request issues its bill when it is approved\./)).toBeVisible();
  });
});
