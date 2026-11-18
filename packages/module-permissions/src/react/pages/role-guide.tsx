'use client';

import type { RoleView } from '../permissions-client.js';

/**
 * What each role is for, as visible text beside a list of members (#99).
 *
 * ⚠ WHY A LIST, AND NOT THE DROPDOWN'S TOOLTIPS ALONE
 *
 * The member role selects ASSIGN on change: there is no moment between
 * choosing a role and giving it in which to read what it is. A `title` on each
 * option is only reachable by hovering a mouse, so keyboard and touch users
 * would choose by name alone. This is the same lines, readable before
 * anything is changed, and a `<details>` so it costs one line when closed.
 *
 * Nothing when no role has a description: a heading over an empty list reads
 * as a fault.
 */
export function RoleGuide({ roles }: { roles: readonly RoleView[] }) {
  const described = roles.filter((role) => role.description);
  if (described.length === 0) return null;
  return (
    <details className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        What each role is for
      </summary>
      <dl className="mt-2 flex flex-col gap-2">
        {described.map((role) => (
          <div key={role.id}>
            <dt className="font-medium">{role.label}</dt>
            <dd className="text-muted-foreground">{role.description}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
