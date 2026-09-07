'use client';

import type { FoundUser } from '../permissions-client.js';

/**
 * Rendering a `userId` as a person.
 *
 * Shared by the organization and workspace screens rather than defined twice.
 * Both show membership rows, both hold only ids — the permissions module does
 * not own identity — and two copies of the fallback chain would eventually
 * disagree about what to show when there is no account behind an id.
 */

/**
 * The shortest thing that identifies somebody, for a sentence.
 *
 * Shared with `Person` so a confirmation dialog and the row it was opened from
 * cannot disagree about who is being acted on.
 */
export function personLabel(user: FoundUser | undefined, userId: string): string {
  return user?.displayName ?? user?.username ?? user?.email ?? userId;
}

/**
 * A member, as a person rather than an id.
 *
 * Falls back through what is actually there: display name, then username, then
 * email, then the raw id. The last is not a failure state to hide — a
 * membership can outlive the account it names, because `perm_membership.userId`
 * has no foreign key to `auth_user` by design, so an id with nobody behind it
 * is a real thing to be able to see and remove.
 *
 * The email is shown UNDERNEATH rather than instead: two people called "Alex"
 * is the ordinary case in any company, and a members list where you cannot tell
 * them apart is a members list you cannot safely remove anybody from.
 */
export function Person({ user, userId }: { user: FoundUser | undefined; userId: string }) {
  if (!user) {
    return (
      <span title="No account found for this id — it may have been deleted.">
        <code className="text-xs text-muted-foreground">{userId}</code>
      </span>
    );
  }

  const name = user.displayName ?? user.username;
  return (
    <span className="block">
      {name ? (
        <>
          <span className="block">{name}</span>
          <span className="block text-xs text-muted-foreground">{user.email}</span>
        </>
      ) : (
        <span className="block">{user.email}</span>
      )}
    </span>
  );
}
