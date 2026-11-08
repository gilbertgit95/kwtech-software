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
  subscription_expired:
    "Your organization's plan has ended, so this is paused. Its data is kept; renewing on the Billing page brings it back.",
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
  /**
   * What the reader can do about it, under the sentence: a link when there is
   * somewhere to go (for `subscription_expired`, the organization's Billing
   * page, which the app knows and this module does not), or a plain line when
   * the next step is somebody else's ("Ask the organization's owner…").
   * Absent: the sentence alone.
   */
  nextStep?: { label: string; href?: string | undefined } | undefined;
  /**
   * A sentence under the reason that only the app can write (#101): for
   * `not_entitled`, which plans include this ("Point of sale is in Basic and
   * Pro. You are on Free."), worked out from the plans the app knows.
   */
  detail?: string | undefined;
}

/** A refused page: its title, the reason in words, and where to act on it when the caller knows. */
export function FeatureDenied({ title, reason, header, nextStep, detail }: FeatureDeniedProps) {
  return (
    <div className="mx-auto w-full max-w-4xl">
      {header}
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{denialMessage(reason)}</p>
      {detail ? <p className="mt-1 text-sm text-foreground">{detail}</p> : null}
      {nextStep?.href ? (
        <a
          href={nextStep.href}
          className="mt-3 inline-block text-sm font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {nextStep.label}
        </a>
      ) : nextStep ? (
        <p className="mt-3 text-sm text-foreground">{nextStep.label}</p>
      ) : null}
    </div>
  );
}
