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

/**
 * A term made literal inside a `LIKE` pattern.
 *
 * ⚠ `%` and `_` ARE WILDCARDS. Unescaped, searching `100%` matches everything
 * after "100", and `_` matches any one character. The backslash goes first, or
 * the escapes added for the other two would be escaped again. The backslash is
 * Postgres' default `LIKE` escape character.
 *
 * ⚠ PRISMA'S `contains` DOES NOT ESCAPE. Checked against Postgres through the
 * app's client (Prisma 7.9, 2026-09-28): `contains: '100%'` matched "100 apples"
 * and `contains: 'a_b'` matched "axb"; the escaped terms matched only the right
 * rows. So the repository passes THIS to `contains`, exactly once — escaping
 * twice would search for the backslashes.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
