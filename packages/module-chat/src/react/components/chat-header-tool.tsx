'use client';

import { cn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatClient } from '../chat-client.js';
import { openInFullChat, useFullChatOnScreen } from '../chat-surface.js';
import { CHAT_HREF } from '../routes.js';
import { useChat } from '../use-chat.js';
import { conversationTitle, countWaiting, otherParticipants } from '../view/conversation-view.js';
import {
  DEFAULT_DOCK_POSITION,
  DOCK_STORAGE_KEY,
  type DockPosition,
  parseStoredDock,
  type StoredDock,
} from '../view/dock-view.js';
import { ChatDock } from './chat-dock.js';
import { ChatIcon } from './chat-icons.js';
import { ConversationList } from './conversation-list.js';
import { MessageThread } from './message-thread.js';
import { NewConversation } from './new-conversation.js';

/**
 * Chat in the app header: an inbox button with the unread count, a panel of
 * conversations under it, and a floating window for the one you pick — so a
 * message can be read and answered without leaving the page you are on.
 *
 * Contributed as a header TOOL (`WebModuleDescriptor.headerTools`) and rendered
 * with no props, which is why it builds its own client.
 *
 * ## One `useChat`, three views of it
 *
 * The button, the panel and the window share one hook instance, so they agree
 * on what is unread and which conversation is open, and one socket
 * subscription serves all three.
 *
 * ## When the full page is open
 *
 * `/chat` runs its own `useChat`. While it is mounted this one stays SILENT (one
 * tone per message, not two), hides its window, and hands a picked conversation
 * to the page instead of opening a second copy of it. See `chat-surface.ts`.
 */
