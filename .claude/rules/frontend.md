---
paths:
  - "apps/web-app/**"
  - "packages/*/src/react/**"
  - "packages/*/src/next/**"
  - "packages/web-ui/**"
---

# Standards: frontend (Next.js, React, styling)

Reference: `packages/module-queuing-window/src/react/`. **There is no Apollo
Client, no codegen, no react-query and no redux. Do not add them.**

## Next.js (apps/web-app, Next 16 app router)

- **Server components are only the app's own `page.tsx` / `layout.tsx` and layout
  shell.** Every component, hook and client file in a module or `web-ui` starts
  with `'use client';`. There are no server actions.
- **Module pages never get a page file.** They render through
  `app/(modules)/[...slug]/page.tsx`, which matches the route, calls `notFound()`,
  enforces the route's `feature` on the server (`<FeatureDenied>`), and picks a
  frame from `route.chrome` (`app` | `bare` | `fullscreen`).
- **Metadata uses `generateMetadata()`**, so names are read at runtime.
- **Env:**
  - Server values come from `src/config/env.ts` (zod, asserted in
    `instrumentation.ts`) and reach client components as props.
  - The only public variable is `NEXT_PUBLIC_WS_URL`. Do not add others.
- **The browser never calls the API directly.** Client code POSTs to
  `/api/auth/graphql` with `credentials: 'same-origin'`. The route handler from
  `@kwtech/module-auth/next` proxies it, and tokens stay in httpOnly cookies.
- **Server data** is plain `fetch` with `getSessionToken()` and `cache: 'no-store'`,
  wrapped in React `cache()`, returning a safe fallback on failure
  (`src/lib/session-query.ts`). Keep "signed out" (redirect to sign-in) separate
  from "API unreachable" (a "Cannot reach the server" screen, no redirect).
- **Modules never import `next/*`.** Navigate with `<a href>` or
  `window.location.assign`. `next/link` and `next/navigation` live only in
  `apps/web-app/src/components/layout/`.
- **`middleware.ts` renews the session; it is not a guard.**
- **`transpilePackages` is derived from package.json.** Never hand-list packages.

## Components

- **`function` declarations and named exports.** No `React.FC`, `forwardRef` or
  `memo`. `useCallback` / `useMemo` are fine for stable identities.
- **Props:** inline destructured types for private components. For package API,
  use an exported `interface XProps`, never a `type`.
- **Conditional rendering is a ternary to `null`: `{x ? <A /> : null}`.** Never
  JSX `&&`. There are 0 in the codebase, because `0 && …` renders "0".
- **Keys are stable ids, never array indexes.**
- **Put pure view rules in `react/view/*.ts`** (unit-tested) and keep components
  thin. A long page is tolerated; untested logic inside it is not.
- **Use the module's shared page frame** (`QueuePage`, `ChatSubPage`, `SettingsPage`,
  `AdminShell`).

## State, data and hooks

- **Each page gets one data hook** that returns `{ view, error, busy, reload,
  run(action), dismissError }`. It guards double submits with an in-flight flag
  and reloads after every action (`use-queue-console.ts`).
