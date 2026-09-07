'use client';

import { MIN_PASSWORD_LENGTH } from '@kwtech/module-auth';
import { AuthError, AuthField, AuthShell, AuthSubmit, createAuthClient } from '@kwtech/module-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * /invitations/accept?token=… — the other end of an invitation email.
 *
 * ## Why this page belongs to the APP
 *
 * It is the one screen that needs both modules at once: it reads an invitation
 * (module-permissions) and it may create an account (module-auth), and neither
 * module may import the other (PLAN §9). It is the client half of
 * `invitations.resolver.ts`, which is in the app for exactly the same reason.
 *
 * ## Four ways in, decided by what the reader already has
 *
 *   signed in AS THE INVITED ADDRESS   one button. Joining is one write.
 *   signed in as SOMEBODY ELSE         a warning and two explicit choices.
 *   an account, signed out   sent to /auth/signin?next=… and back here after.
 *   no account           a password field. The address is NOT asked for — it
 *                        comes from the invitation, so there is nothing to type
 *                        wrong and no way to point the link at another address.
 *
 * ## The mismatch case is the one that was wrong
 *
 * This page used to show a single Join button to anybody with a session,
 * mentioning the invited address in a passing sentence. Following an invitation
 * while signed in as a different account therefore joined THAT account,
 * silently — and because acceptance replaces the organization role, an owner
 * who tested their own invitation was quietly demoted to what the invitation
 * offered. It happened, to a real organization, before this branch existed.
 *
 * The rule that made it possible is still right: an invitation is addressed to
 * a mailbox, and whoever reads it may legitimately hold a different account —
 * a work address that forwards to a personal one is ordinary. So the mismatch
 * is not REFUSED. It is made loud, and it takes a deliberate click either way:
 * sign out and come back as the invited address, or join as who you are, having
 * been told what that means.
 *
 * ## Signing up does not sign you in
 *
 * `signUpFromInvitation` creates the account and stops. This page then posts to
 * `/api/auth/signin` like any other sign-in, so the httpOnly cookie is written
 * by the one adapter that writes cookies and the credential throttler sees a
 * sign-in where it expects one. It costs a second request and buys not having a
 * second way to mint a session.
 */

interface Preview {
  organizationName: string;
  email: string;
  roleLabel: string | null;
  hasAccount: boolean;
  expiresAt: string;
}

const GRAPHQL_PATH = '/api/auth/graphql';

