/**
 * Search over the notes a person can see (NOTE-PLAN §5).
 *
 * v1 is `ILIKE '%term%'` over title and body. Full-text search (`tsvector`,
 * `pg_trgm`) is §8 — at a per-person cap of hundreds of notes a scan is cheap.
 *
 * ⚠ VISIBILITY GOES IN THE SAME `where` AS THE TERM, never filtered afterwards.
 * Filtering after would page and count over notes the viewer cannot see.
 */

/** In code points. A search term is a few words, not a paragraph. */
export const NOTE_SEARCH_MAX = 100;

/**
 * The term to search for, or null for "no search": empty, or only whitespace.
 * Whitespace runs are collapsed and the result trimmed; a term longer than the
 * cap is cut rather than refused, because a search box is not a form.
 */
export function prepareNoteSearch(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const term = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (term.length === 0) return null;
  return [...term].slice(0, NOTE_SEARCH_MAX).join('');
}

// `escapeLikePattern` is in `@kwtech/module-kit`: tasks search the same way.
