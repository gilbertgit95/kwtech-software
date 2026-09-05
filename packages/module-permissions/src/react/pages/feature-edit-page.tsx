'use client';

import type { ModuleRouteProps } from '@kwtech/module-kit';
import { useState } from 'react';
import {
  type DraftErrors,
  type FeatureDraft,
  hasErrors,
  specToDraft,
  validateDraft,
} from '../../domain/feature-draft.js';
import { FEATURE, FEATURE_REGISTRY } from '../../feature-keys.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';
import { FeatureForm } from './feature-form.js';
import { RegistryOutput } from './registry-output.js';

/**
 * `/admin/features/:featureId/edit`.
 *
 * The `:featureId` segment reaches this through `matchRouteWithParams` in
 * @kwtech/module-kit and the app's catch-all — Next sees one catch-all and not
 * the individual patterns, so the module does its own matching and the params
 * arrive as `ModuleRouteProps.params`.
 *
 * The key is locked. A key is the identity — `perm_role_feature` has a foreign
 * key to it and audit rows name it — so renaming one is a delete and a create,
 * not an edit, and doing it silently would revoke every grant pointing at the
 * old name.
 */
export function FeatureEditPage({ params }: ModuleRouteProps) {
  const featureId = params?.featureId ?? '';
  const spec = FEATURE_REGISTRY.find((entry) => entry.key === featureId);

  return (
    <AdminPage
      title={spec ? `Edit ${spec.label}` : 'Feature not found'}
      description={spec ? spec.key : undefined}
      feature={FEATURE.featuresUpdate}
      backTo={{ href: '/admin/features', label: 'Features' }}
    >
      {spec ? <EditForm spec={spec} /> : <NotFound featureId={featureId} />}
    </AdminPage>
  );
}

function NotFound({ featureId }: { featureId: string }) {
  return (
    <AdminPlaceholder>
      {/* The link that used to be here is now the heading's Back link — one way
          out, in the place every sub page puts it. */}
      No feature with the key <code className="font-mono">{featureId || '(none given)'}</code> is in the registry.
    </AdminPlaceholder>
  );
}

function EditForm({ spec }: { spec: (typeof FEATURE_REGISTRY)[number] }) {
  const [draft, setDraft] = useState<FeatureDraft>(() => specToDraft(spec));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [accepted, setAccepted] = useState<FeatureDraft | null>(null);

  /*
   * Compared field by field rather than by identity, so the button is only live
   * when something actually differs — a form that offers to save an unchanged
   * record invites a no-op commit to the registry.
   */
  const original = specToDraft(spec);
  const changed = (Object.keys(original) as (keyof FeatureDraft)[]).some((field) => draft[field] !== original[field]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validateDraft(draft, {
      existingKeys: FEATURE_REGISTRY.map((entry) => entry.key),
      // Its own key is not a collision with itself.
      originalKey: spec.key,
    });
    setErrors(found);
    setAccepted(hasErrors(found) ? null : draft);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <FeatureForm draft={draft} errors={errors} onChange={setDraft} lockKey />

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!changed}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            Validate changes
          </button>
          <a
            href="/admin/features"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Cancel
          </a>
          {!changed ? <span className="text-xs text-muted-foreground">Nothing changed yet.</span> : null}
        </div>
      </form>

      {accepted ? <RegistryOutput drafts={[accepted]} heading="Replace the existing entry with this" /> : null}
    </div>
  );
}
