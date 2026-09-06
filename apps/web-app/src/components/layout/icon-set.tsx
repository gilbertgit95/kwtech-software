'use client';

import { IconSetProvider } from '@kwtech/web-ui/react';
import type { ReactNode } from 'react';
import { ICONS } from '@/components/layout/nav-icons';

/**
 * Publishes this app's icon set to everything below it.
 *
 * ## Why this wrapper exists at all
 *
 * `ICONS` maps names to React COMPONENTS, and components are functions. A
 * server component cannot hand a function to a client component — everything
 * crossing that boundary is serialised, and React refuses with "Functions
 * cannot be passed directly to Client Components".
 *
 * `AppShell` is a server component, so it cannot pass `ICONS` to
 * `IconSetProvider` itself. Importing the map HERE, inside a client component,
 * keeps both ends on the same side of the boundary: nothing is passed across,
 * because the client bundle resolves the icons itself.
 *
 * The shell renders `<AppIconSet>` with children, which is a perfectly ordinary
 * server-renders-client composition — children are elements, not functions.
 */
export function AppIconSet({ children }: { children: ReactNode }) {
  return <IconSetProvider icons={ICONS}>{children}</IconSetProvider>;
}
