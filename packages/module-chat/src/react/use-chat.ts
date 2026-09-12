'use client';

import { useRealtime } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChatClient,
  type ChatConversationView,
  type ChatMyAvailabilityView,
  type ChatPresenceView,
  createChatClient,
} from './chat-client.js';
import { CHAT_EVENTS, type ChatEventView } from './realtime-documents.js';
import { applyMessage, dropPending, optimisticMessage, readMarkFor, type ThreadMessage } from './view/message-view.js';

/**
 * Everything `/chat` knows, in one place.
 *
 * ## Why a hook and not state scattered through the components
 *
 * Because three things write to the same list — a query, a socket, and the
 * reader's own send — and the ordering between them is the whole correctness of
 * the screen. Spread across a list component and a thread component, "a message
 * arrived" would have to be handled twice and the second one would drift.
 *
 * The RULES it applies are pure and live in `view/`; this is the wiring.
 */

export interface UseChatOptions {
  client?: ChatClient;
}

export interface ChatState {
  conversations: ChatConversationView[] | null;
  selected: ChatConversationView | null;
  messages: ThreadMessage[] | null;
  /** More history exists before what is loaded. */
  olderCursor: string | null;
  /** The last thing that went wrong, for the one banner this screen shows. */
  error: string | null;
  busy: boolean;
}

