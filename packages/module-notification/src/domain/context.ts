import type { NotificationContext } from '../types.js';

/**
 * `NotificationContext` ↔ the two nullable columns, in ONE place each way.
 *
 * The columns can hold a fourth shape — a workspace with no organization — and
 * this file is what keeps it from being written or drawn.
 */

export const NOTIFICATION_CONTEXT_LABEL_MAX = 160;

export interface ContextColumns {
  organizationId: string | null;
  workspaceId: string | null;
  contextLabel: string | null;
}

/**
 * The columns for a context, or a sentence saying why it cannot be stored.
 * Omitted means global.
 */
export function prepareContext(context: NotificationContext | undefined): ContextColumns | { refused: string } {
  if (!context || context.scope === 'global') return { organizationId: null, workspaceId: null, contextLabel: null };

  const label = context.label?.trim() ?? '';
  if (label.length > NOTIFICATION_CONTEXT_LABEL_MAX) {
    return { refused: `A context label can be at most ${NOTIFICATION_CONTEXT_LABEL_MAX} characters.` };
  }
  if (!context.organizationId) return { refused: 'An organization context needs its organization.' };

  switch (context.scope) {
    case 'organization':
      return { organizationId: context.organizationId, workspaceId: null, contextLabel: label || null };
    case 'workspace':
      if (!context.workspaceId) return { refused: 'A workspace context needs its workspace.' };
      return { organizationId: context.organizationId, workspaceId: context.workspaceId, contextLabel: label || null };
  }
}

/**
 * The context a row describes, or null when the row holds the one shape that
 * is not allowed — a workspace with no organization. The caller drops that row
 * and logs it rather than drawing it as something it is not.
 */
export function readContext(row: Pick<ContextColumns, 'organizationId' | 'workspaceId'>): NotificationContext | null {
  if (row.workspaceId && !row.organizationId) return null;
  if (!row.organizationId) return { scope: 'global' };
  if (!row.workspaceId) return { scope: 'organization', organizationId: row.organizationId };
  return { scope: 'workspace', organizationId: row.organizationId, workspaceId: row.workspaceId };
}
