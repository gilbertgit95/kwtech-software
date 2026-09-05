import { isKnownTag, normaliseTags } from '../feature-tags.js';
import type { FeatureSpec, RoleLevel } from '../types.js';
import { ROLE_LEVELS } from '../types.js';

/**
 * A feature being written, before it is a `FeatureSpec`.
 *
 * Every field is a string because that is what a form field and a spreadsheet
 * cell both hold. Validation is what turns one into a spec, and it lives here —
 * not in a page — so the manual form and the spreadsheet import cannot disagree
 * about what a valid feature is. Two validators is one validator plus a future
 * bug report about an import that accepted something the form refused.
 */
export interface FeatureDraft {
  key: string;
  module: string;
  level: string;
  label: string;
  description: string;
  isPrivileged: boolean;
  /**
   * Comma-separated while it is a DRAFT, because that is what a text field and a
   * spreadsheet cell both hold. Split, normalised and validated on the way to a
   * spec — so `Admin, Access Control` and `admin,access-control` are one thing.
   */
  tags: string;
}

export const EMPTY_DRAFT: FeatureDraft = {
  key: '',
  module: '',
  level: 'organization',
  label: '',
  description: '',
  isPrivileged: false,
  tags: '',
};

/**
 * `namespace:action`, lower case, dots and underscores allowed inside a part.
 *
 * Derived from the keys already in the registry — `admin:access`,
 * `platform:support_access`, `workspaces:access_all` — rather than invented, so
 * a key that passes here looks like the ones beside it. The colon is required:
 * it is what makes a key readable as "what area, what action" in a role editor
 * listing forty of them.
 */
export const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_.]*:[a-z][a-z0-9_.]*$/;

/** Field name → what is wrong with it. Empty means the draft is valid. */
export type DraftErrors = Partial<Record<keyof FeatureDraft, string>>;

export interface ValidateOptions {
  /**
   * Keys that already exist. A new draft may not reuse one; an edit may reuse
   * its own.
   */
  existingKeys?: readonly string[];
  /** The key being edited, so a form that has not changed it still validates. */
  originalKey?: string;
}

/**
 * Everything wrong with a draft, ALL AT ONCE rather than the first problem.
 *
 * A form that reports one error per submit makes someone play twenty questions
 * with it; an import that stops at the first bad row makes them fix a
 * hundred-row file one row at a time.
 */
export function validateDraft(draft: FeatureDraft, options: ValidateOptions = {}): DraftErrors {
  const errors: DraftErrors = {};
  const key = draft.key.trim();

  if (!key) errors.key = 'A key is required.';
  else if (!FEATURE_KEY_PATTERN.test(key)) {
    errors.key = "Use 'area:action' — lower case letters, digits, dot or underscore, e.g. 'billing:manage'.";
  } else if (options.existingKeys?.includes(key) && key !== options.originalKey) {
    // Refused rather than merged: two definitions of one key is precisely the
    // ambiguity the registry exists to prevent (see composeFeatures).
    errors.key = `'${key}' already exists.`;
  }

  if (!draft.module.trim()) errors.module = 'A module is required.';

  if (!isRoleLevel(draft.level)) {
    errors.level = `Level must be one of: ${ROLE_LEVELS.join(', ')}.`;
  }

  if (!draft.label.trim()) errors.label = 'A label is required.';

  /*
   * The description is REQUIRED, unlike in most forms.
   *
   * It is the sentence a person reads in the role editor when deciding whether
   * to hand someone this right. A feature with no description is one granted on
   * the strength of its key, which is a name, not an explanation.
   */
  if (!draft.description.trim()) errors.description = 'A description is required — it is what a role editor shows.';

  /*
   * Tags are OPTIONAL but not freeform: an unknown one is refused rather than
   * accepted, because a tag that nobody else uses groups nothing and is
   * invisible until someone wonders why the filter has an extra pile. Adding a
   * tag is a one-line edit to FEATURE_TAG, which is the deliberate act it
   * should be.
   */
  const unknown = parseTags(draft.tags).filter((tag) => !isKnownTag(tag));
  if (unknown.length > 0) {
    errors.tags = `Unknown tag(s): ${unknown.join(', ')}. Add them to FEATURE_TAG first.`;
  }

  return errors;
}

