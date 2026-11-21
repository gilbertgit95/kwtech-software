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
| installable | the manifest is linked, says `standalone`, and every icon it names loads |
| install page | a signed-out iPhone gets `/install` with the iPhone steps |
| install page, way back | `/install` has **Back to the app**: opened directly it goes to `/` (sign-in when signed out), opened from a page of the app it goes back to that page |
| phone, signed out | a phone opening a workspace address gets the shared sign-in page |
| phone layout | a phone opens the workspace in the phone layout **at the same address**, and can **never reach the full site**: no switch, an old `full` cookie ignored, and desktop-only pages (members, settings) show the phone notice |

Without the `E2E_*` variables the first two, and the phone layout, are **skipped** with that reason, not
failed. The wrong-code test needs no account and always runs. Locally, the seed
account from `apps/web-server/.env.local` (`SEED_USER_EMAIL`, `SEED_USER_PASSWORD`)
works once the queue is on its organization's plan.

⚠ Setup calls go through `page.evaluate(fetch)`, not `page.request`. Under
`next start` the session cookie is `Secure`. The browser sends it to 127.0.0.1;
Playwright's separate request context does not, so its calls arrive signed out.

⚠ **Against `pnpm dev`, use `E2E_BASE_URL=http://localhost:8081`.** The Next dev
server answers its own script bundles with 403 for an origin it does not allow,
which includes `127.0.0.1`. The page then renders without JavaScript. The TV
never leaves its loading frame, and the sign-in form submits as a plain GET. The
default `127.0.0.1` is right for `next start`.

## Billing (#178)

The billing tests in `e2e/billing/` sign in as **their own throwaway people**,
one per perspective (owner, admin, member, billing approver, an approver who is
also a member, super admin, Support, Operations, Moderator), in their own
organization, **E2E Billing**, on Free. They never touch another organization.

```bash
# 1. the people and the organization (local profile only; refuses any other)
pnpm --filter @kwtech/web-server e2e:billing setup

# 2. the stack, built, over https (Caddy): pnpm build && pnpm pm2:start

# 3. on WSL, a Windows Chrome to drive (Playwright's own Chromium cannot start there)
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
  --remote-debugging-port=9333 --user-data-dir='C:\Users\Public\kw-e2e-billing' \
  --ignore-certificate-errors about:blank &

# 4. the tests
E2E_BASE_URL=https://localhost E2E_CDP_URL=http://localhost:9333 \
  pnpm --filter @kwtech/web-app exec playwright test e2e/billing

# 5. remove the people and the organization, and put the billing settings back
pnpm --filter @kwtech/web-server e2e:billing teardown
```

- `setup` starts with a teardown, so every run begins on Free with no requests,
  whatever the last run left. It writes the accounts and their fresh passwords
  to `e2e/billing/.fixture.json` (gitignored). Without that file the billing
  tests are **skipped** with the command to run.
- `reset` (run by the tests before each journey, about a second) puts E2E
  Billing back on Free with no billing history, keeps the people and their
  sessions, and clears their notices.
- ⚠ **Platform-wide rows.** Billing settings are one row for every
  organization: `setup` saves them as they were (`e2e/billing/.settings-before.json`,
  gitignored, written once) and adds three test payment accounts, which every
  organization's Billing page lists while the tests are set up. `teardown`
  puts the row back as it was (or removes it if there was none) and deletes
  any price a test account set. The bill and receipt numbering is rewound to
  the highest number still in use. Run `teardown` when you are done.
- `period --ends=<days> [--access=<days>]` moves E2E Billing's live period to
  end that many days from today (billing's time zone), and its access with it,
  so the date cases (renewal window, grace, hold, expiry) need no waiting.
- `daily` runs the billing daily check for **E2E Billing alone**
  (`PlatformBillingDailyCheck.runForOrganization`), booting the app's modules
  in the fixture's process with `JOBS_RUNNER=off` (refused otherwise, so no
  second job runner starts). Never the whole run: that would remind, renew
  and retry for the real organizations too.
- ⚠ **Approvers are notified of every test request**, and approvers include
  this database's real platform staff (a super admin holds the key). `reset`
  and `teardown` delete those notices, the organization's own, and any billing
  notice whose request no longer exists, but a person signed in during a run
  sees them arrive (and the toasts) until then.
- Never covered here, on purpose: archiving a plan (U6). Plans are shared with
  real organizations, and archiving one credits and withdraws on them; the
  module's unit tests cover it. Nor the approvers' digest (P16): it is about
  every organization's waiting requests, and goes to the real staff. O13 (a
  plan with no price) cannot be reached: an unpriced plan is never offered.
  O14 (the trial) has the owner create two organizations (keys `e2e-billing-trial-*`),
  which `reset` and `teardown` remove, the owner's trial with them.
- The accounts are on `@e2e-billing.test` (a reserved domain: no mail reaches
  anybody) and have no two-step sign-in. Each gets the app role every new
  account gets (`account.app_role`), plus its own role.
- Each person signs in once per run and keeps that context: sign-in is
  throttled to 10 a minute, and the refresh token rotates, so contexts
  restored from one saved state would revoke each other.
- Without `E2E_CDP_URL` Playwright launches its own Chromium as usual.
- On WSL with mirrored networking, Windows reaches the app at `https://localhost`,
  not at the LAN address in `FRONTEND_URL`.

| File | Cases of #178 |
| --- | --- |
| `access.spec.ts` | who may open which billing page: S1–S3, M1–M4, A2, A9, O1, O2, P1 (empty queue), P15, U4, T1–T3 |
| `journeys.spec.ts` | the money, each journey from a reset: the first paid month (O3–O10, P1–P4, P11–P13, A1); the admin pays (A5); withdraw (A6); rejected (P7, O11); kept as credit (P8); overpaid (P5); reversed (P9, O12); an approver who is a member (Q1–Q2); changing plan (O15, O17); paying ahead and auto-renew (O21, O22, A7); cancel (O27); approver edge cases (P6, P10); settings and adjustments (P14, U2, U3, U5); the statement (A8) |
| `dates.spec.ts` | the dates, moved with `period`, notices with `daily`: the renewal window (O19, A3, A4, O20); lapse and recovery (O23, M5, O18, O24, O25, M6, O26); notices (O28, O29); paid ahead, renewed from credit on the due day (journey 6); a downgrade (O16) |
| `steps.ts` | the steps the journeys repeat, by role and name |

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
