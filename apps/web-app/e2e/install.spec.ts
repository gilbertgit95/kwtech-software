import { expect, test } from '@playwright/test';

/**
 * Installable as an app: what a phone checks before it offers "Install app",
 * and the page that tells people how.
 *
 * No account and no data: everything here is public, so these always run.
 * The failures they catch are silent ones — a manifest a proxy redirected to
 * sign-in, or an icon path that 404s, leaves the site working perfectly in a
 * browser and simply never installable.
 */

test('the manifest makes the site installable', async ({ page, request }) => {
  await page.goto('/install');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href, 'every page links the manifest').toBeTruthy();

  const response = await request.get(href ?? '');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name?: string;
    start_url?: string;
    display?: string;
    icons?: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.name).toBeTruthy();
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');

  // Chrome needs a 192 and a 512 that actually load; a broken path is not an error, just no install.
  const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons ?? []) {
    const image = await request.get(icon.src);
    expect(image.ok(), `${icon.src} loads`).toBe(true);
    expect(image.headers()['content-type']).toContain('image/png');
  }
});

test('the install page gives a phone its steps without signing in', async ({ browser }) => {
  // An iPhone, signed out: the person who scanned the QR code at the counter.
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/install');

  await expect(page.getByRole('heading', { level: 1, name: /^Install .+ on your phone$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'iPhone and iPad' })).toBeVisible();
  await expect(page).toHaveURL(/\/install$/);
  await context.close();
});
