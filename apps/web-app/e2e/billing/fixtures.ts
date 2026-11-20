import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Browser, type BrowserContext, test as base, chromium, expect, type Page } from '@playwright/test';

/**
 * The billing browser tests' harness (#178): who is who, signed in once each,
 * and the browser they run in.
 *
 * ## The people
 *
 * `pnpm --filter @kwtech/web-server e2e:billing setup` makes an organization
 * (E2E Billing, on Free) and one throwaway account per perspective, and writes
 * them to `.fixture.json` beside this file (gitignored: it holds their
 * passwords). Without that file every billing test is SKIPPED with the command
 * to run, not failed. See `e2e/README.md`, "Billing".
 *
 * ## Signed in once per person, per run
 *
 * Each person signs in through the real sign-in page the first time a test
 * asks for them, and keeps that browser context for the rest of the run. Two
 * reasons, both learned the hard way elsewhere in this repo:
 *
 *   - sign-in is a CREDENTIAL surface, throttled to 10 a minute per address,
 *     and a run signing in per test would trip it halfway;
 *   - the refresh token ROTATES. Two contexts restored from one saved state
 *     would each present the same refresh token, and the second is told the
 *     session was revoked (the proxy and SessionKeeper avoid racing each other
 *     for the same reason).
 *
 * ## The browser
 *
 * With `E2E_CDP_URL` set, the tests drive a Chrome started with
 * `--remote-debugging-port` instead of launching one: on this repo's WSL
 * machines Playwright's own Chromium cannot start (missing system libraries),
 * and Windows Chrome reached over CDP can. Unset, Playwright launches its own.
 */

/** Everybody the fixture makes: the rows of #178's "Who is who". */
export type Person =
  | 'owner'
  | 'admin'
  | 'member'
  | 'approver'
  | 'approverMember'
  | 'superAdmin'
  | 'support'
  | 'operations'
  | 'moderator';

/** What `e2e:billing setup` writes (`apps/web-server/src/e2e/billing-fixture.ts`, `BillingFixture`). */
export interface BillingFixture {
  createdAt: string;
  organizationId: string;
  workspaceId: string;
  people: Record<Person, { id: string; email: string; password: string; name: string }>;
}

const FIXTURE_FILE = resolve(__dirname, '.fixture.json');

/** The fixture, or null when setup has not been run. */
function readFixture(): BillingFixture | null {
  if (!existsSync(FIXTURE_FILE)) return null;
  return JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as BillingFixture;
}

export const fixture = readFixture();

/** Why a billing test did not run, said where the runner prints it. */
export const NOT_SET_UP =
  'No billing fixture. Run `pnpm --filter @kwtech/web-server e2e:billing setup` first — see e2e/README.md, "Billing".';

/** The fixture, for a test that has already been skipped without it. */
export function requireFixture(): BillingFixture {
  if (!fixture) throw new Error(NOT_SET_UP);
  return fixture;
}

/**
 * Where the app is. Read here as well as in the config because the signed-in
 * contexts are WORKER-scoped and a worker fixture cannot read the test-scoped
 * `baseURL` option.
 */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8081';

/** Self-signed locally (Caddy's own CA), so certificate errors are expected over https. */
const CONTEXT_OPTIONS = { baseURL: BASE_URL, ignoreHTTPSErrors: true } as const;

/** Signs `person` in through the sign-in page, in `context`, and waits until the app has let them past it. */
export async function signIn(page: Page, person: Person): Promise<void> {
  const { email, password } = requireFixture().people[person];
  await page.goto('/auth/signin');
  await page.getByLabel('Email or username').fill(email);
  // Exact: the eye button beside the field is labelled "Show password".
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'));
}

interface TestFixtures {
  /** A new page in `person`'s signed-in context. Closed after the test; the context stays signed in. */
  as: (person: Person) => Promise<Page>;
}

interface WorkerFixtures {
  /** One signed-in context per person, made on first use and kept for the worker's life. */
  sessions: Map<Person, BrowserContext>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  browser: [
    async ({ playwright }, use) => {
      const cdp = process.env.E2E_CDP_URL;
      const browser: Browser = cdp
        ? await chromium.connectOverCDP(cdp)
        : await playwright.chromium.launch(
            process.env.PLAYWRIGHT_LIBRARY_PATH
              ? { env: { ...process.env, LD_LIBRARY_PATH: process.env.PLAYWRIGHT_LIBRARY_PATH } }
              : {},
          );
      await use(browser);
      // Over CDP this disconnects and leaves the Chrome running, which is the point: it is not ours to stop.
      await browser.close();
    },
    { scope: 'worker' },
  ],

  // A signed-out page gets the same options as the signed-in ones.
  contextOptions: async ({ contextOptions }, use) => {
    await use({ ...contextOptions, ...CONTEXT_OPTIONS });
  },

  sessions: [
    /*
     * Depends on `browser` so Playwright tears this down FIRST: the contexts
     * close while their browser is still connected.
     */
    // biome-ignore lint/correctness/noUnusedFunctionParameters: the dependency is the ordering.
    async ({ browser }, use) => {
      const sessions = new Map<Person, BrowserContext>();
      await use(sessions);
      for (const context of sessions.values()) await context.close();
    },
    { scope: 'worker' },
  ],

  as: async ({ browser, sessions }, use) => {
    const opened: Page[] = [];
    await use(async (person) => {
      let context = sessions.get(person);
      if (!context) {
        context = await browser.newContext(CONTEXT_OPTIONS);
        const first = await context.newPage();
        await signIn(first, person);
        await first.close();
        sessions.set(person, context);
      }
      const page = await context.newPage();
      opened.push(page);
      return page;
    });
    for (const page of opened) await page.close();
  },
});

export { expect };

/** The organization's pages, built the way `module-platform-billing`'s `routes.ts` builds them. */
export function billingPath(suffix = ''): string {
  return `/organizations/${encodeURIComponent(requireFixture().organizationId)}/billing${suffix}`;
}

/**
 * A refusal, as #99 requires every one to be: the page's title, the sentence
 * saying why, and (when given) the detail naming the next step. Never a bare
 * "Not permitted" or an empty page.
 */
export async function expectRefused(
  page: Page,
  refusal: { title: string; reason: string | RegExp; detail?: string | RegExp },
): Promise<void> {
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: refusal.title, exact: true })).toBeVisible();
  await expect(main.getByText(refusal.reason)).toBeVisible();
  if (refusal.detail) await expect(main.getByText(refusal.detail)).toBeVisible();
}
