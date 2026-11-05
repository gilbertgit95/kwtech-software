/**
 * COUNTS ON A PHONE SCREEN'S SECTION CHIPS (issue #69): "Cashier 3".
 *
 * The count belongs to the app, not to its descriptor. The app already holds
 * the live list the number comes from (the POS's waiting orders), so it
 * REPORTS the count to the phone frame (`useMobileSectionBadge`) rather than
 * the frame asking a badge component to fetch the same list a second time.
 * These are the frame's two rules, pure so they are tested here.
 */

/** Each open app's section counts, by app key, then section key. A section with no count is absent. */
export type MobileSectionBadges = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * The counts with one section's changed. `count` null, zero or below clears
 * it. ⚠ RETURNS THE SAME OBJECT WHEN NOTHING CHANGED, so the frame's state
 * setter bails out instead of re-rendering every screen on each report.
 */
export function withSectionBadge(
  badges: MobileSectionBadges,
  app: string,
  section: string,
  count: number | null,
): MobileSectionBadges {
  const current = badges[app]?.[section];
  const next = count !== null && Number.isFinite(count) && count > 0 ? Math.floor(count) : undefined;
  if (current === next) return badges;
  const { [section]: _dropped, ...others } = badges[app] ?? {};
  const sections = next === undefined ? others : { ...others, [section]: next };
  return { ...badges, [app]: sections };
}

/** The most a chip spells out; past it, "99+": a wider chip would push its neighbours off the strip. */
export const MOBILE_SECTION_BADGE_MAX = 99;

/** What a chip shows for a count: nothing for none, the number, or "99+". */
export function sectionBadgeLabel(count: number | undefined): string | null {
  if (count === undefined || count <= 0) return null;
  return count > MOBILE_SECTION_BADGE_MAX ? `${MOBILE_SECTION_BADGE_MAX}+` : String(count);
}
