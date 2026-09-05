'use client';

import { useState } from 'react';
import {
  type DraftErrors,
  EMPTY_DRAFT,
  type FeatureDraft,
  hasErrors,
  validateDraft,
} from '../../domain/feature-draft.js';
import { FEATURE, FEATURE_REGISTRY } from '../../feature-keys.js';
import { AdminPage } from './admin-page.js';
import { FeatureForm } from './feature-form.js';
import { RegistryOutput } from './registry-output.js';

/**
 * `/admin/features/new/manual` — define a feature by typing it.
 *
 * Validation is `validateDraft`, the same function the spreadsheet import uses,
 * so the two screens cannot disagree about what a valid feature is.
 */
export function FeatureNewPage() {
  const [draft, setDraft] = useState<FeatureDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [accepted, setAccepted] = useState<FeatureDraft | null>(null);

  const existingKeys = FEATURE_REGISTRY.map((spec) => spec.key);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validateDraft(draft, { existingKeys });
    setErrors(found);
    /*
     * Only cleared on a VALID submit. Leaving the previous output up while
     * someone fixes an error would show source that no longer matches the form
     * they are looking at.
     */
    setAccepted(hasErrors(found) ? null : draft);
  }

  return (
    <AdminPage
      title="New feature"
      description="Define a grantable right. Validated here; added to the registry in code, which is what makes it real."
      feature={FEATURE.featuresCreate}
      backTo={{ href: '/admin/features', label: 'Features' }}
    >
      <div className="flex max-w-2xl flex-col gap-6">
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          {/*
            `noValidate` because the browser's own bubbles would fire before
            `validateDraft` runs and report a different set of rules — one of
            which does not know a key must be unique.
          */}
          <FeatureForm draft={draft} errors={errors} onChange={setDraft} />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Validate
            </button>
            <a
              href="/admin/features"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              Cancel
            </a>
          </div>
        </form>

        {accepted ? <RegistryOutput drafts={[accepted]} heading="Add this to the registry" /> : null}
      </div>
    </AdminPage>
  );
}
