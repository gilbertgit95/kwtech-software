'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type * as React from 'react';

import { cn } from './utils.js';

/**
 * The dropdown primitive, hand-owned in shadcn style (PLAN §3) rather than
 * installed as a component library.
 *
 * Only the parts something renders: Root, Trigger, Content, Item, Label and
 * Separator. RadioGroup/CheckboxItem/Sub are deliberately absent — an unused
 * export is a thing to keep working, and the two menus in this app do not need
 * them. The theme toggle spells its radio semantics out by hand for that
 * reason.
 *
 * Radix is what buys the behaviour that is genuinely hard: focus trapping,
 * type-ahead, arrow-key roving, `aria-expanded` on the trigger, and returning
 * focus to it on close. Styling is ours; interaction is not worth rewriting.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    // Portalled, so the menu is not clipped by the header's `overflow` or
    // out-stacked by anything with a z-index further up the tree.
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
        // `focus:`, not `hover:` — Radix moves DOM focus as the pointer travels
        // the menu, so one rule highlights the row for mouse and keyboard both.
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-sm font-semibold', className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
