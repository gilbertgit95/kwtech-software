/**
 * @kwtech/web-ui/react — the React components.
 *
 * Separate from the package root on purpose. The root is the palettes and the
 * headless runtime and has ZERO runtime dependencies, so a build script, a test
 * or a non-React consumer can import it freely. Everything here needs Radix,
 * lucide and the class helpers, which are declared as OPTIONAL peers — an app
 * that never imports this subpath never installs them.
 *
 * ⚠ NAMED re-exports, never `export *`. Half of this barrel is `'use client'`,
 * and a Next app replaces such a module with a client-reference proxy that does
 * not answer the `for...in` enumeration `export *` compiles to — the re-export
 * then yields nothing and fails at render with "Element type is invalid",
 * pointing nowhere near this file. See packages/module-auth/src/react/index.ts,
 * where that cost a debugging session.
 */

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
export { type ThemeMode, ThemeSwitcher, type ThemeSwitcherProps } from './theme-switcher.js';
export { cn } from './utils.js';
