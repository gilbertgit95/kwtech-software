'use client';

import { useEffect, useState } from 'react';
import {
  type ChatSettings,
  DEFAULT_CHAT_SETTINGS,
  readChatSettings,
  withQuickEmojiFor,
  writeChatSettings,
} from '../chat-settings.js';
import { CHAT_PREFERENCES_HREF } from '../routes.js';
import { EmojiGrid } from './emoji-picker.js';

/**
 * THIS CONVERSATION'S QUICK BUTTON — the viewer's own, on any conversation.
 *
 * ## ⚠ AVAILABLE TO EVERY PARTICIPANT, always
 *
 * Everything else on a conversation's settings page is about the CONVERSATION —
 * its name, who is in it, who runs it — and is shared, stored server-side, and
 * gated on what this person may do. This is about the VIEWER: it lives in their
 * browser, is never sent anywhere, and the other participants cannot see it.
 *
 * So it is **outside every role check**, and it is a shared component rather
 * than markup inside the group page for exactly that reason: a direct message
 * has no owner, no admin and no settings of its own, and its participants have
 * precisely as much right to this as the owner of a group does.
 *
 * ⚠ It shipped inside the group page first, which is how it came to be
 * unreachable in every DM — the page returned early for a direct conversation
 * with "a direct conversation has no settings", a sentence that was true until
 * this section existed. A control belonging to the viewer does not belong to
 * one page's layout.
 */
export function QuickEmojiSection({ conversationId }: { conversationId: string }) {
  /*
   * ⚠ Read once on mount, not per render: `readChatSettings` touches
   * localStorage. Held in state so the grid reflects a change immediately, and
   * written through on every change so another tab sees it on its next read.
   */
  const [prefs, setPrefs] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  useEffect(() => setPrefs(readChatSettings()), []);

  const override = prefs.quickEmojiByConversation[conversationId];

  const setQuick = (emoji: string | null) => {
    const next = withQuickEmojiFor(prefs, conversationId, emoji);
    setPrefs(next);
    writeChatSettings(next);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-foreground">Your quick emoji here</h2>
      <p className="text-sm text-muted-foreground">
        The one-tap button beside the message box, just for this conversation. ⚠ Saved in this browser and visible only
        to you — nobody else in here sees what you chose.
      </p>

      {/* ⚠ The same catalogue the composer offers, never a shortlist. */}
      <div className="rounded-md border border-border p-2">
        <EmojiGrid selected={override} onPick={setQuick} />
      </div>

      {/*
        ⚠ THREE STATES, NOT TWO, and they are genuinely different answers:
        "use my default" FORGETS the override so this conversation follows
        whatever the default becomes later; "no button here" is a choice to have
        none in this thread specifically, which somebody may want in exactly the
        conversation where a stray tap would be worst.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setQuick(null)}
          disabled={override === undefined}
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
        >
          Use my default ({prefs.quickEmoji || 'none'})
        </button>
        <button
          type="button"
          onClick={() => setQuick('')}
          disabled={override === ''}
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
        >
          No button here
        </button>
        <a href={CHAT_PREFERENCES_HREF} className="text-sm text-muted-foreground hover:text-foreground">
          Change my default →
        </a>
      </div>
    </section>
  );
}
