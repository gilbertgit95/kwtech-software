import { type Browser, expect, type Page, test } from '@playwright/test';

/**
 * The phone layout (issue #22): a phone gets it at the SAME address a
 * computer gets the desktop shell, sign-in stays the one shared page, and a
 * phone can never reach the full site — not by the switch, not by an old
 * cookie, not by opening a desktop-only page.
 *
 * The signed-out test needs no account and always runs. The signed-in one uses
 * the queue tests' account and workspace (`E2E_*`, see README.md) and only
 * reads: it changes no data.
 */

const env = {
  email: process.env.E2E_EMAIL ?? '',
  password: process.env.E2E_PASSWORD ?? '',
  organizationId: process.env.E2E_ORGANIZATION_ID ?? '',
  workspaceId: process.env.E2E_WORKSPACE_ID ?? '',
};
const configured = Object.values(env).every(Boolean);

const workspacePath = `/organizations/${env.organizationId}/workspaces/${env.workspaceId}`;

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function phone(browser: Browser) {
  return browser.newContext({
    userAgent: IPHONE,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
}

async function signIn(page: Page) {
  await page.goto('/auth/signin');
  await page.getByLabel('Email or username').fill(env.email);
  // Exact: the eye button beside the field is labelled "Show password".
  await page.getByLabel('Password', { exact: true }).fill(env.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'));
}

test('a signed-out phone gets the shared sign-in page, not a copy', async ({ browser }) => {
  const context = await phone(browser);
  const page = await context.newPage();
  await page.goto('/organizations/any/workspaces/any');

  await expect(page).toHaveURL(/\/auth\/signin$/);
  await expect(page.getByLabel('Email or username')).toBeVisible();
  await context.close();
});

test('a phone opens a workspace in the phone layout at the same address, and can never reach the full site', async ({
  browser,
}) => {
  test.skip(!configured, 'Set E2E_EMAIL, E2E_PASSWORD, E2E_ORGANIZATION_ID and E2E_WORKSPACE_ID (see e2e/README.md).');
  const context = await phone(browser);
  // A "full site" choice left from before: a phone ignores it.
  await context.addCookies([
    { name: 'kwtech_layout', value: 'full', url: test.info().project.use.baseURL ?? 'http://127.0.0.1:8081' },
  ]);
  const page = await context.newPage();
  await signIn(page);

  await page.goto(workspacePath);
  // The address is the one asked for — rewritten on the server, never redirected to a /mobile address.
  await expect(page).toHaveURL(new RegExp(`${workspacePath}$`));
  await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();

  // No way onto the full site: not in the account sheet…
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use full site' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // …and a desktop-only page draws the phone frame saying so, at its own address, with no button out.
  for (const path of [`${workspacePath}/members`, '/settings/profile']) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { name: "This page isn't on the mobile view yet" })).toBeVisible();
    await expect(page.getByText('Open it on a computer to use it.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open full site' })).toHaveCount(0);
  }
  await context.close();
});
