import type { ReactNode } from 'react';

/**
 * One sub-app as the Apps page receives it: the declaration's plain fields, and
 * the app ALREADY RENDERED for this workspace.
 *
 * An element rather than the component, because the page is a client component
 * handed its props by a server adapter, and a function cannot cross that
 * boundary — an element of a client component can. It is only a description:
 * nothing mounts until the page places it.
 */
export interface AppHubEntry {
  key: string;
  label: string;
  description: string | null;
  icon: string | null;
  feature: string;
  element: ReactNode;
}
