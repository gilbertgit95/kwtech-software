import Link from 'next/link';

/**
 * A placeholder home page. The product's real entry point arrives with the
 * first feature; this exists so `/` is not a 404 while auth is the only thing
 * built.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">kwtech</h1>
        <p className="mt-2 text-sm text-muted-foreground">Nothing here yet.</p>
        <Link href="/auth/signin" className="mt-6 inline-block text-sm underline underline-offset-4">
          Sign in
        </Link>
      </div>
    </main>
  );
}
