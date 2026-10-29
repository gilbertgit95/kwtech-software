/**
 * A person's display sizes (issue #20): how large text is, and how much room
 * is around it, on every screen they sign in to.
 *
 * ⚠ COPIED STRUCTURALLY from `@kwtech/web-ui`'s `TEXT_SIZES` and `SPACINGS`,
 * which own what each step looks like. This root may not import web-ui (it is
 * the framework-free core, read by the server too), so the lists are repeated
 * here and `apps/web-app/src/lib/display.ts` fails the compile if the two ever
 * disagree. The prisma enums `AuthTextSize` and `AuthSpacing` are the third copy,
 * held to these by the structural client's types.
 */

export const AUTH_TEXT_SIZES = ['small', 'normal', 'large', 'larger', 'largest'] as const;
export type AuthTextSize = (typeof AUTH_TEXT_SIZES)[number];

export const AUTH_SPACINGS = ['compact', 'comfortable', 'roomy'] as const;
export type AuthSpacing = (typeof AUTH_SPACINGS)[number];

export interface AuthDisplayPreferences {
  textSize: AuthTextSize;
  spacing: AuthSpacing;
}

/** What somebody who never chose sees: the page as designed. */
export const AUTH_DEFAULT_DISPLAY: AuthDisplayPreferences = { textSize: 'normal', spacing: 'comfortable' };

/**
 * Which layout a set of display sizes is for (issue #22): the full site on a
 * computer or tablet, or the phone layout. Kept apart because the two are
 * read at different distances on different screens — larger text that suits
 * a phone at arm's length makes a desktop table scroll sideways.
 */
export const AUTH_DISPLAY_LAYOUTS = ['desktop', 'mobile'] as const;
export type AuthDisplayLayout = (typeof AUTH_DISPLAY_LAYOUTS)[number];

/** The layout a request names when it names none: the full site, as before the split. */
export const AUTH_DEFAULT_DISPLAY_LAYOUT: AuthDisplayLayout = 'desktop';

export function isAuthDisplayLayout(value: unknown): value is AuthDisplayLayout {
  return typeof value === 'string' && (AUTH_DISPLAY_LAYOUTS as readonly string[]).includes(value);
}

export type AuthDisplayRefusal = 'invalid_text_size' | 'invalid_spacing' | 'invalid_layout';

/**
 * A change to the display sizes, checked: the stored preferences with the
 * given fields replaced, or why it is refused. Absent means "leave it alone",
 * as `updateProfile` reads its input.
 */
export function prepareDisplayChange(
  current: AuthDisplayPreferences,
  input: { textSize?: string | undefined; spacing?: string | undefined },
): AuthDisplayPreferences | { refused: AuthDisplayRefusal } {
  if (input.textSize !== undefined && !isAuthTextSize(input.textSize)) return { refused: 'invalid_text_size' };
  if (input.spacing !== undefined && !isAuthSpacing(input.spacing)) return { refused: 'invalid_spacing' };
  return {
    textSize: (input.textSize as AuthTextSize | undefined) ?? current.textSize,
    spacing: (input.spacing as AuthSpacing | undefined) ?? current.spacing,
  };
}

export function isAuthTextSize(value: unknown): value is AuthTextSize {
  return typeof value === 'string' && (AUTH_TEXT_SIZES as readonly string[]).includes(value);
}

export function isAuthSpacing(value: unknown): value is AuthSpacing {
  return typeof value === 'string' && (AUTH_SPACINGS as readonly string[]).includes(value);
}
