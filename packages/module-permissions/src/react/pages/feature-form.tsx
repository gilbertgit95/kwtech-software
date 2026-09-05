'use client';

import type { DraftErrors, FeatureDraft } from '../../domain/feature-draft.js';
import { ROLE_LEVELS } from '../../types.js';

/**
 * The fields shared by "new" and "edit".
 *
 * One component rather than two forms, because the two screens differ in
 * exactly two ways — whether the key may change, and what the submit button
 * says — and a copy would drift on the third change.
 *
 * Controlled by the caller: it owns the draft, the errors and the submit. This
 * renders and reports, which keeps it usable from the import screen's row
 * editor too.
 */
export function FeatureForm({
  draft,
  errors,
  onChange,
  lockKey = false,
}: {
  draft: FeatureDraft;
  errors: DraftErrors;
  onChange: (draft: FeatureDraft) => void;
  /**
   * Edit locks the key.
   *
   * A key is the identity: roles reference it, `perm_role_feature` has a
   * foreign key to it, and audit rows name it. Renaming one is not an edit, it
   * is a delete and a create — and doing it silently would revoke every grant
   * that pointed at the old name.
   */
  lockKey?: boolean;
}) {
  const set = <K extends keyof FeatureDraft>(field: K, value: FeatureDraft[K]) =>
    onChange({ ...draft, [field]: value });

  return (
    <div className="flex flex-col gap-5">
      <Field label="Key" hint="area:action — lower case, e.g. billing:manage" error={errors.key} htmlFor="feature-key">
        <input
          id="feature-key"
          value={draft.key}
          onChange={(event) => set('key', event.target.value)}
          disabled={lockKey}
          placeholder="billing:manage"
          className={inputClass(Boolean(errors.key), lockKey)}
        />
        {lockKey ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            A key cannot be changed — roles and audit rows reference it. Create a new feature and deprecate this one
            instead.
          </p>
        ) : null}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Module" hint="Which module owns it." error={errors.module} htmlFor="feature-module">
          <input
            id="feature-module"
            value={draft.module}
            onChange={(event) => set('module', event.target.value)}
            placeholder="permissions"
            className={inputClass(Boolean(errors.module))}
          />
        </Field>

        <Field
          label="Level"
          hint="The scope a role must be at to grant it."
          error={errors.level}
          htmlFor="feature-level"
        >
          <select
            id="feature-level"
            value={draft.level}
            onChange={(event) => set('level', event.target.value)}
            className={inputClass(Boolean(errors.level))}
          >
            {ROLE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Label" hint="What a role editor shows." error={errors.label} htmlFor="feature-label">
        <input
          id="feature-label"
          value={draft.label}
          onChange={(event) => set('label', event.target.value)}
          placeholder="Manage billing"
          className={inputClass(Boolean(errors.label))}
        />
      </Field>

      <Field
        label="Description"
        hint="The sentence someone reads before handing this right to a person."
        error={errors.description}
        htmlFor="feature-description"
      >
        <textarea
          id="feature-description"
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
          rows={2}
          placeholder="View and change the plan."
          className={inputClass(Boolean(errors.description))}
        />
      </Field>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={draft.isPrivileged}
          onChange={(event) => set('isPrivileged', event.target.checked)}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        <span>
          <span className="font-medium text-foreground">Privileged</span>
          <span className="block text-muted-foreground">
            Irreversible or heavily audited. Flagged in the role editor so it is not granted by habit.
          </span>
        </span>
      </label>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  // `| undefined` explicitly: exactOptionalPropertyTypes is on workspace-wide,
  // so a caller cannot forward its own optional value without it.
  hint?: string | undefined;
  error?: string | undefined;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-1.5">{children}</div>
      {/*
        `role="alert"` so the message is announced rather than only appearing —
        a sighted user sees the field turn red and, without this, the same
        information simply does not arrive.
      */}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function inputClass(invalid: boolean, disabled = false): string {
  return [
    'w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none',
    'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
    invalid ? 'border-destructive' : 'border-input',
    disabled ? 'cursor-not-allowed opacity-60' : '',
  ].join(' ');
}
