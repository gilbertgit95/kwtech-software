'use client';

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import type { RealtimeConnection, RealtimeStatusSnapshot } from '../realtime.js';

/**
 * ONE socket per tab, owned by the app, read by every module.
 *
 * ## Why a context rather than a prop
 *
 * A module page is rendered by the app's catch-all route, which is a SERVER
 * component: it can pass `params` and `searchParams` and nothing else, because
 * a live WebSocket is not serialisable. So the connection cannot be threaded
 * down as a prop from where it is created. It is put in a client context here,
 * above both shells, and any client component in any module reads it.
 *
 * Pages keep their explicit `realtime` prop where they have one — a prop is
 * clearer, and it is what a test supplies — and fall back to this. The two
 * cannot disagree: whoever passes the prop passes the same connection.
 *
 * ## Why the app supplies a FACTORY and not a connection
 *
 * Because `createRealtimeConnection` imports `graphql-ws`, and this file is in
 * the `/react` barrel that every module page reaches. Importing it here would
 * make a WebSocket client a hard dependency of naming a provider. The app
 * imports the subpath, hands over a `() => RealtimeConnection`, and the import
 * stays where the decision is (PLAN §12.39).
 *
 * ⚠ And the factory is called in an EFFECT, never during render. A client
 * component still renders on the server, and constructing a socket client there
 * is at best wasted and at worst a reference to a `WebSocket` that does not
 * exist. So `useRealtime()` returns null until the app has mounted — which
 * every consumer already handles, because it is also what a subscriber sees in
 * an app that mounts no provider at all.
 */
const RealtimeContext = createContext<RealtimeConnection | null>(null);

export interface RealtimeProviderProps {
  children: ReactNode;
  /**
   * Opens the connection. Called ONCE, on mount, on the client only.
   *
   * Omitted, this provider supplies nothing and every subscriber goes quiet —
   * the correct behaviour for an app with no socket, and the reason a module
   * may subscribe without the app having to.
   *
   * `| undefined` written out because of `exactOptionalPropertyTypes`: an app
   * that decides at runtime whether it has a socket passes `undefined`, and
   * without this that assignment does not compile.
   */
  connect?: (() => RealtimeConnection) | undefined;
}

export function RealtimeProvider({ children, connect }: RealtimeProviderProps) {
  const [connection, setConnection] = useState<RealtimeConnection | null>(null);

  useEffect(() => {
    if (!connect) return;
    const opened = connect();
    setConnection(opened);

    /*
     * ⚠ THE APP CLOSES IT, and only here. A module that closed the connection
     * when its own page unmounted would take every other module's subscription
     * down with it — the failure this whole file exists to prevent, arriving
     * from the other direction.
     */
    return () => {
      setConnection(null);
      opened.close();
    };
    // `connect` is expected to be stable; a new identity reopens the socket,
    // which is what a changed URL should do and what nothing else should.
  }, [connect]);

  return <RealtimeContext.Provider value={connection}>{children}</RealtimeContext.Provider>;
}

/**
 * The app's connection, or null.
 *
 * Null is an ORDINARY answer, not an error: before mount, and in any app that
 * wires no socket. Every caller is expected to be an effect that simply does
 * not subscribe — realtime is an enhancement over screens that already read
 * over HTTP.
 */
export function useRealtime(): RealtimeConnection | null {
  return useContext(RealtimeContext);
}

/**
 * Where the app's socket stands, or null when there is no socket to ask about.
 *
 * Null covers three ordinary cases, and a caller treats them alike — "nothing
 * to report": before mount, an app that wires no socket, and a connection that
 * does not report status (a hand-written one; see `RealtimeConnection.status`).
 *
 * ⚠ One answer for every module. A module that decided "live" from whether its
 * own events were arriving could not tell a quiet stream from a dead one; the
 * connection knows, because it sees the socket's own lifecycle.
 */
export function useRealtimeStatus(): RealtimeStatusSnapshot | null {
  const connection = useRealtime();
  const [snapshot, setSnapshot] = useState<RealtimeStatusSnapshot | null>(() => connection?.status?.() ?? null);

  useEffect(() => {
    if (!connection?.status || !connection.onStatus) {
      setSnapshot(null);
      return;
    }
    // Read once on (re)subscribe: the status may have moved between render and
    // this effect, and a listener only hears about changes after it is added.
    setSnapshot(connection.status());
    return connection.onStatus(setSnapshot);
  }, [connection]);

  return snapshot;
}
