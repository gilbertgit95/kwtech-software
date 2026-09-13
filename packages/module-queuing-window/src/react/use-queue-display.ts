'use client';

import { createRealtimeConnection } from '@kwtech/module-kit/realtime';
import { playTone, unlockTones } from '@kwtech/web-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DISPLAY_PASS_PARAM } from '../domain/session.js';
import { QUEUE_OPERATIONS } from '../operations.js';
import { CALL_CHIME_MS, CALL_CHIME_PEAK, QUEUE_CALL_CHIME } from './call-chime.js';
import { createQueueClient, type QueueClient } from './queue-client.js';
import {
  codeFromFragment,
  displayStorageKeys,
  parseStoredFilter,
  parseStoredPass,
  type QueueBoardCallView,
  type QueueBoardView,
  type QueueDisplayEventView,
  type StoredDisplayPass,
  spokenCall,
} from './view/board-view.js';

/** Why the code prompt is showing, when it is not the first visit. */
export type DisplayNotice = 'stopped' | 'refused' | 'unreachable';

export type DisplayPhase =
  | { kind: 'loading' }
  | { kind: 'prompt'; notice: DisplayNotice | null }
  /** A pass is held; waiting for the one tap that unlocks sound and keeps the screen awake. */
  | { kind: 'start'; stored: StoredDisplayPass }
  | { kind: 'board'; stored: StoredDisplayPass };

export interface QueueDisplayState {
  phase: DisplayPhase;
  board: QueueBoardView | null;
  /** The latest call to stand out, and when it arrived here. */
  announced: { ticketId: string; at: number } | null;
  /** Null while connected; otherwise when this TV lost the socket. */
  disconnectedSince: number | null;
  filter: string[];
  soundReady: boolean;
  exchanging: boolean;
  exchange: (code: string) => Promise<void>;
  start: () => Promise<void>;
  enableSound: () => Promise<void>;
  setFilter: (lineIds: string[]) => void;
}

/** localStorage can throw — private mode, blocked site data — and a TV must still work. */
const storage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Without storage the TV asks for the code again after a reload. That is all.
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Nothing to remove, then.
    }
  },
};

function speak(text: string): void {
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    synth.speak(utterance);
  } catch {
    // No voice is not an error; the chime still played.
  }
}

type WakeLockSentinelLike = { release: () => Promise<void> };

async function requestWakeLock(): Promise<WakeLockSentinelLike | null> {
  const wakeLock = (
    globalThis.navigator as { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }
  )?.wakeLock;
  if (!wakeLock) return null;
  try {
    return await wakeLock.request('screen');
  } catch {
    // Refused (battery saver, a hidden tab). The board still works; the TV may sleep.
    return null;
  }
}

/**
 * The public display, start to finish:
 *
 *   prompt  no pass — type the code, or arrive with `#code=` from a QR
 *   start   a pass — one tap unlocks sound and speech and keeps the screen awake
 *   board   live, over a socket admitted by the pass
 *
 * and back to prompt when queuing stops — told by the `stopped` event, OR by the
 * handshake refusing the pass (4403) for a TV that missed the event. ⚠ Both, or
 * a TV asleep at Stop would show the last number of a stopped queue forever.
 */
