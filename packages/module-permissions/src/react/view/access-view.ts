import type { AccessLine, AccessVerdict } from '../../domain/access-explanation.js';
import { scopePath } from '../../scope.js';

/** Which lines the Access page shows (#173). */
export type AccessFilter = 'all' | 'yes' | 'no';

export interface AccessGroup {
  module: string;
  lines: readonly AccessLine[];
}

/** Whether a verdict reads as "yes" on the page. Only a grant does: a role that the plan filters is still a no. */
export function isYes(verdict: AccessVerdict): boolean {
  return verdict === 'granted';
}

/**
 * The lines the filter keeps, grouped by module in the order they arrive
 * (`explainAccess` sorts by module, then label). A module with nothing left
 * after the filter is dropped rather than shown as an empty heading.
 */
export function groupAccessLines(lines: readonly AccessLine[], filter: AccessFilter): AccessGroup[] {
  const kept = lines.filter((line) => filter === 'all' || (filter === 'yes') === isYes(line.verdict));
  const groups: { module: string; lines: AccessLine[] }[] = [];
  for (const line of kept) {
    const last = groups.at(-1);
    if (last && last.module === line.module) last.lines.push(line);
    else groups.push({ module: line.module, lines: [line] });
  }
  return groups;
}

/** "12 of 40 allowed", for the page's summary line. */
export function accessSummary(lines: readonly AccessLine[]): string {
  const yes = lines.filter((line) => isYes(line.verdict)).length;
  return `${yes} of ${lines.length} allowed`;
}

/** Where a member's Access page is: inside the workspace when one is named, else the organization's. */
export function memberAccessHref(organizationId: string, userId: string, workspaceId?: string | null): string {
  return scopePath(
    { organizationId, workspaceId: workspaceId ?? null },
    `members/${encodeURIComponent(userId)}/access`,
  );
}

/** A module key as a heading: "app_hub" → "App hub", "basic-pos" → "Basic pos". */
export function moduleHeading(module: string): string {
  const words = module.replace(/[-_:]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
