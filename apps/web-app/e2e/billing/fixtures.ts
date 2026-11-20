import { execFileSync } from 'node:child_process';
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

/** How long the API's credential throttle counts sign-ins over (10 a minute per address), plus a margin. */
const THROTTLE_WINDOW_MS = 61_000;

/**
 * Signs `person` in through the sign-in page and waits until the app has let
 * them past it.
 *
 * ⚠ Sign-in is a credential surface: 10 a minute per address. A run signs
 * in nine people within the first minute or so, and a rerun straight after
 * adds more, so the tenth can be throttled. Then it waits the window out and
 * tries once more, with the test's timeout stretched to cover the wait,
 * rather than failing a test on a limit that is working as designed.
 */
export async function signIn(page: Page, person: Person): Promise<void> {
  const { email, password } = requireFixture().people[person];
  for (let attempt = 1; ; attempt += 1) {
    await page.goto('/auth/signin');
    await page.getByLabel('Email or username').fill(email);
    // Exact: the eye button beside the field is labelled "Show password".
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    try {
      await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15_000 });
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
    base.info().setTimeout(base.info().timeout + THROTTLE_WINDOW_MS + 30_000);
    await page.waitForTimeout(THROTTLE_WINDOW_MS);
  }
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

/** The API package, where the fixture's built script runs (it reads that app's env profile). */
const WEB_SERVER_DIR = resolve(__dirname, '../../../web-server');

/**
 * The organization back on Free with no billing history, between journeys
 * (`e2e:billing reset`): the people and their sessions stay.
 *
 * The built script directly, not the package script: that one compiles the
 * seed build first, ten seconds a call. `setup` built it, and the script
 * itself refuses anything but the local profile.
 */
export function resetBilling(): void {
  execFileSync('node', ['dist/e2e/billing-fixture.js', 'reset'], { cwd: WEB_SERVER_DIR, stdio: 'pipe' });
}

/** Runs one of the fixture's commands, from the built script (see `resetBilling`). */
function fixtureCommand(args: readonly string[], env: Record<string, string> = {}): void {
  execFileSync('node', ['dist/e2e/billing-fixture.js', ...args], {
    cwd: WEB_SERVER_DIR,
    stdio: 'pipe',
    env: { ...process.env, ...env },
  });
}

/**
 * Moves E2E Billing's live period to end `ends` days from today (negative:
 * in the past), and its access to the end plus grace, or `access` days from
 * today when given (`e2e:billing period`). The date cases' way of being on
 * the due day, in grace or expired without waiting.
 */
export function movePeriod(ends: number, access?: number): void {
  fixtureCommand(['period', `--ends=${ends}`, ...(access === undefined ? [] : [`--access=${access}`])]);
}

/**
 * The billing daily check for E2E Billing ALONE, now (`e2e:billing daily`):
 * its renewal from credit, then its reminders. Never the whole run, which
 * would remind and renew the real organizations too. The fixture boots the
 * app to reach the check, so the job runner is switched off for it.
 */
export function runDailyCheck(): void {
  fixtureCommand(['daily'], { JOBS_RUNNER: 'off' });
}

/** The billing time zone the local database uses (the settings' default). */
const BILLING_ZONE = 'Asia/Manila';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A day `offset` days from today in the billing zone, then `months` on with
 * billing's anchoring (the same day of the month, or the month's last day
 * when it has fewer), as the billing pages print it (`formatDay`: "17 Nov
 * 2026"). Days, not instants: added on the calendar, so a run near midnight
 * UTC still names Manila's day.
 */
export function billingDay(offset: number, months = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((one) => one.type === type)?.value);
  const day = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + offset));
  const lastOfTarget = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + months + 1, 0));
  const target = new Date(
    Date.UTC(
      lastOfTarget.getUTCFullYear(),
      lastOfTarget.getUTCMonth(),
      Math.min(day.getUTCDate(), lastOfTarget.getUTCDate()),
    ),
  );
  return `${target.getUTCDate()} ${MONTHS[target.getUTCMonth()]} ${target.getUTCFullYear()}`;
}
