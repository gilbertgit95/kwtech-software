'use client';

import { createContext, type ReactNode, useContext } from 'react';

/**
 * The time zone of the workspace a page is inside (`perm_workspace.timeZone`),
 * handed down by the app's shell — which already loads the workspace — so a
 * module never asks permissions for it (PLAN §9).
 *
 * Everything a workspace app decides by the DAY — a task due today, the queue's
 * today, a sale's day — and every time it prints, follows this zone, so two
 * people in different places see the same "today" for the same workspace.
 */
const WorkspaceTimeZoneContext = createContext<string | null>(null);

export interface WorkspaceTimeZoneProviderProps {
  /** The workspace's IANA zone, or null outside a workspace. */
  timeZone: string | null;
  children: ReactNode;
}

export function WorkspaceTimeZoneProvider({ timeZone, children }: WorkspaceTimeZoneProviderProps) {
  return <WorkspaceTimeZoneContext.Provider value={timeZone}>{children}</WorkspaceTimeZoneContext.Provider>;
}

/**
 * The current workspace's zone.
 *
 * ⚠ OUTSIDE A PROVIDER (a test, a host that has not adopted it) IT IS THE
 * BROWSER'S OWN ZONE: showing a time in the viewer's zone is honest, where
 * guessing a workspace's would be a wrong answer stated confidently.
 */
export function useWorkspaceTimeZone(): string {
  return useContext(WorkspaceTimeZoneContext) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
