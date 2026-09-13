import { expect, type Page, test } from '@playwright/test';

/**
 * The queue, in a real browser: a supervisor starts queuing and calls a number
 * from the console, and a TV — a second browser with no session — takes the
 * display code, shows the call live, and goes back to its code prompt when
 * queuing stops.
 *
 * Needs a running stack and a signed-in-able account that can use the queue in
 * one workspace. Skipped, with the reason, when the variables are not set — see
 * `e2e/README.md`.
 */

const env = {
  email: process.env.E2E_EMAIL ?? '',
  password: process.env.E2E_PASSWORD ?? '',
  organizationId: process.env.E2E_ORGANIZATION_ID ?? '',
  workspaceId: process.env.E2E_WORKSPACE_ID ?? '',
};
const configured = Object.values(env).every(Boolean);

// A prefix and a window name no real site uses, so reruns find their own rows.
const LINE_PREFIX = 'Z9';
const WINDOW_NAME = 'E2E window';

const consolePath = `/organizations/${env.organizationId}/workspaces/${env.workspaceId}/queue`;

/**
 * A GraphQL call made FROM THE PAGE, exactly as the console makes it: a
 * same-origin fetch, with the session cookie the browser attaches.
 *
 * ⚠ Not `page.request`. Under `next start` the session cookie is `Secure`, and
 * Playwright's separate request context does not send a Secure cookie over
 * plain http — the browser does, for 127.0.0.1 — so every call arrived
 * "Not signed in".
 */
async function graphql<T>(page: Page, query: string, variables: Record<string, unknown> = {}) {
  const body = (await page.evaluate(
    async (payload) => {
      const response = await fetch('/api/auth/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      return response.json();
    },
    { query, variables },
  )) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]?.message);
  return body.data as T;
}

const scope = () => ({ organizationId: env.organizationId, workspaceId: env.workspaceId });
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

interface ConsoleShape {
  queueConsole: {
    myUserId: string;
    session: { id: string } | null;
    lines: { id: string; prefix: string; archived: boolean }[];
    windows: { id: string; name: string; archived: boolean }[];
  };
}

