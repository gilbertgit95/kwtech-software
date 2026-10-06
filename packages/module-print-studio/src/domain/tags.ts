import type { StudioRefusal } from '../types.js';
import { cleanText } from './layout.js';
import { STUDIO_PRESET_TAGS } from './presets.js';

/**
 * A layout's tag: what kind of work it is for ("ID", "Photo Print"), so the
 * screens can show the layouts of one kind together.
 *
 * ⚠ ONE TAG PER LAYOUT, on purpose: the tag is what a layout is filed under,
 * and a layout filed under two would be drawn twice on every screen.
 *
 * Free text, because a shop names its own kinds of work — but two spellings of
 * one tag must not become two shelves, so tags are COMPARED by `studioTagKey`
 * (case and spacing ignored) and the editor offers the ones already in use.
 */
export const STUDIO_LAYOUT_TAG_MAX = 30;

/**
 * A tag as it may be saved: one clean line of at most `STUDIO_LAYOUT_TAG_MAX`,
 * or null for none. Nothing and an empty line both mean "no tag".
 */
export function prepareLayoutTag(value: unknown): { tag: string | null } | { refused: StudioRefusal } {
  if (value == null) return { tag: null };
  if (typeof value !== 'string') return { refused: 'invalid_tag' };
  const tag = cleanText(value).replace(/\s+/g, ' ');
  if ([...tag].length > STUDIO_LAYOUT_TAG_MAX) return { refused: 'invalid_tag' };
  return { tag: tag.length === 0 ? null : tag };
}

/** What two tags are compared by: "Photo  print" and "photo print" are one tag. Null for none. */
export function studioTagKey(tag: string | null | undefined): string | null {
  const key = (tag ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return key.length === 0 ? null : key;
}

export interface StudioTagGroup<T> {
  /** Null: the layouts with no tag. */
  key: string | null;
  /** As the first layout in the group spells it. Null for the untagged. */
  label: string | null;
  items: T[];
}

/**
 * Layouts under their tags: tags in alphabetical order, the untagged LAST —
 * a person who tags their layouts wants those shelves first. The order inside
 * a group is the order given.
 */
export function groupByStudioTag<T>(
  items: readonly T[],
  tagOf: (item: T) => string | null | undefined,
): StudioTagGroup<T>[] {
  const groups = new Map<string | null, StudioTagGroup<T>>();
  for (const item of items) {
    const tag = tagOf(item);
    const key = studioTagKey(tag);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, label: key === null ? null : (tag ?? '').trim(), items: [item] });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === null || b.key === null) return a.key === b.key ? 0 : a.key === null ? 1 : -1;
    return a.key.localeCompare(b.key);
  });
}

/**
 * What to show under a tag being typed: the offered tags containing it (all of
 * them for an empty box), and whether the typed text is a tag nobody uses yet
 * — the dropdown then offers it as a new one.
 */
export function matchStudioTags(tags: readonly string[], typed: string): { matches: string[]; isNew: boolean } {
  const key = studioTagKey(typed);
  if (key === null) return { matches: [...tags], isNew: false };
  const keys = tags.map((tag) => studioTagKey(tag) ?? '');
  return {
    matches: tags.filter((_, index) => keys[index]?.includes(key)),
    isNew: !keys.includes(key),
  };
}

/**
 * The tags to offer while typing one: the presets' own, then the ones already
 * on the layouts in view — each once, by `studioTagKey`.
 */
export function studioTagSuggestions(inUse: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of [...STUDIO_PRESET_TAGS.map((one) => one.label), ...inUse]) {
    const key = studioTagKey(tag);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    tags.push((tag ?? '').trim());
  }
  return tags;
}
