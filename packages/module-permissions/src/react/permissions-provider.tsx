'use client';

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
  return <PermissionsReactContext.Provider value={value}>{children}</PermissionsReactContext.Provider>;
}
