# Browser tests

Playwright, against a running stack: the flows nothing else can see end to end.

```bash
# 1. once per machine
pnpm --filter @kwtech/web-app exec playwright install chromium
sudo pnpm --filter @kwtech/web-app exec playwright install-deps chromium   # or see "without root" below

# 2. the stack: API on :8080 and the BUILT app on :8081, against a database
pnpm --filter @kwtech/web-server exec nest build && node apps/web-server/dist/main.js
pnpm --filter @kwtech/web-app build && pnpm --filter @kwtech/web-app exec next start -p 8081

# 3. the tests
E2E_EMAIL=… E2E_PASSWORD=… E2E_ORGANIZATION_ID=… E2E_WORKSPACE_ID=… \
  pnpm --filter @kwtech/web-app test:e2e
```

What runs:

| Test | Proves |
| --- | --- |
| console to TV | Start queuing shows a code and QR; a second, signed-out browser opens the display from the link, the code leaves the address bar, **Call next appears on the TV live**, and **Stop returns the TV to its code prompt** |
| workspace voice | the Announcements settings save and survive a reload (the original pitch is put back) |
| wrong code | a TV with a bad code gets the one refusal sentence |

Without the `E2E_*` variables the first two are **skipped** with that reason, not
failed. The wrong-code test needs no account and always runs. Locally, the seed
account from `apps/web-server/.env` (`SEED_USER_EMAIL`, `SEED_USER_PASSWORD`)
works once the queue is on its organization's plan.

⚠ Setup calls go through `page.evaluate(fetch)`, not `page.request`. Under
`next start` the session cookie is `Secure`. The browser sends it to 127.0.0.1;
Playwright's separate request context does not, so its calls arrive signed out.

⚠ **Against `pnpm dev`, use `E2E_BASE_URL=http://localhost:8081`.** The Next dev
server answers its own script bundles with 403 for an origin it does not allow,
which includes `127.0.0.1`. The page then renders without JavaScript. The TV
never leaves its loading frame, and the sign-in form submits as a plain GET. The
default `127.0.0.1` is right for `next start`.

## What the account needs

The queue test signs in as `E2E_EMAIL` and uses the queue in `E2E_WORKSPACE_ID`, so
that account must be able to **start, stop, serve, assign and manage windows** there.
That means a workspace member whose role carries the six `queue:*` keys, in an
organization on a plan that sells them. A super-admin account that is a member
also works. Two-factor sign-in is not supported by the test.

⚠ It writes real rows into that workspace: a line with prefix `Z9`, a window
named `E2E window`, a seat, and one queuing session. It archives the line and
window, frees the seat and stops queuing when it finishes, and reuses the same
rows on the next run. Point it at a workspace where that is acceptable.

## Without root

Chromium's missing system libraries can be unpacked into your own folder instead
of installed:

```bash
mkdir -p ~/.cache/ms-playwright/deps/debs && cd ~/.cache/ms-playwright/deps/debs
apt-get download libnspr4 libnss3 libasound2t64
for deb in *.deb; do dpkg-deb -x "$deb" ../root; done
export PLAYWRIGHT_LIBRARY_PATH=~/.cache/ms-playwright/deps/root/usr/lib/x86_64-linux-gnu
```

`playwright.config.ts` hands `PLAYWRIGHT_LIBRARY_PATH` to the browser as
`LD_LIBRARY_PATH`. Run `ldd` on the browser binary to see which libraries are
missing on yours.

## What is still not covered

Headless Chromium mutes audio and has no speech voices, so these tests prove the
board RECEIVES a call. They do not prove that a TV chimes, speaks it, or stays
awake. Check those on the real screen.
