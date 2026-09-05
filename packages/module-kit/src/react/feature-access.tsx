'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

/**
 * Which feature keys the viewer holds, readable by ANY module.
 *
 * ## Why this is here and not in the enforcing module
 *
 * `module-permissions` already ships `FeatureGate` and `usePermissions`, and
 * they are the right tools — for module-permissions. Every other module is
 * forbidden from importing it (PLAN section 9), so a module wanting to hide its
 * own control had no way to ask the question: `module-auth` could declare a key
 * and gate a ROUTE through the descriptor, but could not gate a button inside
 * its own page.
 *
 * So the same split the whole design already uses: the CONTRACT lives here,
 * where everyone may depend on it, and the answer is supplied by whoever
 * resolves permissions. `PermissionsProvider` mounts this internally, so an app
 * that already renders it gets this for free and there is exactly one source of
 * the list.
 *
 * ## Not a security boundary
 *
 * Hiding a control hides an affordance, not an endpoint. Every request is
 * authorised again at the API — which for these keys happens through the
 * registry's own bindings, so the button and the mutation cannot disagree.
 */

/**
 * Defaults to an empty list, so a module rendered in an app with no permission
 * model at all sees "holds nothing" rather than crashing.
 *
 * That direction is deliberate: a missing provider hides controls, it does not
 * reveal them. The visible failure is a button nobody can find, which someone
 * reports; the invisible one would be a control everyone can press.
 */
const FeatureAccessContext = createContext<readonly string[]>([]);

export function FeatureAccessProvider({ value, children }: { value: readonly string[]; children: ReactNode }) {
  /*
   * Memoised on the CONTENTS, not the array identity. The list is rebuilt on
   * every render of whatever resolves it, and a new array each time would
   * re-render every consumer for a value that has not changed.
   */
  const digest = value.join(' ');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `digest` is the value's content signature; depending on `value` itself would defeat the memo, which is the entire point.
  const held = useMemo(() => value, [digest]);

  return <FeatureAccessContext.Provider value={held}>{children}</FeatureAccessContext.Provider>;
}

/** Every key the viewer holds. Prefer the predicates below — they say what you mean. */
export function useHeldFeatures(): readonly string[] {
  return useContext(FeatureAccessContext);
}

/** Whether the viewer holds one key. */
export function useHoldsFeature(feature: string): boolean {
  return useContext(FeatureAccessContext).includes(feature);
}

/**
 * Whether the viewer holds EVERY key given.
 *
 * An empty list returns false, not true. A gate with no keys reads as guarded
 * in review while guarding nothing — the same choice `FeatureGate` makes, and
 * for the same reason.
 */
export function useHoldsAllFeatures(features: readonly string[]): boolean {
  const held = useContext(FeatureAccessContext);
  if (features.length === 0) return false;
  return features.every((feature) => held.includes(feature));
}
