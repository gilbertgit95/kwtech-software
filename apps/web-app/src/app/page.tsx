import Link from 'next/link';
import { getViewer } from '@/lib/session';

/**
 * The landing page, and for now the only thing behind sign-in.
 *
 * A server component, deliberately: it reads the httpOnly session cookie, which
 * no client component can. That also makes this the honest proof that the auth
 * loop closes — if the greeting renders, the cookie was set, survived the
 * redirect, and the API accepted it.
 */
export default async function HomePage() {
  const viewer = await getViewer();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">kwtech</h1>

        {viewer ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Signed in as{' '}
              <span className="font-medium text-foreground">
                {viewer.displayName ?? viewer.username ?? viewer.email}
              </span>
            </p>
            {/*
              A form POST, not a link: signing out changes server state — it
              revokes the session — and a GET that mutates is the kind of thing
              a link prefetcher or a browser extension will fire on its own.
            */}
            <form action="/api/auth/signout" method="post" className="mt-6">
              <button
                type="submit"
                className="rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">You are not signed in.</p>
            <Link
              href="/auth/signin"
              className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