/**
 * A whole LIST of drafts, with duplicates within the list caught.
 *
 * Cross-row validation is why this exists rather than callers mapping
 * `validateDraft`: a key used twice in one batch passes individually and then
 * makes `composeFeatures` throw at boot. Each row is checked against the keys
 * already claimed by the rows above it, so the SECOND occurrence is the one
 * flagged — the first is where the key legitimately lives.
 *
 * Shared by the spreadsheet import and the editable grid it feeds, so a file
 * and a hand-typed row cannot be judged by different rules.
 */
export function validateDraftList(
  drafts: readonly FeatureDraft[],
  existingKeys: readonly string[] = [],
): DraftErrors[] {
  const claimed = [...existingKeys];

  return drafts.map((draft) => {
    const errors = validateDraft(draft, { existingKeys: claimed });
    // Only a key that passed is claimed: a malformed one is not a name anyone
    // else could collide with, and claiming it would report the same problem
    // twice on two rows.
    if (!errors.key) claimed.push(draft.key.trim());
    return errors;
  });
}

/** The draft's comma-separated field as a normalised, sorted, de-duplicated list. */
export function parseTags(value: string): string[] {
  return normaliseTags(value.split(','));
}

export function isRoleLevel(value: string): value is RoleLevel {
  return (ROLE_LEVELS as readonly string[]).includes(value);
}

export function hasErrors(errors: DraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** A validated draft as the spec it will become. Call only when `validateDraft` returned nothing. */
export function draftToSpec(draft: FeatureDraft): FeatureSpec {
  return {
    key: draft.key.trim(),
    module: draft.module.trim(),
    level: draft.level as RoleLevel,
    label: draft.label.trim(),
    description: draft.description.trim(),
    ...(draft.isPrivileged ? { isPrivileged: true } : {}),
    tags: parseTags(draft.tags),
    /*
     * No bindings. A binding names the concrete place a key is ENFORCED — a
     * controller handler, a route, a component — and none of those exist yet
     * for a feature invented in a form. Inventing one here would put a key in
     * the registry that reads as covered while guarding nothing, which is the
     * exact failure `FeatureSurface` documents.
     */
    bindings: [],
  };
}

export function specToDraft(spec: FeatureSpec): FeatureDraft {
  return {
    key: spec.key,
    module: spec.module,
    level: spec.level,
    label: spec.label,
    description: spec.description,
    isPrivileged: spec.isPrivileged ?? false,
    tags: (spec.tags ?? []).join(', '),
  };
}

/**
 * The drafts as source for `feature-keys.ts`.
 *
 * This is the OUTPUT of both write screens, and it is not a fallback for a
 * missing API — it is what the architecture actually requires.
 * `syncFeatureRegistry` deprecates any `perm_feature` row that is not in
 * `FEATURE_REGISTRY`, and `assertRegistered` refuses an unregistered key, so a
 * feature written straight to the table would be switched off by the next
 * deploy and could never be granted in the meantime. The registry is the
 * source; the table is its mirror.
 *
 * So the screens compose and validate, and the code they emit is what makes the
 * feature real. See docs/PLAN.md §13 for the open decision about reversing that.
 */
export function draftsToRegistrySource(drafts: readonly FeatureDraft[]): string {
  return drafts
    .map((draft) => {
      const spec = draftToSpec(draft);
      return [
        '  {',
        `    key: '${escapeSingleQuoted(spec.key)}',`,
        `    module: '${escapeSingleQuoted(spec.module)}',`,
        `    level: '${spec.level}',`,
        `    label: '${escapeSingleQuoted(spec.label)}',`,
        `    description: '${escapeSingleQuoted(spec.description)}',`,
        ...(spec.isPrivileged ? ['    isPrivileged: true,'] : []),
        ...(spec.tags?.length ? [`    tags: [${spec.tags.map((t) => `'${escapeSingleQuoted(t)}'`).join(', ')}],`] : []),
        '    bindings: [],',
        '  },',
      ].join('\n');
    })
    .join('\n');
}

/** Single quotes and backslashes only — these strings go into a single-quoted TS literal. */
function escapeSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