export function useQueueDisplay(options: {
  organizationKey: string;
  workspaceKey: string;
  wsUrl: string | null;
  client?: QueueClient;
}): QueueDisplayState {
  const { organizationKey, workspaceKey, wsUrl } = options;
  const keys = useMemo(() => displayStorageKeys(organizationKey, workspaceKey), [organizationKey, workspaceKey]);
  const client = useMemo(() => options.client ?? createQueueClient(), [options.client]);

  const [phase, setPhase] = useState<DisplayPhase>({ kind: 'loading' });
  const [board, setBoard] = useState<QueueBoardView | null>(null);
  const [announced, setAnnounced] = useState<{ ticketId: string; at: number } | null>(null);
  const [disconnectedSince, setDisconnectedSince] = useState<number | null>(null);
  const [filter, setFilterState] = useState<string[]>([]);
  const [soundReady, setSoundReady] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);

  const end = useCallback(
    (notice: DisplayNotice) => {
      // ⚠ The pass goes; the line filter stays — see `displayStorageKeys`.
      storage.remove(keys.pass);
      setBoard(null);
      setAnnounced(null);
      setDisconnectedSince(null);
      setPhase({ kind: 'prompt', notice });
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
    },
    [keys.pass],
  );
  const endRef = useRef(end);
  endRef.current = end;

  const exchange = useCallback(
    async (code: string) => {
      setExchanging(true);
      try {
        const opened = await client.openDisplay(organizationKey, workspaceKey, code);
        if (!opened) {
          setPhase({ kind: 'prompt', notice: 'refused' });
          return;
        }
        storage.set(keys.pass, JSON.stringify(opened));
        setPhase({ kind: 'start', stored: opened });
      } catch {
        setPhase({ kind: 'prompt', notice: 'unreachable' });
      } finally {
        setExchanging(false);
      }
    },
    [client, organizationKey, workspaceKey, keys.pass],
  );

  // On arrival: a code in the fragment wins over a pass already held.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per page; `exchange` is stable for these keys.
  useEffect(() => {
    const code = codeFromFragment(globalThis.location?.hash ?? '');
    if (globalThis.location?.hash) {
      // ⚠ Out of the address bar at once, so a photo of the TV shows no code.
      globalThis.history?.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}`);
    }
    setFilterState(parseStoredFilter(storage.get(keys.filter)));
    if (code) {
      void exchange(code);
      return;
    }
    const stored = parseStoredPass(storage.get(keys.pass));
    setPhase(stored ? { kind: 'start', stored } : { kind: 'prompt', notice: null });
  }, [keys.filter, keys.pass]);

  /**
   * ⚠ MUST RUN INSIDE THE TAP. Browsers allow sound, speech and a wake lock only
   * from a user gesture; the Start display button is that gesture, and a board
   * that skipped it would chime into silence all day, looking like it works.
   */
  const start = useCallback(async () => {
    if (phase.kind !== 'start') return;
    const stored = phase.stored;
    speak('');
    setSoundReady(await unlockTones());
    wakeLock.current = await requestWakeLock();
    setPhase({ kind: 'board', stored });
  }, [phase]);

  const enableSound = useCallback(async () => {
    speak('');
    setSoundReady(await unlockTones());
  }, []);

  const setFilter = useCallback(
    (lineIds: string[]) => {
      setFilterState(lineIds);
      storage.set(keys.filter, JSON.stringify(lineIds));
    },
    [keys.filter],
  );

  // A wake lock is released whenever the page is hidden; take it again on return.
  useEffect(() => {
    if (phase.kind !== 'board') return;
    const onVisible = async () => {
      if (globalThis.document?.visibilityState === 'visible' && !wakeLock.current) {
        wakeLock.current = await requestWakeLock();
      }
    };
    globalThis.document?.addEventListener('visibilitychange', onVisible);
    return () => globalThis.document?.removeEventListener('visibilitychange', onVisible);
  }, [phase.kind]);

  const pass = phase.kind === 'board' ? phase.stored.pass : null;

  useEffect(() => {
    if (!pass || !wsUrl) return;

    const announce = (call: QueueBoardCallView) => {
      setAnnounced({ ticketId: call.ticketId, at: Date.now() });
      playTone(QUEUE_CALL_CHIME, { peak: CALL_CHIME_PEAK });
      // After the chime, not over it.
      setTimeout(() => speak(spokenCall(call)), CALL_CHIME_MS + 150);
    };

    // ⚠ The page's OWN socket — the documented exception to one per tab: the
    // app's connection mints its ticket from a session this TV does not have.
    const connection = createRealtimeConnection({
      wsUrl,
      connectionParams: () => ({ [DISPLAY_PASS_PARAM]: pass }),
      retryForever: true,
      onConnected: () => setDisconnectedSince(null),
      onClosed: (code) => {
        // ⚠ A refused reconnect IS a stop, for the TV that slept through the event.
        if (code === 4403) {
          endRef.current('stopped');
          return;
        }
        setDisconnectedSince((since) => since ?? Date.now());
      },
    });

    const unsubscribe = connection.subscribe<{ queueDisplay: QueueDisplayEventView }>(
      QUEUE_OPERATIONS.queueDisplay,
      ({ queueDisplay: event }) => {
        if (event.kind === 'stopped') {
          endRef.current('stopped');
          return;
        }
        if (event.board) setBoard(event.board);
        if (event.announce) announce(event.announce);
      },
    );

    return () => {
      unsubscribe();
      connection.close();
    };
  }, [pass, wsUrl]);

  return {
    phase,
    board,
    announced,
    disconnectedSince,
    filter,
    soundReady,
    exchanging,
    exchange,
    start,
    enableSound,
    setFilter,
  };
}
