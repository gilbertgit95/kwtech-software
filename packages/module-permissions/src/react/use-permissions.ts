'use client';

import { useContext } from 'react';
import { canAccessWorkspace, checkFeature, hasAllFeatures, hasAnyFeature, hasFeature } from '../check.js';
import type { FeatureDecision, FeatureKey, PermissionContext } from '../types.js';
import { PermissionsReactContext } from './permissions-provider.js';

/**
 * Undefined means "not signed in, or no membership in the active organization",
 * which callers must handle. It deliberately does not throw: a signed-out render
 * is a normal state, not a bug.
 */
export function usePermissions(): PermissionContext | undefined {
  return useContext(PermissionsReactContext);
}

/** Absent context denies — every check below fails closed. */
export function useHasFeature(feature: FeatureKey): boolean {
  return hasFeature(usePermissions(), feature);
}

export function useHasAllFeatures(features: readonly FeatureKey[]): boolean {
  return hasAllFeatures(usePermissions(), features);
}

export function useHasAnyFeature(features: readonly FeatureKey[]): boolean {
  return hasAnyFeature(usePermissions(), features);
}

/**
 * The decision with its reason, for anything that has to explain itself.
 * 'not_entitled' should read as "upgrade your plan", 'not_granted' as "ask your
 * administrator" — sending the first user to an administrator is a dead end.
 */
export function useFeatureDecision(feature: FeatureKey): FeatureDecision {
  return checkFeature(usePermissions(), feature);
}

/** Whether the caller may enter a workspace — asked before any feature question. */
export function useCanAccessWorkspace(workspaceId: string): boolean {
  return canAccessWorkspace(usePermissions(), workspaceId);
}
