'use client';

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { effectiveAlertTones } from '../domain/alert-tones.js';
import { createTonePlayer, type PosTonePlayer } from './tone-player.js';
import type { TillState } from './use-till.js';
import { alertMomentFor, POS_HIGHLIGHT_MS, type PosOrderChange, pendingChanges } from './view/order-changes.js';

export interface OrderAlerts {
  /** The waiting orders lit right now, and how each changed. */
  highlights: ReadonlyMap<string, PosOrderChange>;
  /** True while order sounds are on but the browser has not allowed sound yet: ask for one tap. */
  soundBlocked: boolean;
}

/**
 * Draws the eye to the waiting orders that changed (issue #68), and sounds for
 * them, on the CASHIER screens only — the hook lives in them, so Classic, Take
 * orders and every other tab never sound.
 *
 * - **What changed** is `pendingChanges` between two reads of `state.pending`;
 *   the first read is the baseline and lights nothing. This till's own
 *   changes never count (`own`, the versions it has had on it).
 * - **Each card stays lit `POS_HIGHLIGHT_MS`**, then fades.
 * - **One sound per read** (`alertMomentFor`), the person's or the store's
 *   (`effectiveAlertTones`), and ⚠ ONLY WHILE THE SCREEN CAN BE SEEN: the
 *   window visible, and `root` drawn — the Apps page keeps a hidden app
 *   mounted, and a hidden Cashier must stay quiet.
 * - **Sound needs one tap first** (browsers' rule): `soundBlocked` says so,
 *   and any tap on the page then allows it.
 */
export function useOrderAlerts(state: TillState, root: RefObject<HTMLElement | null>): OrderAlerts {
  const player = useRef<PosTonePlayer | null>(null);
  const previous = useRef<TillState['pending'] | null>(null);
  /** The latest version of each order this till has had on it: its own changes, never news. */
  const own = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [highlights, setHighlights] = useState<ReadonlyMap<string, PosOrderChange>>(new Map());
  const [blocked, setBlocked] = useState(false);
  const tones = effectiveAlertTones(state.alertTones.store, state.alertTones.mine);
  const anyOn = tones.newOrder.on || tones.updatedOrder.on;
  const tonesRef = useRef(tones);
  tonesRef.current = tones;

  // One player for the screen's life; its audio device is let go when the screen closes.
  useEffect(() => {
    player.current = createTonePlayer();
    return () => {
      player.current?.close();
      player.current = null;
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  // Recorded on every order the till shows, so the write that answered an act is known before the list re-reads.
  const order = state.order;
  useEffect(() => {
    if (!order) return;
    const seen = own.current.get(order.id);
    if (seen === undefined || order.version > seen) own.current.set(order.id, order.version);
  }, [order]);

  const audible = useCallback((): boolean => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
    const element = root.current;
    if (!element) return false;
    // `checkVisibility` is false inside a hidden tab of the Apps page; older browsers lack it and are treated as shown.
    return typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;
  }, [root]);

  const pending = state.pending;
  useEffect(() => {
    const changes = pendingChanges(previous.current, pending, own.current);
    previous.current = pending;
    if (changes.size === 0) return;

    setHighlights((current) => new Map([...current, ...changes]));
    for (const id of changes.keys()) {
      const running = timers.current.get(id);
      if (running) clearTimeout(running);
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setHighlights((current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
          });
        }, POS_HIGHLIGHT_MS),
      );
    }

    const moment = alertMomentFor(changes);
    const sound = moment ? tonesRef.current[moment] : null;
    if (!sound?.on || !audible()) return;
    const played = player.current?.play(sound.tone, sound.volume) ?? false;
    if (!played) setBlocked(player.current?.blocked() ?? false);
  }, [pending, audible]);

  /*
   * Whether to ask for a tap: only with a sound on, and only while the browser
   * still blocks it. Checked on arrival — a page somebody already tapped is
   * allowed at once — and any tap then unlocks it.
   */
  useEffect(() => {
    if (!anyOn) {
      setBlocked(false);
      return;
    }
    setBlocked(player.current?.blocked() ?? false);
    const onTap = () => {
      void player.current?.unlock().then(() => setBlocked(player.current?.blocked() ?? false));
    };
    window.addEventListener('pointerdown', onTap);
    window.addEventListener('keydown', onTap);
    return () => {
      window.removeEventListener('pointerdown', onTap);
      window.removeEventListener('keydown', onTap);
    };
  }, [anyOn]);

  return { highlights, soundBlocked: anyOn && blocked };
}
