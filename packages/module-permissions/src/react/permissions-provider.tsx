'use client';

import { FeatureAccessProvider } from '@kwtech/module-kit/react';

import { createContext, type ReactNode } from 'react';
import type { PermissionContext } from '../types.js';

export const PermissionsReactContext = createContext<PermissionContext | undefined>(undefined);

export interface PermissionsProviderProps {
  /** Resolved server-side and passed down, so the first paint is already correct. */
  value: PermissionContext | undefined;
  children: ReactNode;
}

/**
 * Mount once, high in the tree, with grants fetched on the server.
 *
 * Everything below decides only what to SHOW. The API is the authority — a
 * hidden button and an unguarded endpoint is still an unguarded endpoint.
 */
export function PermissionsProvider({ value, children }: PermissionsProviderProps) {
  return (
    <PermissionsReactContext.Provider value={value}>
      {/*
        Also published through @kwtech/module-kit, so any OTHER module can gate
        its own controls without importing this one — which PLAN section 9
        forbids. `module-auth` needs exactly that to hide a button on its own
        settings page.

        Mounted here rather than beside this provider in the app, so there is
        one source of the list and no way for the two to disagree. `effective`,
        not `granted`: what the viewer can actually use after plan entitlement,
        which is what a control should reflect.
      */}
      <FeatureAccessProvider value={value?.effective ?? []}>{children}</FeatureAccessProvider>
    </PermissionsReactContext.Provider>
  );
}
