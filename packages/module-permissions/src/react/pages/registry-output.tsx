'use client';

import { useState } from 'react';
import { draftsToRegistrySource, type FeatureDraft } from '../../domain/feature-draft.js';

/**
 * What a write screen produces: the source to paste into `feature-keys.ts`.
 *
 * ## Why this and not a mutation
 *
 * `syncFeatureRegistry` deprecates every `perm_feature` row that is not in
 * `FEATURE_REGISTRY`, and `assertRegistered` refuses an unregistered key. A
 * feature written straight to the table would therefore be switched off by the
 * next `pnpm db:sync` and could not be granted to anyone in the meantime — it
 * would look saved and be inert, which is worse than a screen that says what it
 * does.
 *
 * So the screens validate and compose, and this is the artefact that makes a
 * feature real. Reversing that — making the DATABASE the source and the
 * registry a cache — is a live decision, not an oversight; see docs/PLAN.md §13.
 */
export function RegistryOutput({ drafts, heading }: { drafts: readonly FeatureDraft[]; heading: string }) {
  const [copied, setCopied] = useState(false);
  const source = draftsToRegistrySource(drafts);

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      // Long enough to read, short enough that the button is ready again before
      // anyone wants it.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Denied permission, or an insecure origin. The textarea below is still
      // selectable, so there is nothing to recover from and nothing to say.
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-card-foreground">{heading}</h2>
        <button
          type="button"
          onClick={copy}
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Add to <code className="font-mono">FEATURE_REGISTRY</code> in{' '}
        <code className="font-mono">packages/module-permissions/src/feature-keys.ts</code>, then run{' '}
        <code className="font-mono">pnpm db:sync</code>.
      </p>
      {/*
        A readOnly textarea rather than a <pre>: it is selectable with one
        keystroke, scrolls on its own, and works when the clipboard API is
        unavailable — which is every insecure origin, including plenty of
        staging setups.
      */}
      <textarea
        readOnly
        value={source}
        rows={Math.min(4 + drafts.length * 8, 24)}
        className="mt-3 w-full rounded-md border border-input bg-muted/40 p-3 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </section>
  );
}