export function ChatHeaderTool({ client }: { client?: ChatClient } = {}) {
  const fullOnScreen = useFullChatOnScreen();
  const chat = useChat({ ...(client ? { client } : {}), playTones: !fullOnScreen });

  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<'closed' | 'thread' | 'new'>('closed');
  const [dock, setDock] = useState<StoredDock>({
    position: DEFAULT_DOCK_POSITION,
    collapsed: false,
    conversationId: null,
  });
  const rootRef = useRef<HTMLDivElement>(null);

  /*
   * ── restoring the window ────────────────────────────────────────────────
   *
   * In an effect, not in the initial state: the header renders on the server
   * first, where there is no localStorage, and a first client render that
   * differed from it would be a hydration mismatch. Wrapped in try/catch
   * because storage can throw outright (a blocked-cookies profile) and a chat
   * button that crashed the header over a remembered position would be absurd.
   */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let stored: StoredDock | null = null;
    try {
      stored = parseStoredDock(window.localStorage.getItem(DOCK_STORAGE_KEY));
    } catch {
      stored = null;
    }
    if (!stored) return;
    setDock(stored);
  }, []);

  // Reopen the remembered conversation once the list shows it still exists.
  const { open } = chat;
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || !dock.conversationId || !chat.conversations) return;
    reopened.current = true;
    if (!chat.conversations.some((conversation) => conversation.id === dock.conversationId)) return;
    open(dock.conversationId);
    setMode('thread');
  }, [chat.conversations, dock.conversationId, open]);

  const persist = useCallback((next: StoredDock) => {
    try {
      window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Remembering the window is a convenience; failing to is not an error worth showing.
    }
  }, []);

  const updateDock = useCallback(
    (patch: Partial<StoredDock>, save = true) => {
      setDock((current) => {
        const next = { ...current, ...patch };
        if (save) persist(next);
        return next;
      });
    },
    [persist],
  );

  const onMove = useCallback((position: DockPosition, final: boolean) => updateDock({ position }, final), [updateDock]);

  // ── the panel closes on Escape and on a press anywhere outside it ─────────
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    const onPress = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [panelOpen]);

  const pick = (conversationId: string) => {
    setPanelOpen(false);
    if (fullOnScreen) {
      openInFullChat(conversationId);
      return;
    }
    open(conversationId);
    setMode('thread');
    updateDock({ conversationId, collapsed: false });
  };

  const closeWindow = () => {
    setMode('closed');
    open(null);
    updateDock({ conversationId: null });
  };

  /*
   * Remembered whenever the window's conversation changes — including one it
   * just started, which arrives through `useChat` rather than through `pick`.
   */
  const selectedId = chat.selected?.id ?? null;
  useEffect(() => {
    if (mode === 'thread' && selectedId && selectedId !== dock.conversationId) {
      updateDock({ conversationId: selectedId });
    }
  }, [mode, selectedId, dock.conversationId, updateDock]);

  const waiting = countWaiting(chat.conversations ?? []);
  const count = waiting.unread + waiting.requests;
  const selected = chat.selected;
  const showWindow = !fullOnScreen && mode !== 'closed' && (mode === 'new' || selected !== null);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setPanelOpen((current) => !current)}
        aria-expanded={panelOpen}
        aria-haspopup="dialog"
        aria-label={count > 0 ? `Chat, ${describeWaiting(waiting)}` : 'Chat'}
        title="Chat"
        className={cn(
          'relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors',
          'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          panelOpen && 'bg-accent text-foreground',
        )}
      >
        <ChatIcon name="message" className="size-[1.125rem]" />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-none text-primary-foreground ring-2 ring-card"
          >
            {count > BADGE_CEILING ? `${BADGE_CEILING}+` : count}
          </span>
        ) : null}
      </button>

      {panelOpen ? (
        <div
          role="dialog"
          aria-label="Chats"
          className="absolute right-0 top-full z-50 mt-2 flex h-[min(28rem,calc(100dvh-5rem))] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="min-h-0 flex-1">
            <ConversationList
              compact
              conversations={chat.conversations}
              selectedId={selected?.id ?? null}
              busy={chat.busy}
              starting={mode === 'new'}
              presence={chat.presence}
              myAvailability={chat.myAvailability}
              onAvailabilityChange={(availability, forMinutes) =>
                void chat.changeAvailability(availability, forMinutes)
              }
              onOpen={pick}
              onRespond={(conversationId, accept) => void chat.respond(conversationId, accept)}
              onStartNew={() => {
                setPanelOpen(false);
                open(null);
                setMode('new');
                updateDock({ conversationId: null, collapsed: false });
              }}
            />
          </div>
          {chat.error ? (
            <p role="alert" className="border-t border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {chat.error}
            </p>
          ) : null}
          <a
            href={CHAT_HREF}
            className="border-t border-border px-3 py-2.5 text-center text-sm font-medium text-primary hover:bg-accent/60"
          >
            Open full chat
          </a>
        </div>
      ) : null}

      {showWindow ? (
        <ChatDock
          title={mode === 'new' || !selected ? 'New conversation' : conversationTitle(selected)}
          {...(mode === 'thread' && selected && !selected.isDirect
            ? { subtitle: otherParticipants(selected).join(', ') }
            : {})}
          collapsed={dock.collapsed}
          position={dock.position}
          onMove={onMove}
          onToggleCollapsed={() => updateDock({ collapsed: !dock.collapsed })}
          onClose={closeWindow}
          expandHref={selected ? `${CHAT_HREF}?conversation=${encodeURIComponent(selected.id)}` : CHAT_HREF}
        >
          {chat.error ? (
            <p
              role="alert"
              className="flex items-start justify-between gap-2 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <span>{chat.error}</span>
              <button type="button" onClick={chat.dismissError} className="shrink-0 underline underline-offset-2">
                Dismiss
              </button>
            </p>
          ) : null}
          {mode === 'new' ? (
            <NewConversation
              busy={chat.busy}
              onFind={chat.lookUp}
              onStartDirect={(userId) => {
                setMode('thread');
                void chat.startDirect(userId);
              }}
              onStartGroup={(title, userIds) => {
                setMode('thread');
                void chat.startGroup(title, userIds);
              }}
              onCancel={closeWindow}
            />
          ) : selected ? (
            <MessageThread
              compact
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
              onLeave={() => {
                void chat.leave(selected.id);
                closeWindow();
              }}
              onFind={chat.lookUp}
            />
          ) : null}
        </ChatDock>
      ) : null}
    </div>
  );
}

/** The drawer badge's ceiling, for the same reason: past it the digits stop helping. */
const BADGE_CEILING = 99;

function describeWaiting(waiting: { unread: number; requests: number }): string {
  const parts: string[] = [];
  if (waiting.unread > 0) parts.push(`${waiting.unread} unread ${waiting.unread === 1 ? 'message' : 'messages'}`);
  if (waiting.requests > 0) {
    parts.push(`${waiting.requests} ${waiting.requests === 1 ? 'invitation' : 'invitations'}`);
  }
  return parts.join(', ');
}