- **The API client is `createXClient()`**, returning a typed interface with one
  method per operation. Result types are hand-written `*View` interfaces in the
  client file. Its errors are user-facing sentences ("Your session has ended.
  Sign in again.", "Cannot reach the server.").
- **Hooks and pages accept an injectable client** (`options: { client?: XClient }`),
  so they can be tested.
- **No client cache and no optimistic UI:** after a mutation, re-read.
- **`useEffect` data loads use a `let cancelled = false` guard in cleanup.**
  Subscriptions return their unsubscribe and clear their timers.
- **Realtime:** `useRealtime()` returns `null` when not live. Treat each event as
  "something changed": debounce and re-read, and show `live: false` as a note.
- **Global state is context only:** `ThemeProvider` → `StatusProvider` →
  `RealtimeProvider`, and `PermissionsProvider` → `FeatureAccessProvider` in
  `AppShell`.

## Permission gating in the UI

- **Every `ModuleRoute` declares `feature`.** Omit it only for truly public routes
  (auth pages, the fullscreen display).
- **Inside a page, hide controls with `useHoldsFeature(KEY)`** from
  `@kwtech/module-kit/react`. `FeatureGate` / `useHasFeature` from
  module-permissions are for that module only; other modules may not import it.
- **Gates fail closed:** no provider or an empty list hides. Hiding is cosmetic,
  because the API authorises again.
- **Denials explain why** through `denialMessage` / `<FeatureDenied>`: "Your plan
  does not include this. Upgrading adds it."

## Forms

- **Controlled inputs over a `draft` object.** Validate with the same pure
  validator the server runs (`validateXDraft` in `src/domain/`), keep a per-field
  `errors` map, and return early if it is non-empty.
- **Submit:** `setSaving(true)`, then try / catch / finally. The failure message is
  `cause instanceof Error ? cause.message : 'Could not save the role.'`.
  Success shows `role="status"` "Saved.". Buttons are `disabled={saving}`, and
  labels change ("Saving…").
- **Auth forms use `useAuthForm` with `FormData`.** That exception is deliberate;
  keep it inside module-auth.
- **Fields:** a `Field({ label, hint, error, children: (id) => … })` with `useId`
  and `htmlFor`; the error replaces the hint. New fields also set `aria-invalid`
  and `aria-describedby`.
- **Destructive actions use `ConfirmDialog` from `@kwtech/web-ui/react`**
  (`danger`, `pending`), never `window.confirm`.

## Styling

- **Tailwind 4 with theme tokens only:** `text-muted-foreground`, `border-border`,
  `bg-card`, `bg-primary text-primary-foreground`, `text-destructive`,
  `bg-status-success`, and the rest (`packages/web-ui/src/base.css`).
  - No raw palette colours (`bg-emerald-500`, `text-white`).
  - No `bg-[var(--…)]` arbitrary values when a utility exists.
  - `dark:` is almost never needed, because tokens flip.
- **Merge classes with `cn()` from `@kwtech/web-ui/react`.** Express variants as a
  function over a union (`buttonClass(variant, size)`), with no CVA.
- **Focus is visible:** `focus-visible:ring-2 focus-visible:ring-ring`.
- **Common idioms:** `mx-auto w-full max-w-3xl`; an `h1` is
  `text-2xl font-semibold tracking-tight`; a section is
  `rounded-lg border border-border p-4`.
- **Icons:** lucide-react. Nav icons are string names (`nav: { icon: 'megaphone' }`).
- **`web-ui` exports** ConfirmDialog, DataGrid, DropdownMenu, IconPicker,
  MultiSelect, StatusBar, ThemeSwitcher, TreeSelect, useDebouncedValue and `cn`.
  Check there before building a primitive. A component moves into `web-ui` only
  when a second module needs it.

## Accessibility and copy

- **Label every input** (`useId` + `htmlFor`). Errors use `role="alert"`, outcomes
  `role="status"`, and live regions `aria-live`.
- **Icon-only buttons have `aria-label`; decorative SVGs `aria-hidden`.**
- **Non-submit buttons always have `type="button"`.**
- **Use semantic `section` / `h1` / `h2`.** E2E tests select by role and name, so
  accessible names are part of the contract.
- **Copy is plain English sentences** with no i18n layer.
  - Buttons are verbs ("Call next", "Create role").
  - Links name their destination ("← Back to chat").
  - Use `…`, not `...`.
  - Error fallbacks read "Could not load your profile."; prefer the API's own
    message.

## Module web descriptor

- **`src/react/module.tsx` exports `xWebModule(options)` returning a
  `WebModuleDescriptor`:** `key`, `routes`, `navGroups`, `Provider`, `features`,
  `limits`, `defaults`, `defaultMoments`.
- **Paths and href builders live in `routes.ts`** (`encodeURIComponent` every
  segment).
- **Each route's `component` is a thin adapter** mapping `params` / `searchParams`
  to real props. Sanitise `?next=` with `safeNext`.
- **Nav `badge` is a prop-less component reference, never a function**, because
  server components cannot pass functions.
- **Register in `apps/web-app/src/modules.ts` `WEB_MODULES`.**
