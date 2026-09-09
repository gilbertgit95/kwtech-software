'use client';

import type { ReactNode } from 'react';
import type { FeatureKey } from '../../types.js';
import { organizationHref } from '../tenant-nav.js';
import { AdminPage } from './admin-page.js';

/**
 * The frame the `/organizations/*` screens share — the TENANT's own area.
 *
 * ## Why it wraps `AdminPage` rather than replacing it
 *
 * The chrome is genuinely the same: a heading, an optional description, an
 * optional way back, one of two layouts, and a feature gate around the body.
 * Copying it would produce two frames that drift, and the drift would show up
 * as a customer screen whose denial message stopped matching the platform's.
 *
 * What it adds is the one thing every tenant screen needs and no admin screen
 * does: WHICH ORGANIZATION this is, said above the title. A customer with two
 * organizations open in two tabs has no other way to tell them apart, and the
 * page title is the workspace's or the section's, not the company's.
 *
 * ## The name
 *
 * `AdminPage` is named for the area it was written in, not for a permission
 * level — nothing in it is admin-specific. Rather than rename it across a dozen
 * call sites, this is the tenant-side name for the same frame, and the two
 * names are the useful part: a reader of a customer screen should not have to
 * work out why it is wrapped in something called Admin.
 */
export function TenantPage({
  organizationName,
  organizationId,
  title,
  description,
  feature,
  layout = 'prose',
  backTo,
  children,
}: {
  /**
   * The company's name, drawn above the title.
   *
   * Undefined while the page is still loading, which is the ordinary first
   * render — the eyebrow is simply absent rather than showing a placeholder
   * that then changes, because a line of text that appears and then rewrites
   * itself is harder to read than one that appears once.
   */
  organizationName?: string | undefined;
  /** Used only to link the eyebrow back to this organization's home. */
  organizationId?: string | undefined;
  title: string;
  description?: string | undefined;
  /**
   * Optional, meaning "a session is enough" — see `AdminPage`. Every screen in
   * this area passes one except `/organizations` and `/organizations/new`,
   * which must be reachable by somebody who belongs nowhere yet.
   */
  feature?: FeatureKey | undefined;
  layout?: 'prose' | 'fill';
  backTo?: { href: string; label: string } | undefined;
  children: ReactNode;
}) {
  return (
    <AdminPage title={title} description={description} feature={feature} layout={layout} backTo={backTo}>
      {/*
        The eyebrow renders INSIDE the frame's body rather than as part of its
        heading, which is a compromise worth naming: it means the organization
        name sits below the page title rather than above it. Threading it into
        `AdminPage` would put a tenant concept into the shared frame, and the
        frame is shared precisely because it knows nothing about either area.
      */}
      {organizationName ? (
        <p className="-mt-4 mb-6 text-sm text-muted-foreground">
          {organizationId ? (
            <a href={organizationHref(organizationId)} className="hover:text-foreground hover:underline">
              {organizationName}
            </a>
          ) : (
            organizationName
          )}
        </p>
      ) : null}
      {children}
    </AdminPage>
  );
}
