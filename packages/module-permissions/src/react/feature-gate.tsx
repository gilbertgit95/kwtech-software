'use client';

import type { ReactNode } from 'react';
import type { FeatureKey } from '../types.js';
import { denialReason } from '../check.js';
import type { DenialReason } from '../types.js';
import { usePermissions, useHasAllFeatures, useHasAnyFeature } from './use-permissions.js';

export interface FeatureGateProps {
  /** Every key required. Mutually exclusive with anyOf. */
  allOf?: readonly FeatureKey[];
  /** At least one key required. */
  anyOf?: readonly FeatureKey[];
  /** Rendered when the check fails. Defaults to nothing — the control vanishes. */
  fallback?: ReactNode;
  /**
   * Takes precedence over `fallback` when present. Use it wherever the user
   * deserves an explanation: 'not_entitled' means the organization has not
   * bought this and an upgrade prompt is the right answer, while 'not_granted'
   * means asking an administrator is.
   */
  renderDenied?: (reason: DenialReason | undefined) => ReactNode;
  children: ReactNode;
}

/**
 * Wraps a privileged control:
 *
 *   <FeatureGate allOf={[FEATURE.usersWrite]}><DisableUserButton /></FeatureGate>
 *
 * Use the same keys in the navigation filter, so a user is never shown a link
 * to a page that will turn them away.
 *
 * Not wrapping a control is how it stays public — enforcement is opt-in, and
 * most of the UI is not access-controlled. Wrapping one in a gate that declares
 * NO keys is different: that is a mistake, and it renders the fallback rather
 * than the children, because an empty gate that renders looks guarded in review
 * while guarding nothing.
 */
export function FeatureGate({ allOf, anyOf, fallback = null, renderDenied, children }: FeatureGateProps) {
  const ctx = usePermissions();
  const passesAll = useHasAllFeatures(allOf ?? []);
  const passesAny = useHasAnyFeature(anyOf ?? []);

  const denied = (reason: DenialReason | undefined) => <>{renderDenied ? renderDenied(reason) : fallback}</>;

  // No keys declared is treated as a mistake, not as "allow": an empty gate
  // that renders its children looks guarded in review while guarding nothing.
  if (!allOf?.length && !anyOf?.length) return denied(undefined);

  const allowed = (allOf?.length ? passesAll : true) && (anyOf?.length ? passesAny : true);
  if (allowed) return <>{children}</>;

  return denied(denialReason(ctx, [...(allOf ?? []), ...(anyOf ?? [])]));
}
