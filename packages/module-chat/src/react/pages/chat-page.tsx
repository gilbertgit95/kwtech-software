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
    <div className="flex h-full min-h-0 flex-col">
      {chat.error ? (
        <div
          role="alert"
          className="mb-2 flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
        >
          {/*
            ⚠ The SERVER's own sentence, not a generic one. Its refusals are
            written for a reader — "You have as many group chats as your role
            allows" says exactly what is wrong, and replacing it with
            "Something went wrong" throws away the only useful thing in the
            response.
          */}
          <p>{chat.error}</p>
          <button type="button" onClick={chat.dismissError} className="shrink-0 text-xs underline underline-offset-2">
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <div className={cn('min-h-0 w-full sm:block sm:w-auto', showingThread && 'hidden')}>
          <ConversationList
            conversations={chat.conversations}
            selectedId={selected?.id ?? null}
            busy={chat.busy}
            starting={starting}
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
  );
}
