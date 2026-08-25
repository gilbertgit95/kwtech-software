import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting the LAST Tailwind utility in a conflicting pair
 * win.
 *
 * Plain `clsx` alone would emit both `px-2` and `px-4` and leave the winner to
 * stylesheet order, which is whatever Tailwind happened to generate — so a
 * component's `className` prop would override its defaults only by luck.
 * `twMerge` resolves the conflict by meaning rather than by position, which is
 * what makes `className` a reliable escape hatch on every component here.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
