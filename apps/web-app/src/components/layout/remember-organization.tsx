'use client';

import { useEffect } from 'react';
import { writeActiveOrganizationCookie, writeActiveWorkspaceCookie } from '@/components/layout/active-organization';

/**
 * Records which organization the reader is in. Renders nothing.
 *
 * ## Why a component and not an onClick on the switcher
 *
 * The switcher is not the only way in. The `/organizations` picker links into a
 * tenant, so does every "back to Acme Corp" link on a tenant screen, so does a
 * bookmark, so does the redirect after creating one. Hanging the write off one
 * control would mean the drawer remembered a selection made THERE and forgot
 * one made anywhere else — which reads as the switcher being unreliable rather
 * than as five call sites missing a line.
 *
 * Driven by the URL instead: whatever organization the page is for is the one
 * that gets remembered, by whatever route the reader arrived.
 *
 * ## Only the viewer's OWN organizations
 *
 * The shell passes nothing when the URL names a tenant the viewer is not a
 * member of — which platform staff legitimately open. Remembering one would put
 * a company they have no membership in at the top of their drawer until they
 * next visited another, and every link under it would 403.
 *
 * ## Why the same pattern as ConnectivityMonitor and SessionKeeper
 *
 * All three render nothing and exist for an effect. It is the app's established
 * shape for "something has to happen in the browser on every render of the
 * shell", and a `useEffect` in the shell itself is not available: the shell is a
 * Server Component.
 */
export function RememberOrganization({
  organizationId,
  workspaceId,
}: {
  organizationId: string | null;
  /**
   * The workspace the URL names, already validated as one the viewer may enter
   * in the selected organization. Null everywhere else.
   */
  workspaceId?: string | null;
}) {
  useEffect(() => {
    // Null on every page outside a tenant. The cookie is deliberately NOT
    // cleared there: leaving an organization's pages is not deselecting it, and
    // the whole point of remembering is that the section survives a trip to the
    // dashboard. It is replaced when another is opened.
    if (organizationId) writeActiveOrganizationCookie(organizationId);
  }, [organizationId]);

  useEffect(() => {
    /*
     * Not cleared when absent either, and it does not need to be: the workspace
     * cookie is validated against the SELECTED organization's accessible
     * workspaces, so switching organization drops the selection wherever the
     * old value happens to still be sitting. Clearing it here as well would be
     * a second mechanism for one rule.
     */
    if (workspaceId) writeActiveWorkspaceCookie(workspaceId);
  }, [workspaceId]);

  return null;
}
