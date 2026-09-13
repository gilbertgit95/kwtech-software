'use client';

import type React from 'react';
import { CHAT_HREF } from '../routes.js';

/**
 * The frame every chat SUB-PAGE sits in — and the reason it is shared.
 *
 * ## ⚠ Why this is not a local helper any more
 *
 * It was one: a private `Frame` inside `chat-settings-page.tsx`, carrying the
 * back link. Then `/chat/preferences` was written as a new file and simply did
 * not have it, because there was nothing to forget — you cannot omit a
 * component you never knew existed. The result shipped as a page with no way
 * back to chat, found by using it.
 *
 * ⚠ A convention that lives in one file is not a convention, it is a habit. So
 * the frame is a component every sub-page must render, the back link is INSIDE
 * it rather than passed to it, and `chat-sub-pages.test.ts` fails if a new page
 * under `pages/` does not use it.
 *
 * ## Why the drawer is not the answer
 *
 * `/chat` is in the side drawer, so in principle the way back is always there.
 * In practice the drawer collapses, it is hidden entirely at narrow widths, and
 * a person deep in a settings screen should not have to reopen a navigation
 * panel to leave it. The browser's Back button is not the answer either: these
 * pages are reached by a link, so Back works, but a screen that relies on
 * browser chrome for its only exit is a screen that traps anybody who arrived
 * by typing the URL or following one from an email.
 *
 * ## ⚠ NOT an import of `module-permissions`' `AdminPage`
 *
 * Which is the same shape — but a module may not import a module (§9). The
 * third frame of one form, owned by the module rendering inside it, exactly as
 * `module-auth`'s settings shell is the second.
 */
export function ChatSubPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      {/*
        ⚠ A PLAIN ANCHOR, not next/link. This package declares React as an
        optional peer and Next as nothing at all — the routes are data and the
        app's catch-all renders them, so importing `next/link` here would make
        every consumer a Next app.

        ⚠ And it names where it goes. "← Back to chat" rather than "← Back":
        a bare Back tells somebody the direction and not the destination, which
        is exactly the wrong half when they have forgotten how they got here.
      */}
      <a href={CHAT_HREF} className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to chat
      </a>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}
