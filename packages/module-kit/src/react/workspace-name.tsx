'use client';

import { createContext, type ReactNode, useContext } from 'react';

/**
 * The name of the workspace a page is inside, handed down by the app's shell
 * (which already loads the workspace), so a module never asks permissions for
 * it (PLAN §9). What a receipt is headed with (#144, R5): the shop's name.
 */
const WorkspaceNameContext = createContext<string | null>(null);

export interface WorkspaceNameProviderProps {
  /** The workspace's name, or null outside a workspace. */
  name: string | null;
  children: ReactNode;
}

export function WorkspaceNameProvider({ name, children }: WorkspaceNameProviderProps) {
  return <WorkspaceNameContext.Provider value={name}>{children}</WorkspaceNameContext.Provider>;
}

/**
 * The current workspace's name, or null: outside a provider (a test, a host
 * that has not adopted it) a page shows no name rather than a guessed one.
 */
export function useWorkspaceName(): string | null {
  return useContext(WorkspaceNameContext);
}
