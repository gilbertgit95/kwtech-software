'use client';

import { useEffect, useMemo, useState } from 'react';
import type { OrganizationDetailView } from '../permissions-client.js';
import { organizationSectionHref } from '../tenant-nav.js';
import { gettingStartedSteps, isGettingStartedDone } from '../view/getting-started.js';

/**
 * "Getting started" on the organization's overview (#133 P0a): the three
 * steps after first setup, each linking to the page that does it and ticked
 * off by what is already true. The rules are `view/getting-started.ts`.
 *
 * Shown only while a step is open, and only to someone who can act on it (the
 * caller gates it on inviting or creating workspaces). "Hide" is remembered
 * in this browser only: a per-viewer convenience, so browser storage, and a
 * failed read simply shows it again.
 */
export function OrganizationGettingStarted({ detail }: { detail: OrganizationDetailView }) {
  const steps = useMemo(() => gettingStartedSteps(detail), [detail]);
  const storageKey = `kwtech:getting-started-hidden:${detail.id}`;
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(storageKey) === '1');
    } catch {
      setHidden(false);
    }
  }, [storageKey]);

  if (hidden || isGettingStartedDone(steps)) return null;

  const hide = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(storageKey, '1');
    } catch {
      // Not remembered, then: it shows again next time, which is harmless.
    }
  };

  return (
    <section aria-labelledby="getting-started" className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="getting-started" className="font-medium">
            Getting started
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            What is left to set up, in order. Each step opens the page that does it.
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          className="text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Hide
        </button>
      </div>
      <ol className="mt-4 flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.key} className="flex gap-3">
            <span
              aria-hidden="true"
              className={
                step.done
                  ? 'flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground'
                  : 'flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted-foreground'
              }
            >
              {step.done ? '✓' : index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {step.title}
                <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
              </p>
              <p className="text-sm text-muted-foreground">{step.detail}</p>
              {step.done ? null : (
                <a
                  href={organizationSectionHref(detail.id, step.section)}
                  className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {step.action}
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
