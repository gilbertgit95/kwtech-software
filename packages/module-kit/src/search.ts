/**
 * Text search helpers every module with an `ILIKE` search shares.
 *
 * Here because it has TWO consumers (`module-note`, `module-task`) and one rule:
 * two copies of an escaping rule drift, and the one that drifts matches rows it
 * should not (principle 5).
 */

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
 * rows. So a repository passes THIS to `contains`, exactly once — escaping
 * twice would search for the backslashes.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
