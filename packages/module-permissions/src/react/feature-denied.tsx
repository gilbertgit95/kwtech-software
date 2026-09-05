'use client';

import type { ReactNode } from 'react';
import type { DenialReason } from '../types.js';

/**
 * What a refused surface says, in one place.
 *
 * There were two of these — `AdminDenied` inside `AdminPage`, and `RouteDenied`
 * in the app's catch-all — with the same four sentences copied between them.
 * Both are reached by the same person for the same reason, so a wording change
 * to one was a silent inconsistency in the other, and the copy in the app was
 * the one nobody would think to update.
 *
 * ## Why the reason matters
 *
 * The module already separates these — see `denialReason` in check.ts — and a
 * flat "you do not have access" throws the distinction away at the one moment
 * it decides what someone does next. "Upgrade your plan" and "ask an
 * administrator" are different errands, and sending someone on the wrong one
 * wastes a support ticket.
 */
const EXPLANATION: Record<DenialReason, string> = {
  not_entitled: 'Your plan does not include this. Upgrading adds it.',
  not_granted: 'Your roles do not include this. An administrator can grant it.',
  no_workspace_access: 'You do not have access to this workspace.',
  no_context: 'We could not determine your permissions. Try signing in again.',
};

/**
 * The sentence alone, for a caller that owns its own layout.
 *
 * Exported separately because the app's catch-all and this module's page shell
 * differ in what surrounds the message — a heading, a back link — but must
 * never differ in the message itself.
 */
export function denialMessage(reason: DenialReason | undefined): string {
  // Undefined when the gate itself was misconfigured — no keys declared — which
  // is a wiring bug rather than a permission the reader is missing.
  return reason ? EXPLANATION[reason] : 'You do not have access to this page.';
}

export interface FeatureDeniedProps {
  title: string;
  reason: DenialReason | undefined;
  /** Rendered above the title — a back link, usually. */
  header?: ReactNode;
}

export function FeatureDenied({ title, reason, header }: FeatureDeniedProps) {
  return (
    <div className="mx-auto w-full max-w-4xl">
      {header}
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{denialMessage(reason)}</p>
    </div>
  );
}
