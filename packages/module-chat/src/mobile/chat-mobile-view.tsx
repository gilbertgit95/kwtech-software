'use client';

import { useState } from 'react';
import type { ChatClient } from '../react/chat-client.js';
import { ChatIcon } from '../react/components/chat-icons.js';
import { MessageThread } from '../react/components/message-thread.js';
import { NewConversation } from '../react/components/new-conversation.js';
import { useChat } from '../react/use-chat.js';
import { MobileConversationList } from './mobile-conversation-list.js';

/**
 * Chat on the phone's bottom bar (issue #22): the conversation list, and one
 * conversation full screen with "‹ Chats" to return.
 *
 * The same thread, new-conversation form and `useChat` as `ChatPage`, with a
 * list drawn for a phone (`MobileConversationList`). One at a time, never
 * side by side, and with a way back that the desktop page leaves to its
 * drawer. No Preferences link: the preferences are a page of the full site.
 *
 * Mounted once and kept by the frame, so a half-written message survives a
 * trip to Home and back. It never navigates.
 */
export function ChatMobileView({ client }: { client?: ChatClient } = {}) {
  const chat = useChat(client ? { client } : {});
  const [starting, setStarting] = useState(false);
  const selected = chat.selected;
  const showingThread = starting || selected !== null;

  const backToList = () => {
    setStarting(false);
    chat.open(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {chat.error ? (
        // The server's own sentence: its refusals say exactly what is wrong.
        <p
          role="alert"
          className="mx-3 mt-3 flex items-start justify-between gap-3 rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{chat.error}</span>
          <button type="button" onClick={chat.dismissError} className="shrink-0 text-xs underline underline-offset-2">
            Dismiss
          </button>
        </p>
      ) : null}

      {showingThread ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border/60 px-1 py-1">
            <button
              type="button"
              onClick={backToList}
              className="flex min-h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-medium text-primary transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChatIcon name="back" className="size-5" />
              Chats
            </button>
          </div>
          <div className="flex min-h-0 flex-1">
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
            ) : null}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MobileConversationList
            conversations={chat.conversations}
            busy={chat.busy}
            presence={chat.presence}
            myAvailability={chat.myAvailability}
            onAvailabilityChange={(availability, forMinutes) => void chat.changeAvailability(availability, forMinutes)}
            onOpen={(conversationId) => chat.open(conversationId)}
            onRespond={(conversationId, accept) => void chat.respond(conversationId, accept)}
            onStartNew={() => {
              chat.open(null);
              setStarting(true);
            }}
          />
        </div>
      )}
    </div>
  );
}
