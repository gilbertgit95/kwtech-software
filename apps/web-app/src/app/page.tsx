import { getViewer } from '@kwtech/module-auth/next';
import { AppShell } from '@/components/layout/app-shell';

/**
 * The dashboard — the application's own page, not a module's, which is why it
 * is a real file rather than a descriptor behind the catch-all.
 *
 * A server component: it reads the httpOnly session cookie, which no client
 * component can. That also makes it the honest proof that the auth loop
 * closes — if the greeting renders, the cookie was set, survived the redirect,
 * and the API accepted it.
 *
 * No signed-out branch any more: AppShell redirects to /auth/signin when there
 * is no viewer, so by the time this renders there is one. `getViewer()` is
 * called twice per request as a result — once by the shell, once here — which
 * is one extra hit on /auth/profile. Worth fixing with React `cache()` when a
 * third caller appears; not worth an abstraction for two.
 */
export default async function DashboardPage() {
  const viewer = await getViewer();

  return (
    <AppShell title="Dashboard">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {viewer?.displayName ?? viewer?.username ?? 'Welcome'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Signed in as {viewer?.email}</p>

        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-medium text-card-foreground">Nothing here yet</h2>
          {/*
           * Deliberately empty rather than filled with placeholder tiles. A
           * dashboard of invented numbers is the kind of thing that gets
           * screenshotted and believed.
           */}
          <p className="mt-2 text-sm text-muted-foreground">
            The side drawer lists what you can reach. It grows as modules are composed into this app — entries appear
            only when you hold the feature key behind them.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