async function graphql<T>(document: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(GRAPHQL_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Sent when there is one, and this page is reachable without one — the
    // proxy forwards a signed-out GraphQL request and the API's own guards
    // decide, which is why `invitationPreview` is marked @Public there.
    credentials: 'same-origin',
    body: JSON.stringify({ query: document, variables }),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Cannot reach the server.');
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
  if (!body.data) throw new Error('The server returned no data.');
  return body.data;
}

/**
 * Compared the way the server stores addresses — see `normaliseInviteEmail` and
 * `auth_user.email`. Comparing raw strings would report a mismatch for the one
 * person whose mail client capitalises, which is the worst possible false
 * alarm: it accuses somebody of being the wrong person.
 */
function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function AcceptInvitation({
  token,
  viewerEmail,
}: {
  token: string | null;
  /** The signed-in account's address, or null when nobody is signed in. */
  viewerEmail: string | null;
}) {
  const auth = useMemo(() => createAuthClient(), []);
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    graphql<{ invitationPreview: Preview | null }>(
      `query InvitationPreview($token: String!) {
         invitationPreview(token: $token) {
           organizationName
           email
           roleLabel
           hasAccount
           expiresAt
         }
       }`,
      { token },
    )
      .then((data) => {
        if (!cancelled) setPreview(data.invitationPreview);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          // Distinguished from an invalid invitation: one is worth retrying and
          // the other never will be.
          setError(cause instanceof Error ? cause.message : 'Could not read this invitation.');
          setPreview(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** Already signed in: one write, then out to the app. */
  const join = useCallback(async () => {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      await graphql(`mutation AcceptInvitation($token: String!) { acceptInvitation(token: $token) { changed } }`, {
        token,
      });
      // A full navigation, not a router push: the shell reads the session
      // server-side, and the new membership changes what it may show.
      window.location.assign('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not accept this invitation.');
      setPending(false);
    }
  }, [token]);

  const signUp = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token || !preview) return;

      const form = new FormData(event.currentTarget);
      const password = String(form.get('password') ?? '');
      const confirm = String(form.get('confirm') ?? '');
      const displayName = String(form.get('displayName') ?? '').trim();

      // Checked here rather than server-side because it is not a rule about the
      // password — it is a check that the person typed what they meant to, and
      // the server has no second field to compare.
      if (password !== confirm) {
        setError('Those two passwords are not the same.');
        return;
      }

      setPending(true);
      setError(null);
      try {
        await graphql(
          `mutation SignUpFromInvitation($token: String!, $password: String!, $displayName: String) {
             signUpFromInvitation(token: $token, password: $password, displayName: $displayName) { email }
           }`,
          { token, password, displayName: displayName || null },
        );

        /*
         * Signed in through the ordinary path, with the address the INVITATION
         * carried — never one from this form. The account exists either way, so
         * a failure here is recoverable by signing in; the message says so
         * instead of implying nothing happened.
         */
        await auth.signIn({ identifier: preview.email, password });
        window.location.assign('/');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Your account may have been created. Try signing in.');
        setPending(false);
      }
    },
    [auth, preview, token],
  );

  if (preview === undefined) {
    return (
      <AuthShell title="Invitation" description="Checking this link…">
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      </AuthShell>
    );
  }

  if (preview === null) {
    return (
      <AuthShell
        title="This invitation is not valid"
        description="It may have been withdrawn, already used, or simply run out. Ask whoever invited you to send another."
        footer={
          <a href="/auth/signin" className="underline underline-offset-4 hover:text-foreground">
            Sign in
          </a>
        }
      >
        <AuthError>{error}</AuthError>
      </AuthShell>
    );
  }

  const role = preview.roleLabel ? ` as ${preview.roleLabel}` : '';
  // Where signing in — or signing out and back in — returns to.
  const here = `/invitations/accept?token=${encodeURIComponent(token ?? '')}`;

  if (viewerEmail && !sameAddress(viewerEmail, preview.email)) {
    /*
     * Sign out, then sign in, then come back here — expressed as ONE control,
     * because it is one intention. The destination is carried through the
     * sign-out (`?next=`) and again through the sign-in (`?next=`), so the link
     * survives both steps; losing it would leave somebody on a bare sign-in
     * page wondering where their invitation went.
     */
    const signOutAction = `/api/auth/signout?next=${encodeURIComponent(`/auth/signin?next=${encodeURIComponent(here)}`)}`;

    return (
      <AuthShell
        title={`Join ${preview.organizationName}`}
        description={`This invitation was sent to ${preview.email}.`}
      >
        <AuthError>{error}</AuthError>

        <p className="mb-4 rounded-md bg-[var(--status-warning)] px-3 py-2 text-sm text-[var(--status-warning-foreground)]">
          You are signed in as <strong>{viewerEmail}</strong>, which is not the address this invitation was sent to.
        </p>

        {/*
          A form POST, not a link: signing out revokes the session server-side
          as well as clearing the cookie, and a GET that changed state would be
          followed by every link prefetcher in the browser.
        */}
        <form action={signOutAction} method="post">
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Sign out and sign in as {preview.email}
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2 text-sm text-muted-foreground">
            {/*
              Says what actually happens, in the words of the consequence rather
              than of the mechanism. "Uses up the invitation" is the part
              somebody needs: the person it was sent to cannot then use it.
            */}
            Or join as yourself. <strong>{viewerEmail}</strong> becomes a member{role}, this uses up the invitation, and{' '}
            {preview.email} will need a new one.
          </p>
          <button
            type="button"
            onClick={() => void join()}
            disabled={pending}
            className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            {pending ? 'Joining…' : `Join as ${viewerEmail}`}
          </button>
        </div>
      </AuthShell>
    );
  }

  if (viewerEmail) {
    return (
      <AuthShell
        title={`Join ${preview.organizationName}`}
        description={`You have been invited${role}. You are signed in as ${preview.email}, so this is the last step.`}
      >
        <AuthError>{error}</AuthError>
        <button
          type="button"
          onClick={() => void join()}
          disabled={pending}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? 'Joining…' : `Join ${preview.organizationName}`}
        </button>
      </AuthShell>
    );
  }

  if (preview.hasAccount) {
    // `next` carries the whole path, token included, so signing in comes back
    // here and lands on the one-button case above.
    const next = encodeURIComponent(here);
    return (
      <AuthShell
        title={`Join ${preview.organizationName}`}
        description={`You have been invited${role}. Sign in as ${preview.email} to accept.`}
      >
        <AuthError>{error}</AuthError>
        <a
          href={`/auth/signin?next=${next}`}
          className="block w-full rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground"
        >
          Sign in to continue
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${preview.organizationName}`}
      description={`You have been invited${role}. Choose a password to finish setting up ${preview.email}.`}
    >
      <form onSubmit={(event) => void signUp(event)} noValidate>
        <AuthError>{error}</AuthError>
        {/*
          No email field. The address is the invitation's, so there is nothing
          to type wrong — and nothing that would let this link create an account
          at an address nobody was invited at.
        */}
        <AuthField label="Your name" name="displayName" autoComplete="name" required={false} />
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
        />
        <AuthField label="Confirm password" name="confirm" type="password" autoComplete="new-password" />
        <AuthSubmit pending={pending}>Create account and join</AuthSubmit>
      </form>
    </AuthShell>
  );
}
