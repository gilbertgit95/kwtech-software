import type { AUTH_SPACINGS, AUTH_TEXT_SIZES } from '@kwtech/module-auth';
import type { SPACINGS, TEXT_SIZES } from '@kwtech/web-ui';

/**
 * ⚠ THE ACCOUNT'S DISPLAY SIZES AND THE STYLESHEET'S ARE ONE LIST, KEPT AS TWO
 * (issue #20). `@kwtech/web-ui` owns what each step looks like; `module-auth`
 * stores which one a person chose, and its framework-free core may not import
 * web-ui, so it copies the list (src/domain/display.ts). Only the app sees
 * both, so the app is where they are held together — like
 * `satisfies-modules.ts` on the server.
 *
 * A step added to one side only fails the compile here: unchecked, the
 * account would save a size no rule matches (shown as Normal, silently), or the
 * Display page would offer one the API refuses.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/*
 * The TUPLES are compared, not just their members, so the ORDER is held too:
 * it is the order the Display page shows the steps in, smallest first.
 */
export const DISPLAY_LISTS_AGREE: [
  Same<typeof AUTH_TEXT_SIZES, typeof TEXT_SIZES>,
  Same<typeof AUTH_SPACINGS, typeof SPACINGS>,
] = [true, true];
