'use client';

import { FEATURE } from '../../feature-keys.js';
import { useHasFeature, usePermissions } from '../use-permissions.js';
import { memberAccessHref } from '../view/access-view.js';

/**
 * The way into a member's Access page (#173): on your own row always, and on
 * everyone's for whoever can change their role here — the key the API asks
 * for (`explainAccess`). Hidden otherwise rather than offered and refused.
 */
export function MemberAccessLink({
  organizationId,
  workspaceId,
  userId,
}: {
  organizationId: string;
  workspaceId?: string | null;
  userId: string;
}) {
  const context = usePermissions();
  const self = context?.subjectId === userId;
  const canSeeOthers = useHasFeature(workspaceId ? FEATURE.workspaceAssignRole : FEATURE.membersAssignRole);
  if (!self && !canSeeOthers) return null;
  return (
    <a
      href={memberAccessHref(organizationId, userId, workspaceId)}
      className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {self ? 'Your access' : 'Access'}
    </a>
  );
}
