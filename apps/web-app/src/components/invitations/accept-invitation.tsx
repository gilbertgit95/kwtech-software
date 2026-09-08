'use client';

import { MIN_PASSWORD_LENGTH } from '@kwtech/module-auth';
import { AuthError, AuthField, AuthShell, AuthSubmit, createAuthClient } from '@kwtech/module-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
 *   signed in as SOMEBODY ELSE         signed out automatically, then one of
 *                                      the two cases below.
 *   an account, signed out   sent to /auth/signin?next=… and back here after.
 *   no account           a password field. The address is NOT asked for — it
 *                        comes from the invitation, so there is nothing to type
 *                        wrong and no way to point the link at another address.
 *
 * ## The mismatch case, and the two things it must not do
 *
 * This page once showed a single Join button to anybody with a session,
 * mentioning the invited address in a passing sentence. Following an invitation
 * while signed in as a different account therefore joined THAT account,
 * silently — and because acceptance replaces the organization role, an owner
 * who tested their own invitation was quietly demoted to what the invitation
 * offered. It happened, to a real organization.
 *
 * That is still the thing being prevented, and the guarantee is now stronger
 * rather than louder: **an invitation is only ever accepted by the address it
 * was sent to.** The wrong session cannot take it, because by the time there is
 * anything to press, the wrong session is gone.
 *
 * So a mismatch is neither refused nor put to the reader as a question. The
 * page signs the other account out by itself and carries the link through the
 * sign-out, landing on the sign-in page for the invited address if it has an
 * account and on the password form if it does not. The alternative — a warning
 * with two buttons — was correct and nobody wanted to read it: it stops the
 * person in the middle of following a link, to explain a distinction between
 * two of their own addresses that they did not have in mind.
 *
 * What is given up, deliberately: joining as a DIFFERENT account than the one
 * invited. `acceptedByUserId` still records who accepted, so the column outlives
 * the flow, but the only way to use an invitation addressed elsewhere is now to
 * sign in as that address. A work address forwarding to a personal one needs an
 * invitation sent to the personal one.
 *
 * ## Signing out is attempted ONCE
 *
 * `?switched=1` is added to the return link, and its presence stops the page
 * doing it again. A sign-out that does not take — a cookie that will not clear,
 * an API that will not revoke — would otherwise be an infinite bounce; instead
 * the second arrival stops and offers the button by hand.
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
  alreadySwitched,
}: {
  token: string | null;
  /** The signed-in account's address, or null when nobody is signed in. */
  viewerEmail: string | null;
  /**
   * True when this page has already signed one account out for this link.
   * The only thing it does is stop it happening twice — see the header.
   */
  alreadySwitched: boolean;
}) {
  const auth = useMemo(() => createAuthClient(), []);
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const switchForm = useRef<HTMLFormElement>(null);

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

  /*
   * Where signing in — or signing out and back in — returns to. `switched=1` is
   * carried so the return trip knows an account has already been swapped for
   * this link and does not try again.
   */
  const here = `/invitations/accept?token=${encodeURIComponent(token ?? '')}`;
  const backHere = `${here}&switched=1`;

  const mismatch = preview != null && viewerEmail != null && !sameAddress(viewerEmail, preview.email);
  /** The mismatch this page resolves by itself, rather than by asking. */
  const switching = mismatch && !alreadySwitched;

  /*
   * Sign out, and land where the invited address can actually get in: the
   * sign-in page when they have an account, this page's password form when
   * they do not. Both destinations come back to the LINK, which is the part
   * that must not be lost — somebody dropped on a bare sign-in page has no way
   * back to the invitation they were following.
   *
   * A form POST rather than a navigation: signing out revokes the session
   * server-side as well as clearing the cookie, and a GET that changed state
   * would be followed by every link prefetcher in the browser.
   */
  const signOutAction = preview
    ? `/api/auth/signout?next=${encodeURIComponent(
        preview.hasAccount ? `/auth/signin?next=${encodeURIComponent(backHere)}` : backHere,
      )}`
    : null;

  useEffect(() => {
    if (!switching) return;
    // `requestSubmit`, not `submit`: it goes through the same path a real click
    // would, so nothing about this form is a special case.
    switchForm.current?.requestSubmit();
  }, [switching]);

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

  /*
   * The form the effect above submits, and the same one the fallback below
   * offers by hand. Rendered once, here, so there is a single description of
   * what signing out for this link means.
   */
  const signOutForm = (children: React.ReactNode) => (
    <form ref={switchForm} action={signOutAction ?? undefined} method="post">
      {children}
    </form>
  );

  if (switching) {
    /*
     * A screen with no choice on it, because there is nothing to decide: the
     * account in this browser is not the one invited, and the next thing that
     * happens either way is signing in as the one that is. It says whose
     * session is ending — a sign-out nobody asked for should not be silent,
     * even when it is momentary.
     */
    return (
      <AuthShell
        title={`Join ${preview.organizationName}`}
        description={`This invitation was sent to ${preview.email}. Signing ${viewerEmail} out so you can continue as ${preview.email}…`}
      >
        {signOutForm(
          <>
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            {/*
              Reachable only with JavaScript off or broken, when the effect
              never runs. It is the same POST either way.
            */}
            <noscript>
              <button
                type="submit"
                className="mt-4 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                Continue as {preview.email}
              </button>
            </noscript>
          </>,
        )}
      </AuthShell>
    );
  }

  if (mismatch) {
    /*
     * The switch was attempted and the session is still here. Whatever the
     * cause, retrying automatically would loop, so this asks — and it asks for
     * the SAME thing, because the guarantee has not changed: this invitation is
     * accepted as {preview.email} or not at all.
     */
    return (
      <AuthShell
        title={`Join ${preview.organizationName}`}
        description={`This invitation was sent to ${preview.email}.`}
      >
        <AuthError>{error}</AuthError>

        <p className="mb-4 rounded-md bg-[var(--status-warning)] px-3 py-2 text-sm text-[var(--status-warning-foreground)]">
          You are still signed in as <strong>{viewerEmail}</strong>, which is not the address this invitation was sent
          to. Signing out did not take effect — try once more.
        </p>

        {signOutForm(
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Sign out and continue as {preview.email}
          </button>,
        )}
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