export function useChat(options: UseChatOptions = {}) {
  const api = useMemo(() => options.client ?? createChatClient(), [options.client]);
  const realtime = useRealtime();

  const [conversations, setConversations] = useState<ChatConversationView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** userId → what the viewer may be told. Absent means "nothing known". */
  const [presence, setPresence] = useState<Map<string, ChatPresenceView>>(new Map());
  /** `conversationId` → userId → when the signal arrived. Pruned by a timer. */
  const [typing, setTyping] = useState<{ conversationId: string; userId: string; at: number }[]>([]);
  const [myAvailability, setMyAvailability] = useState<ChatMyAvailabilityView | null>(null);

  const selected = useMemo(
    () => conversations?.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  /*
   * ⚠ A REF ALONGSIDE THE STATE, read by the socket handler.
   *
   * The subscription is set up once and its callback closes over whatever
   * `selectedId` was at that moment. Without this, opening a second
   * conversation would leave the handler still filtering for the first — and
   * the symptom is messages silently not appearing, which reads as a broken
   * socket rather than a stale closure.
   */
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Something went wrong.');
  }, []);

  // ── reading ───────────────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch (cause) {
      /*
       * ⚠ The existing list is KEPT. An outage is not an empty inbox, and
       * blanking the screen would report a network problem as the reader having
       * no conversations.
       */
      report(cause);
    }
  }, [api, report]);

  const loadThread = useCallback(
    async (conversationId: string) => {
      try {
        const page = await api.listMessages(conversationId);
        // ⚠ The server pages newest-first; the thread reads oldest-first.
        setMessages([...page.items].reverse());
        setOlderCursor(page.nextCursor);
      } catch (cause) {
        setMessages([]);
        report(cause);
      }
    },
    [api, report],
  );

  const open = useCallback(
    (conversationId: string | null) => {
      setSelectedId(conversationId);
      setMessages(null);
      setOlderCursor(null);
      setError(null);
      if (conversationId) void loadThread(conversationId);
    },
    [loadThread],
  );

  const loadOlder = useCallback(async () => {
    if (!selectedId || !olderCursor) return;
    try {
      const page = await api.listMessages(selectedId, olderCursor);
      setMessages((current) => [...[...page.items].reverse(), ...(current ?? [])]);
      setOlderCursor(page.nextCursor);
    } catch (cause) {
      report(cause);
    }
  }, [api, olderCursor, selectedId, report]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // ── presence ──────────────────────────────────────────────────────────────

  /**
   * Everybody the viewer might see a dot for, in one query.
   *
   * ⚠ ONE CALL FOR THE WHOLE LIST, not one per conversation per render. The
   * server answers only for people the viewer shares an active conversation
   * with and silently drops the rest, so sending every participant id is
   * already the narrowest honest request.
   */
  useEffect(() => {
    if (!conversations || conversations.length === 0) return;

    const ids = [
      ...new Set(
        conversations.flatMap((conversation) =>
          conversation.participants.map((one) => one.userId).filter((userId) => userId !== conversation.myUserId),
        ),
      ),
    ];
    if (ids.length === 0) return;

    let cancelled = false;
    api
      .presenceOf(ids)
      .then((found) => {
        if (!cancelled) setPresence(new Map(found.map((one) => [one.userId, one])));
      })
      // A missing dot is the correct degradation: presence is an enhancement
      // over a conversation that works without it.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [api, conversations]);

  useEffect(() => {
    let cancelled = false;
    api
      .myAvailability()
      .then((mine) => {
        if (!cancelled) setMyAvailability(mine);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  /*
   * ⚠ TYPING CLEARS BY EXPIRY, and something has to notice time passing.
   *
   * The server sends "is typing" and never "stopped" — a tab closing mid-word
   * sends nothing — so the indicator would stick forever without this. The
   * timer runs ONLY while somebody is typing, so a quiet screen ticks nothing.
   */
  useEffect(() => {
    if (typing.length === 0) return;
    const timer = setInterval(() => {
      setTyping((current) => current.filter((one) => Date.now() - one.at < TYPING_TTL_MS));
    }, 1_000);
    return () => clearInterval(timer);
  }, [typing.length]);

  // ── the socket ────────────────────────────────────────────────────────────

  /*
   * One coalescing timer for the conversation list. A busy conversation would
   * otherwise re-read the list once per message; the thread itself needs no
   * such delay, because it applies the event it was handed.
   */
  const pendingList = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!realtime) return;

    const unsubscribe = realtime.subscribe<{ chatEvents: ChatEventView }>(CHAT_EVENTS, (data) => {
      const event = data.chatEvents;

      /*
       * ⚠ THE MESSAGE IS APPLIED DIRECTLY, not fetched again. It is why the
       * server carries a body on the wire at all: a thread that re-queried on
       * every arrival would show each message a round trip late, which is what
       * makes a chat feel broken.
       *
       * Only for the conversation on screen — ONE socket carries every
       * conversation this person is in, so the rest is somebody else's thread.
       */
      if (event.kind === 'message' && event.message && event.conversationId === selectedRef.current) {
        const arrived = event.message;
        setMessages((current) => (current ? applyMessage(current, arrived) : current));
      }

      /*
       * ⚠ APPLIED DIRECTLY AND NOT RE-QUERIED. The payload already went through
       * the publish boundary — an invisible person arrives as offline — so
       * there is nothing left to decide and a round trip would only make the
       * dot late.
       */
      if (event.kind === 'presence' && event.userId) {
        const { userId, online, availability } = event;
        setPresence((current) => new Map(current).set(userId, { userId, online: online ?? false, availability }));
        // Somebody who has gone is not still typing.
        if (!online) setTyping((current) => current.filter((one) => one.userId !== userId));
        return;
      }

      if (event.kind === 'typing' && event.userId && event.conversationId) {
        const { userId, conversationId } = event;
        setTyping((current) => [
          ...current.filter((one) => !(one.userId === userId && one.conversationId === conversationId)),
          { conversationId, userId, at: Date.now() },
        ]);
        // ⚠ NOT a reason to re-read the list. Typing changes nothing about a
        // conversation, and re-reading on every keystroke-burst of every
        // participant is the load this event was throttled to avoid.
        return;
      }

      /*
       * The list is RE-READ for everything, including a message: unread counts,
       * ordering and participation are the server's arithmetic, and
       * recomputing them here would be a second implementation of rules that
       * already exist. `sync` — the event every (re)connection opens with —
       * lands here too, which is what makes a dropped socket self-healing.
       */
      if (pendingList.current) return;
      pendingList.current = setTimeout(() => {
        pendingList.current = null;
        void loadConversations();
      }, 250);
    });

    return () => {
      unsubscribe();
      if (pendingList.current) clearTimeout(pendingList.current);
      pendingList.current = null;
    };
  }, [realtime, loadConversations]);

  // ── the read mark ─────────────────────────────────────────────────────────

  /*
   * ⚠ WHAT HAS ALREADY BEEN MARKED, so an open thread does not write on every
   * render. `markChatRead` refuses to move backwards server-side, so a repeat
   * is harmless — it is simply a request nobody needed.
   */
  const marked = useRef<string | null>(null);

  useEffect(() => {
    if (!selected || selected.myStatus !== 'active' || !messages) return;

    const mark = readMarkFor(messages, selected.myUserId);
    if (!mark || marked.current === mark.id) return;
    marked.current = mark.id;

    api
      .markRead(selected.id, mark.id)
      /*
       * ⚠ Then RE-READ the list, because the badge and the row's own count are
       * the server's answer and nothing local recomputes them. Without this the
       * unread number stays on screen while the thread it refers to is open.
       */
      .then(() => loadConversations())
      .catch(() => {
        // A read mark that did not land is not worth a banner: the count is
        // stale until the next event, and nothing the reader did has failed.
        marked.current = null;
      });
  }, [api, selected, messages, loadConversations]);

  // ── writing ───────────────────────────────────────────────────────────────

  const send = useCallback(
    async (body: string) => {
      if (!selected) return;
      const clientMessageId = newDraftId();

      /*
       * ON SCREEN FIRST. The server is idempotent on `clientMessageId`, so the
       * optimistic copy is replaced rather than duplicated when the real one
       * arrives — by id match, never by guessing from the body.
       */
      const draft = optimisticMessage({
        conversationId: selected.id,
        authorId: selected.myUserId,
        body,
        clientMessageId,
      });
      setMessages((current) => [...(current ?? []), draft]);

      try {
        const sent = await api.send({ conversationId: selected.id, body, clientMessageId });
        setMessages((current) => (current ? applyMessage(current, sent) : current));
      } catch (cause) {
        // ⚠ The draft is REMOVED. Leaving it would show a message that was
        // never sent, indistinguishable from one that was.
        setMessages((current) => (current ? dropPending(current, clientMessageId) : current));
        report(cause);
      }
    },
    [api, selected, report],
  );

  /**
   * Wraps a write: one busy flag, one error banner, one re-read.
   *
   * Every mutation on this screen changes something the server computes —
   * membership, ordering, a count — so every one of them ends by asking the
   * server what is true rather than patching state locally.
   */
  const act = useCallback(
    async <T>(work: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const result = await work();
        await loadConversations();
        return result;
      } catch (cause) {
        report(cause);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [loadConversations, report],
  );

  const startDirect = useCallback(
    async (userId: string) => {
      const conversation = await act(() => api.startDirect(userId));
      if (conversation) open(conversation.id);
      return conversation;
    },
    [act, api, open],
  );

  const startGroup = useCallback(
    async (title: string, userIds: readonly string[]) => {
      const conversation = await act(() => api.startGroup(title, userIds));
      if (conversation) open(conversation.id);
      return conversation;
    },
    [act, api, open],
  );

  const respond = useCallback(
    async (conversationId: string, accept: boolean) => {
      await act(() => api.respondToInvitation(conversationId, accept));
      /*
       * Accepting OPENS it, which is the thing somebody wanted when they
       * accepted. Declining closes whatever was on screen: the row is gone, and
       * a thread whose conversation has left the list is a view of nothing.
       */
      if (accept) open(conversationId);
      else if (selectedRef.current === conversationId) open(null);
    },
    [act, api, open],
  );

  const invite = useCallback(
    async (conversationId: string, userId: string) => {
      await act(() => api.invite(conversationId, userId));
    },
    [act, api],
  );

  const rename = useCallback(
    async (conversationId: string, title: string) => {
      // `act` re-reads the list afterwards, which is what puts the new name on
      // the row as well as in the header — the title lives on the conversation,
      // and both places read it from there rather than holding a copy.
      await act(() => api.rename(conversationId, title));
    },
    [act, api],
  );

  const setParticipantRole = useCallback(
    async (conversationId: string, userId: string, role: string) => {
      await act(() => api.setParticipantRole(conversationId, userId, role));
    },
    [act, api],
  );

  const removeParticipant = useCallback(
    async (conversationId: string, userId: string) => {
      await act(() => api.removeParticipant(conversationId, userId));
    },
    [act, api],
  );

  const setArchived = useCallback(
    async (conversationId: string, archived: boolean) => {
      await act(() => api.setArchived(conversationId, archived));
      /*
       * Archiving takes the conversation OFF the list — `splitConversations`
       * drops archived ones — so a thread left open would be a view of
       * something the list no longer offers.
       */
      if (archived && selectedRef.current === conversationId) open(null);
    },
    [act, api, open],
  );

  const leave = useCallback(
    async (conversationId: string) => {
      await act(() => api.leave(conversationId));
      if (selectedRef.current === conversationId) open(null);
    },
    [act, api, open],
  );

  const removeMessage = useCallback(
    async (messageId: string) => {
      const deleted = await act(() => api.deleteMessage(messageId));
      if (deleted) setMessages((current) => (current ? applyMessage(current, deleted) : current));
    },
    [act, api],
  );

  /**
   * "I am writing", sent while somebody is.
   *
   * ⚠ THROTTLED HERE AS WELL AS SERVER-SIDE. The server drops a repeat inside
   * its own window, but only after a round trip — and the composer calls this
   * on every keystroke. One request every few seconds is the point of the
   * feature; one per character is an attack on your own API.
   */
  const lastTyped = useRef(0);
  const noteTyping = useCallback(() => {
    const conversationId = selectedRef.current;
    if (!conversationId) return;

    const now = Date.now();
    if (now - lastTyped.current < TYPING_THROTTLE_MS) return;
    lastTyped.current = now;

    // Silently: a typing ping that did not land is not worth a banner, and the
    // indicator simply does not appear.
    api.sendTyping(conversationId).catch(() => undefined);
  }, [api]);

  const changeAvailability = useCallback(
    async (availability: string, forMinutes?: number | null) => {
      const mine = await act(() => api.setAvailability(availability, forMinutes ?? null));
      if (mine) setMyAvailability(mine);
    },
    [act, api],
  );

  const lookUp = useCallback(
    async (email: string) => {
      try {
        return await api.lookUp(email);
      } catch (cause) {
        report(cause);
        return null;
      }
    },
    [api, report],
  );

  return {
    conversations,
    selected,
    messages,
    olderCursor,
    error,
    busy,
    presence,
    myAvailability,
    /** Who is writing in the conversation on screen, excluding stale signals. */
    typingHere: typing
      .filter((one) => one.conversationId === selected?.id && Date.now() - one.at < TYPING_TTL_MS)
      .map((one) => one.userId),
    /** ⚠ Null before mount and in an app with no socket — the screen still works. */
    live: realtime !== null,
    open,
    loadOlder,
    send,
    removeMessage,
    startDirect,
    startGroup,
    respond,
    invite,
    rename,
    setParticipantRole,
    removeParticipant,
    setArchived,
    leave,
    lookUp,
    noteTyping,
    changeAvailability,
    dismissError: useCallback(() => setError(null), []),
  };
}

/**
 * ⚠ BOTH LONGER THAN THE SERVER'S OWN, deliberately.
 *
 * The indicator must outlive the gap between one ping and the next or it
 * flickers while somebody is still writing; the client's throttle must not be
 * tighter than the server's or every other request is discarded after a round
 * trip. These mirror `DEFAULT_EPHEMERAL` — a package that cannot import the
 * server's constants without dragging Nest into a browser bundle, so they are
 * written here and their relationship is what matters rather than their exact
 * values.
 */
const TYPING_TTL_MS = 6_000;
const TYPING_THROTTLE_MS = 3_000;

/**
 * An id for one draft.
 *
 * `crypto.randomUUID` where it exists — every browser this app supports — with
 * a fallback that is not cryptographic and does not need to be: this value is
 * only ever compared with the sender's own previous attempts, and the server
 * scopes uniqueness to the conversation.
 */
function newDraftId(): string {
  // `typeof`, not a truthiness check on the method: the DOM lib types it as
  // always present, so `if (crypto.randomUUID)` is a condition the compiler
  // knows is constant — and it is NOT constant at runtime, because a page
  // served over plain http has no `crypto.randomUUID` at all.
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
