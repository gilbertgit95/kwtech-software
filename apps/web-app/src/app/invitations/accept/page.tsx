import { AcceptInvitation } from '@/components/invitations/accept-invitation';
import { BareShell } from '@/components/layout/bare-shell';
import { getSessionSnapshot } from '@/lib/session-query';

/**
 * A real route file rather than a module descriptor, because this page belongs
 * to the APP: it composes module-auth and module-permissions, and the catch-all
 * at `(modules)/[...slug]` serves only what a module declares.
 *
 * `BareShell`, like the sign-in pages: whoever follows an invitation may have
 * no account at all, and the app shell is a navigation and an account menu for
 * somebody who does.
 *
 * The session is read HERE, on the server, because the cookie is httpOnly and
 * no client component can see it. It decides which of the three ways in the
 * page offers — see AcceptInvitation.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.token;
  // A repeated ?token=a&token=b is a malformed link, not a choice to make —
  // the same rule the password-reset route applies.
  const token = typeof raw === 'string' && raw.length > 0 ? raw : null;

  /*
   * Set by the automatic account switch on its way back here, and read for one
   * reason: to make sure it happens at most once. If the sign-out did not take
   * — a cookie that would not clear, a session the API would not revoke — a
   * page that switches whenever it sees a mismatch would switch, land, see the
   * same mismatch and switch again, forever. With this, the second arrival
   * stops and asks.
   */
  const switched = params.switched === '1';

  const { viewer } = await getSessionSnapshot();

  return (
    <BareShell>
      {/*
        The viewer's ADDRESS, not merely whether there is one. The page has to
        be able to notice that the person signed in is not the person invited —
        see AcceptInvitation, and the bug that made it necessary. It now signs
        that session out by itself rather than asking about it.
      */}
      <AcceptInvitation token={token} viewerEmail={viewer?.email ?? null} alreadySwitched={switched} />
    </BareShell>
  );
}
