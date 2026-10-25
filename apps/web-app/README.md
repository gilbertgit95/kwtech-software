# @kwtech/web-app

Next.js 16 App Router frontend. Tailwind 4, Apollo Client 4 over HTTP + WS,
components from `@kwtech/web-ui`, permission gates from
`@kwtech/web-permissions/react`.

Not scaffolded yet. Generate with `create-next-app` in Phase 4 (see
[docs/PLAN.md](../../docs/PLAN.md) §10), then mirror the structure of
`../../../masterdb-mgt-tool/apps/mgt-frontend`.

## Installing it as a phone app

The app is a PWA: `src/app/manifest.ts` and the icons in `public/icons/` let a
phone install it from the browser, with no app store. It opens full screen from
its own icon and loads this same site, so sign-in and permissions work as they
do in a tab. `/install` (public) gives each device its steps, and the account
menu links to it. Why there is no service worker yet: PLAN §13, 2026-10-25,
and §12.120–122.

To try it on a phone during development, the phone needs HTTPS or the
computer's own `localhost`. Chrome on a computer can install from `localhost`
directly; a phone on the same network cannot, because a plain-HTTP address
other than `localhost` is never installable.
