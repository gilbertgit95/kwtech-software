import { billingPath, expect, expectRefused, fixture, NOT_SET_UP, type Person, requireFixture, test } from './fixtures';

/**
 * Who may open which billing page (#178, sections 1, 2, 3, 5, 7 and 8): the
 * cases that need nothing but the people, on an organization still on Free.
 *
 * Every refusal is asserted with its sentence and, where the app names one,
 * its next step (#99): a refusal that renders an empty page or a bare "Not
 * permitted" fails here even though the access itself was right.
 */

test.skip(!fixture, NOT_SET_UP);

/** What the organization's billing routes say to somebody without "See billing". */
const NOT_GRANTED = 'Your roles do not include this. An administrator can grant it.';
const ASK_OWNER =
  "“See billing” needs the Organization admin or Organization owner role. Ask the organization's owner or an admin to give you one.";

/** The organization drawer's Billing entry, or the platform's Billing queue. */
function navLink(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('navigation').getByRole('link', { name, exact: true });
}

test.describe('1. Signed out', () => {
  test('S1: the billing page sends you to sign in, and back to Billing after', async ({ page }) => {
    await page.goto(billingPath());
    await expect(page).toHaveURL(/\/auth\/signin\?next=/);

    const { email, password } = requireFixture().people.owner;
    await page.getByLabel('Email or username').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(new RegExp(`${billingPath()}$`));
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
  });

  test('S2: the billing queue sends you to sign in', async ({ page }) => {
    await page.goto('/admin/billing');
    await expect(page).toHaveURL(/\/auth\/signin/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('S3: a receipt link shows nothing signed out', async ({ page }) => {
    await page.goto(billingPath('/documents/any-request?kind=receipt&number=R-000001'));
    await expect(page).toHaveURL(/\/auth\/signin/);
    await expect(page.getByText(/Acknowledgement receipt/i)).toHaveCount(0);
  });
});

test.describe('2. Member (no billing keys)', () => {
  test('M1: no Billing in the organization menu', async ({ as }) => {
    const page = await as('member');
    await page.goto(`/organizations/${requireFixture().organizationId}/overview`);
    await expect(navLink(page, 'Members')).toBeVisible();
    await expect(navLink(page, 'Billing')).toHaveCount(0);
  });

  test('M2: the billing address names the roles that open it, and who to ask', async ({ as }) => {
    const page = await as('member');
    await page.goto(billingPath());
    await expectRefused(page, { title: 'Billing', reason: NOT_GRANTED, detail: ASK_OWNER });
  });

  test('M3: a bill or receipt of their own organization is refused the same way', async ({ as }) => {
    const page = await as('member');
    await page.goto(billingPath('/documents/any-request?kind=bill&number=B-000001'));
    await expectRefused(page, { title: 'Billing document', reason: NOT_GRANTED, detail: ASK_OWNER });
  });

  test('M4: the billing queue is refused, with its reason', async ({ as }) => {
    const page = await as('member');
    await page.goto('/admin/billing');
    await expectRefused(page, { title: 'Billing queue', reason: NOT_GRANTED });
  });
});

test.describe('3. Organization admin', () => {
  test('A2: on Free, Choose a plan is off, with the owner-only reason', async ({ as }) => {
    const page = await as('admin');
    await page.goto(billingPath());
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose a plan' })).toBeDisabled();
    await expect(page.getByText("Only the organization's owner can choose, change or cancel the plan.")).toBeVisible();
  });

  test('A9: the billing queue is refused: it is a platform page', async ({ as }) => {
    const page = await as('admin');
    await page.goto('/admin/billing');
    await expectRefused(page, { title: 'Billing queue', reason: NOT_GRANTED });
  });
});

test.describe('4. Organization owner, reading', () => {
  test('O1: Billing on Free offers Choose a plan and Compare plans', async ({ as }) => {
    const page = await as('owner');
    await page.goto(billingPath());
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    await expect(page.getByText('No paid plan')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose a plan' })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Compare plans' })).toBeVisible();
    await expect(page.getByText('No requests yet.')).toBeVisible();
  });

  test('O2: Compare plans lists every public plan with its price, marks the current one, hides the private one', async ({
    as,
  }) => {
    const page = await as('owner');
    await page.goto(billingPath('/plans'));
    await expect(page.getByRole('heading', { name: 'Compare plans', exact: true })).toBeVisible();
    const table = page.getByRole('table');
    for (const plan of ['Free', 'Basic', 'Pro']) {
      await expect(table.getByRole('columnheader', { name: new RegExp(`^${plan}\\b`) })).toBeVisible();
    }
    await expect(table.getByText('Your plan')).toBeVisible();
    await expect(table.getByText(/₱[\d,]+\.\d\d a month/)).toHaveCount(2);
    // Custom is not public: priced by agreement, never offered on this page.
    await expect(table.getByRole('columnheader', { name: /Custom/ })).toHaveCount(0);
  });
});

test.describe('5. Billing approver (not a member)', () => {
  test('P1 (empty): the queue opens, with its tabs, and the menu has the billing pages', async ({ as }) => {
    const page = await as('approver');
    await page.goto('/admin/billing');
    await expect(page.getByRole('heading', { name: 'Billing queue', exact: true })).toBeVisible();
    for (const entry of ['Billing queue', 'Organizations’ billing', 'Billing reports', 'Billing settings']) {
      await expect(navLink(page, entry)).toBeVisible();
    }
  });

  test("P15: the organization's own billing page is refused: staff, not a member", async ({ as }) => {
    const page = await as('approver');
    await page.goto(billingPath());
    await expectRefused(page, { title: 'Billing', reason: NOT_GRANTED, detail: ASK_OWNER });
  });
});

test.describe('7. Super admin', () => {
  test("U4: the organization's billing page opens with the owner's controls, without being a member", async ({
    as,
  }) => {
    const page = await as('superAdmin');
    await page.goto(billingPath());
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose a plan' })).toBeEnabled();
  });
});

test.describe('8. Other platform staff', () => {
  for (const person of ['support', 'operations', 'moderator'] satisfies Person[]) {
    test(`T1: ${person} is refused the billing queue, and has no billing in the menu`, async ({ as }) => {
      const page = await as(person);
      await page.goto('/admin/billing');
      await expectRefused(page, { title: 'Billing queue', reason: NOT_GRANTED });
      await expect(navLink(page, 'Billing queue')).toHaveCount(0);
    });
  }

  test("T2: support staff are refused the organization's billing page", async ({ as }) => {
    const page = await as('support');
    await page.goto(billingPath());
    await expectRefused(page, { title: 'Billing', reason: NOT_GRANTED, detail: ASK_OWNER });
  });
});
