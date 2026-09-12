'use client';

import { cn } from '@kwtech/web-ui/react';
import { useState } from 'react';
import type { ChatClient } from '../chat-client.js';
import { ConversationList } from '../components/conversation-list.js';
import { MessageThread } from '../components/message-thread.js';
import { NewConversation } from '../components/new-conversation.js';
import { useChat } from '../use-chat.js';

/**
 * `/chat` — the whole of chat, on one page.
 *
 * ## Why this is the only home, and there is no floating panel
 *
 * The design carried an anchored popover hanging off an icon in the app's main
 * header. That icon is gone: chat is in the side drawer, which already leads
 * here, and a second door to one place is how somebody learns to wonder which
 * one is real. The panel had nothing left to anchor to (§12.52).
 *
 * It is not a loss worth undoing carelessly. A panel is a shortcut to this
 * data, and building the shortcut first makes it the only home — permanently
 * cramped, with no room for a conversation anybody actually reads.
 *
 * ## Two columns, one on a phone
 *
 * The list and the thread are siblings at desktop width. Below `sm` only one is
 * shown at a time — which is not a compromise but the correct reading: a 400px
 * screen holding a 140px list beside a 260px thread holds neither.
 *
 * ## ⚠ IT IS A PAGE, AND IT HAS TO LOOK LIKE ONE
 *
 * It did not: the whole screen was one `rounded-lg border bg-card` block with
 * no heading above it, which in a shell whose header is also `bg-card` reads as
 * a raised panel dropped on the page — a floating modal that never opened.
 * Reported after testing, 2026-09-12.
 *
 * So it now opens the way every other screen in this app does: an `h1` at
 * `text-2xl font-semibold tracking-tight`, a line of description under it, and
 * a body that fills the height left over. That is `AdminPage`'s 'fill' layout,
 * and this is deliberately NOT an import of it — `AdminPage` belongs to
 * `module-permissions`, and a module may not import a module (§9). It is the
 * same arrangement `module-auth`'s `SettingsPage` already has: three frames of
 * one shape, owned by the modules that render inside them.
 *
 * ⚠ The two-pane region keeps a border and loses `bg-card`. The border is
 * structure — the list and the thread are different things and the seam between
 * them has to be visible — while the fill was what made it float. A data grid
 * on any other page is delineated the same way.
 */
export function ChatPage({ client }: { client?: ChatClient } = {}) {
  const chat = useChat(client ? { client } : {});
  const [starting, setStarting] = useState(false);

  /*
   * Captured once, so the thread's callbacks close over a conversation that is
   * definitely there. Reading `chat.selected` inside a handler would be reading
   * a property that TypeScript cannot narrow across the closure — and the
   * fallback such code needs (`?? ''`) is an id the server would refuse, which
   * is a worse answer than the button not existing.
   */
  const selected = chat.selected;

  /*
   * WHICH COLUMN A PHONE SHOWS. The list until something is open, the thread
   * once something is — the same rule a mail client follows, and it needs no
   * back button because the drawer's own entry returns here.
   */
  const showingThread = starting || chat.selected !== null;

  return (
    <div className="flex h-full w-full flex-col">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Chat</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Conversations with anybody whose email address you know. Messages arrive as they are sent.
      </p>

      {/*
        `min-h-0` alongside `flex-1`: a flex child's default `min-height: auto`
        refuses to shrink below its content, which would push the panes past the
        viewport and take the page's scrollbar with them.
      */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        {chat.error ? (
          /*
            ⚠ The SERVER's own sentence, not a generic one. Its refusals are
            written for a reader — "You have as many group chats as your role
            allows" says exactly what is wrong, and replacing it with "Something
            went wrong" throws away the only useful thing in the response.

            The same shape every other screen in this app uses for a refusal.
          */
          <p
            role="alert"
            className="mb-3 flex items-start justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <span>{chat.error}</span>
            <button type="button" onClick={chat.dismissError} className="shrink-0 text-xs underline underline-offset-2">
              Dismiss
            </button>
          </p>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          <div className={cn('min-h-0 w-full sm:block sm:w-auto', showingThread && 'hidden')}>
            <ConversationList
              conversations={chat.conversations}
              selectedId={selected?.id ?? null}
              busy={chat.busy}
              starting={starting}
              presence={chat.presence}
              myAvailability={chat.myAvailability}
              onAvailabilityChange={(availability, forMinutes) =>
                void chat.changeAvailability(availability, forMinutes)
              }
              onOpen={(conversationId) => {
                setStarting(false);
                chat.open(conversationId);
              }}
              onRespond={(conversationId, accept) => {
                setStarting(false);
                void chat.respond(conversationId, accept);
              }}
              onStartNew={() => {
                // Opening the form CLOSES the thread, so the pane it replaces is
                // not still holding a conversation somebody thinks they are in.
                chat.open(null);
                setStarting((open) => !open);
              }}
            />
          </div>

          <div className={cn('min-h-0 flex-1', !showingThread && 'hidden sm:flex')}>
            {starting ? (
              <NewConversation
                busy={chat.busy}
                onFind={chat.lookUp}
                onStartDirect={(userId) => {
                  setStarting(false);
                  void chat.startDirect(userId);
                }}
                onStartGroup={(title, userIds) => {
                  setStarting(false);
                  void chat.startGroup(title, userIds);
                }}
                onCancel={() => setStarting(false)}
              />
            ) : selected ? (
              <MessageThread
                conversation={selected}
                messages={chat.messages}
                olderCursor={chat.olderCursor}
                busy={chat.busy}
                onSend={(body) => void chat.send(body)}
                onLoadOlder={() => void chat.loadOlder()}
                onDelete={(messageId) => void chat.removeMessage(messageId)}
                presence={chat.presence}
                typing={chat.typingHere}
                onTyping={chat.noteTyping}
                onInvite={(userId) => void chat.invite(selected.id, userId)}
                onLeave={() => void chat.leave(selected.id)}
                onFind={chat.lookUp}
              />
            ) : (
              <div className="hidden flex-1 items-center justify-center p-6 text-center sm:flex">
                <p className="max-w-xs text-sm text-muted-foreground">
                  Pick a conversation, or start one with anybody whose email address you know.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
