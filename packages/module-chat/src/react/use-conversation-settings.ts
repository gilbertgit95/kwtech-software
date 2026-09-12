'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isChatParticipantRole } from '../domain/participant-roles.js';
import type { ChatParticipantRole, ParticipantView } from '../types.js';
import { type ChatClient, type ChatConversationView, createChatClient } from './chat-client.js';

/**
 * One conversation, for the screen that is about it rather than about the list.
 *
 * ## Why this is not `useChat`
 *
 * `useChat` loads every conversation, opens the socket, resolves presence and
 * follows a thread. A settings page needs one conversation and six writes, and
 * reusing the list hook would have it subscribe, poll presence and hold a
 * message thread for a screen with no messages on it.
 *
 * ⚠ IT RE-READS AFTER EVERY WRITE rather than patching what it holds. Every act
 * here changes what the SERVER will allow next — promoting somebody changes who
 * may remove whom, transferring ownership rewrites two rows in one move — and a
 * local patch would be a second implementation of rules that already exist.
 */
export function useConversationSettings(conversationId: string, options: { client?: ChatClient } = {}) {
  const api = useMemo(() => options.client ?? createChatClient(), [options.client]);

  const [conversation, setConversation] = useState<ChatConversationView | null>(null);
  /** Distinct from `conversation === null`, which is also "not loaded yet". */
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await api.getConversation(conversationId);
      setConversation(found);
      /*
       * ⚠ NULL IS NOT AN ERROR. The server answers "no such conversation" to a
       * non-participant and to a stranger alike, so a settings page for
       * somebody else's group is a not-found rather than a hint that it exists.
       */
      setMissing(found === null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this conversation.');
    }
  }, [api, conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        await load();
      } catch (cause) {
        // The SERVER's own sentence: "The owner of a conversation cannot be
        // removed" says exactly what is wrong, and a generic message would
        // throw away the only useful thing in the response.
        setError(cause instanceof Error ? cause.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /**
   * The participants as the RULES see them.
   *
   * ⚠ The same domain functions the server enforces with — imported, never
   * restated. C1's exact failure was a helper that existed, was used by the
   * React layer, and was never called server-side; this is the same helper
   * called on both sides, and the screen being wrong can only ever mean showing
   * a control the API then refuses, never the reverse.
   */
  const participants: ParticipantView[] = useMemo(
    () =>
      (conversation?.participants ?? []).map((one) => ({
        conversationId,
        userId: one.userId,
        status: one.status as ParticipantView['status'],
        role: isChatParticipantRole(one.role) ? one.role : 'member',
      })),
    [conversation, conversationId],
  );

  const me = useMemo(
    () => participants.find((one) => one.userId === conversation?.myUserId),
    [participants, conversation],
  );

  return {
    conversation,
    participants,
    me,
    missing,
    error,
    busy,
    dismissError: useCallback(() => setError(null), []),
    reload: load,
    rename: useCallback((title: string) => act(() => api.rename(conversationId, title)), [act, api, conversationId]),
    invite: useCallback((userId: string) => act(() => api.invite(conversationId, userId)), [act, api, conversationId]),
    setRole: useCallback(
      (userId: string, role: ChatParticipantRole) => act(() => api.setParticipantRole(conversationId, userId, role)),
      [act, api, conversationId],
    ),
    remove: useCallback(
      (userId: string) => act(() => api.removeParticipant(conversationId, userId)),
      [act, api, conversationId],
    ),
    setArchived: useCallback(
      (archived: boolean) => act(() => api.setArchived(conversationId, archived)),
      [act, api, conversationId],
    ),
    leave: useCallback(() => act(() => api.leave(conversationId)), [act, api, conversationId]),
    lookUp: useCallback((email: string) => api.lookUp(email), [api]),
  };
}
