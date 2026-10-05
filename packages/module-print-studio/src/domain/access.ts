import type { StudioLayoutFacts, StudioRefusal, StudioVisibility } from '../types.js';

/**
 * Who may do what to a layout (PRINT-STUDIO-PLAN decisions 3, 15 and 16).
 *
 * These decide over ONE LAYOUT AND ONE PERSON. Whether the person holds
 * `studio:read` or `studio:write` in the workspace is the guard's question,
 * asked before any of this runs; these answer what that key allows on THIS
 * layout.
 *
 * ⚠ ORDER MATTERS IN EVERY CHECK: visibility first. A refusal that is anything
 * but `not_found` tells the caller the layout exists, so no other reason may be
 * given for a layout they cannot see.
 */

export const STUDIO_VISIBILITIES = ['private', 'workspace'] as const satisfies readonly StudioVisibility[];

/** A visibility as it arrives over the wire — a string — narrowed. */
export function isStudioVisibility(value: unknown): value is StudioVisibility {
  return (STUDIO_VISIBILITIES as readonly unknown[]).includes(value);
}

/**
 * Whether this person may see — and so use, and duplicate — the layout.
 *
 * ⚠ NO OVERRIDE. Not `studio:manage_all`, not a super admin: a private layout
 * is its owner's alone (decision 16), so this takes no key and no role.
 */
export function canSeeLayout(layout: StudioLayoutFacts, userId: string): boolean {
  if (layout.ownerId === userId) return true;
  return layout.visibility === 'workspace';
}

/**
 * Whether this person may change or delete the layout — or whether it depends
 * on `studio:manage_all`, which only the host can answer.
 *
 * A PLAN, not a boolean, because the answer may need a port: the service asks
 * `StudioAccessCheck` only on `needs_manage_all`, which keeps a permission
 * load off the common case of somebody editing their own layout.
 *
 * ⚠ ONLY THE OWNER EDITS A SHARED LAYOUT (decision 15). Unlike a shared note,
 * which any writer may edit: a changed layout silently changes everybody's
 * next print, and nobody notices until the photos are cut. Others duplicate it.
 *
 * ⚠ `needs_manage_all` ONLY FOR A SHARED LAYOUT. Somebody else's private one
 * is `not_found` before the key is ever consulted.
 */
export type StudioLayoutPlan =
  | { kind: 'allowed' }
  | { kind: 'needs_manage_all' }
  | { kind: 'refused'; reason: StudioRefusal };

export function planChangeLayout(layout: StudioLayoutFacts, userId: string): StudioLayoutPlan {
  if (!canSeeLayout(layout, userId)) return { kind: 'refused', reason: 'not_found' };
  if (layout.ownerId === userId) return { kind: 'allowed' };
  return { kind: 'needs_manage_all' };
}

/**
 * Sharing and unsharing: the OWNER's alone, `manage_all` or not.
 *
 * ⚠ Unsharing takes a layout away from everybody using it, and sharing
 * publishes something its maker kept to themselves. Neither is an admin's
 * call to make about somebody else's work — an admin who wants a shared
 * layout gone deletes it, which is what `manage_all` is for.
 */
export function checkShareLayout(layout: StudioLayoutFacts, userId: string): StudioRefusal | null {
  if (!canSeeLayout(layout, userId)) return 'not_found';
  if (layout.ownerId !== userId) return 'not_owner';
  return null;
}