async function signIn(page: Page) {
  await page.goto('/auth/signin');
  await page.getByLabel('Email or username').fill(env.email);
  // Exact: the eye button beside the field is labelled "Show password".
  await page.getByLabel('Password', { exact: true }).fill(env.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'));
}

/**
 * A known starting point, made through the same API the console uses: queuing
 * stopped, one test line and one test window, the account at that window, and
 * the window calling only that line — so Call next is one unambiguous button.
 */
async function prepare(page: Page) {
  const read = () =>
    graphql<ConsoleShape>(
      page,
      `query (${SCOPE_VARS}) { queueConsole(${SCOPE_ARGS}) { myUserId session { id } lines { id prefix archived } windows { id name archived } } }`,
      scope(),
    );

  let view = (await read()).queueConsole;
  if (view.session) await graphql(page, `mutation (${SCOPE_VARS}) { stopQueue(${SCOPE_ARGS}) }`, scope());

  let line = view.lines.find((one) => one.prefix === LINE_PREFIX);
  if (!line) {
    await graphql(
      page,
      `mutation (${SCOPE_VARS}, $name: String!, $prefix: String!) { createQueueLine(${SCOPE_ARGS}, name: $name, prefix: $prefix) { id } }`,
      { ...scope(), name: 'E2E line', prefix: LINE_PREFIX },
    );
  } else if (line.archived) {
    await graphql(
      page,
      `mutation (${SCOPE_VARS}, $lineId: String!) { setQueueLineArchived(${SCOPE_ARGS}, lineId: $lineId, archived: false) { id } }`,
      { ...scope(), lineId: line.id },
    );
  }

  let window = view.windows.find((one) => one.name === WINDOW_NAME);
  if (!window) {
    await graphql(
      page,
      `mutation (${SCOPE_VARS}, $name: String!) { createQueueWindow(${SCOPE_ARGS}, name: $name) { id } }`,
      { ...scope(), name: WINDOW_NAME },
    );
  } else if (window.archived) {
    await graphql(
      page,
      `mutation (${SCOPE_VARS}, $windowId: String!) { setQueueWindowArchived(${SCOPE_ARGS}, windowId: $windowId, archived: false) { id } }`,
      { ...scope(), windowId: window.id },
    );
  }

  view = (await read()).queueConsole;
  line = view.lines.find((one) => one.prefix === LINE_PREFIX);
  window = view.windows.find((one) => one.name === WINDOW_NAME);
  if (!line || !window) throw new Error('could not prepare the test line and window');

  await graphql(
    page,
    `mutation (${SCOPE_VARS}, $windowId: String!, $lineIds: [String!]!) { setQueueWindowLines(${SCOPE_ARGS}, windowId: $windowId, lineIds: $lineIds) { id } }`,
    { ...scope(), windowId: window.id, lineIds: [line.id] },
  );
  await graphql(
    page,
    `mutation (${SCOPE_VARS}, $windowId: String!, $userId: String!) { assignQueueWindow(${SCOPE_ARGS}, windowId: $windowId, userId: $userId, confirmReplace: true) { windowId } }`,
    { ...scope(), windowId: window.id, userId: view.myUserId },
  );
  return { lineId: line.id, windowId: window.id };
}

/** Leaves the workspace as it was found: queuing stopped, the seat released, the test rows archived. */
async function tidy(page: Page, ids: { lineId: string; windowId: string }) {
  const quietly = (query: string, variables: Record<string, unknown>) =>
    graphql(page, query, { ...scope(), ...variables }).catch(() => undefined);
  await quietly(`mutation (${SCOPE_VARS}) { stopQueue(${SCOPE_ARGS}) }`, {});
  await quietly(`mutation (${SCOPE_VARS}) { releaseMyQueueSeat(${SCOPE_ARGS}) }`, {});
  await quietly(
    `mutation (${SCOPE_VARS}, $windowId: String!) { setQueueWindowArchived(${SCOPE_ARGS}, windowId: $windowId, archived: true) { id } }`,
    { windowId: ids.windowId },
  );
  await quietly(
    `mutation (${SCOPE_VARS}, $lineId: String!) { setQueueLineArchived(${SCOPE_ARGS}, lineId: $lineId, archived: true) { id } }`,
    { lineId: ids.lineId },
  );
}

test.describe('the queue, console to TV', () => {
  test.skip(!configured, 'Set E2E_EMAIL, E2E_PASSWORD, E2E_ORGANIZATION_ID and E2E_WORKSPACE_ID — see e2e/README.md');

  test('a call made on the console appears on a TV live, and Stop takes the TV back to its code prompt', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const ids = await prepare(page);

    try {
      // ── the console ────────────────────────────────────────────────────────
      await page.goto(consolePath);
      await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: WINDOW_NAME })).toBeVisible();

      await page.getByRole('button', { name: 'Start queuing' }).click();
      // Exact: the Stop dialog's warning also mentions display codes.
      await expect(page.getByText('Display code', { exact: true })).toBeVisible();
      // ⚠ Drawn in the browser from the code's link — never by a QR service.
      await expect(page.getByRole('img', { name: /QR code that opens the display/ })).toBeVisible();

      const openDisplay = page.getByRole('link', { name: 'Open display' });
      const displayUrl = await openDisplay.getAttribute('href');
      expect(displayUrl).toMatch(/\/queue-display\/[^/]+\/[^/#]+#code=[0-9A-Z]{8}$/);

      // ── the TV: a separate browser, with no session ────────────────────────
      const tvContext = await browser.newContext();
      const tv = await tvContext.newPage();
      await tv.goto(displayUrl ?? '');
      // ⚠ The code left the address bar before anything else happened.
      await expect.poll(() => new URL(tv.url()).hash).toBe('');

      await tv.getByRole('button', { name: 'Start display' }).click();
      await expect(tv.getByRole('heading', { name: 'Now serving' })).toBeVisible();
      await expect(tv.getByText('Waiting for the first number to be called.')).toBeVisible();

      // ── a call ─────────────────────────────────────────────────────────────
      await page.getByRole('button', { name: 'Call next', exact: true }).click();
      const called = page.locator('p', { hasText: new RegExp(`^${LINE_PREFIX}-\\d+$`) }).first();
      await expect(called).toBeVisible();
      const label = (await called.textContent())?.trim() ?? '';

      // ⚠ LIVE: the TV shows it without a reload.
      await expect(tv.getByText(label, { exact: true }).first()).toBeVisible();
      await expect(tv.getByText(WINDOW_NAME).first()).toBeVisible();

      // ── Stop ───────────────────────────────────────────────────────────────
      await page.getByRole('button', { name: 'Stop queuing' }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: 'Stop queuing' }).click();
      await expect(page.getByRole('heading', { name: 'Queuing has not started' })).toBeVisible();

      // ⚠ Every TV is told, and returns to the code prompt.
      await expect(tv.getByText('Queuing has stopped. Enter the new code when it starts again.')).toBeVisible();
      await expect(tv.getByLabel('Display code')).toBeVisible();

      await tvContext.close();
    } finally {
      await tidy(page, ids);
    }
  });

  test('the workspace voice is chosen on the settings page, and stays chosen', async ({ page }) => {
    await signIn(page);
    await page.goto(`${consolePath}/settings`);
    await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible();
    await expect(page.getByText('Number C-042, please proceed to Window 3.', { exact: false })).toBeVisible();

    const pitch = page.getByRole('combobox', { name: 'Pitch', exact: true });
    const original = await pitch.inputValue();
    const chosen = original === 'high' ? 'low' : 'high';
    const saved = () =>
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/auth/graphql') &&
          (response.request().postData() ?? '').includes('SetQueueVoice'),
      );

    try {
      await Promise.all([saved(), pitch.selectOption(chosen)]);
      await page.reload();
      await expect(page.getByRole('combobox', { name: 'Pitch', exact: true })).toHaveValue(chosen);
    } finally {
      await Promise.all([saved(), page.getByRole('combobox', { name: 'Pitch', exact: true }).selectOption(original)]);
    }
  });

  test('a TV given a wrong code is told nothing but that it is not valid', async ({ browser }) => {
    const tvContext = await browser.newContext();
    const tv = await tvContext.newPage();
    await tv.goto('/queue-display/no-such-organization/no-such-workspace');

    await tv.getByLabel('Display code').fill('ZZZZ-ZZZZ');
    await tv.getByRole('button', { name: 'Open' }).click();
    // ⚠ The same sentence for an unknown organization, a wrong code, or a stopped queue.
    await expect(tv.getByText('That code is not valid here right now')).toBeVisible();
    await tvContext.close();
  });
});
