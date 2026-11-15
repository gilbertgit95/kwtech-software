'use client';

import { useHoldsFeature, useRealtime, useRealtimeLive } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FILE_FEATURE } from '../feature-keys.js';
import { FILE_OPERATIONS } from '../operations.js';
import {
  createFileClient,
  type FileClient,
  type FileEntryView,
  type FileEventView,
  type FilePersonView,
  type FileSettingsView,
} from './file-client.js';

/** Events arrive in bursts (an upload, then a re-share): one re-read for each burst. */
const REREAD_DEBOUNCE_MS = 200;
/** How long the socket may be quiet before the page says it is not live. */
const FILES_NOT_LIVE_AFTER_MS = 10_000;

export interface FilesState {
  files: FileEntryView[] | null;
  settings: FileSettingsView | null;
  /** The people a file can be shared with. Loaded only for somebody who may share. */
  members: FilePersonView[];
  error: string | null;
  busy: boolean;
  live: boolean;
  canWrite: boolean;
  canManage: boolean;
  client: FileClient;
  scope: { organizationId: string; workspaceId: string };
  reload(): Promise<void>;
  /** Runs one act: guarded against a double submit, its failure shown, and the list read again after. */
  run(action: (client: FileClient) => Promise<void>): Promise<boolean>;
  dismissError(): void;
}

/**
 * The files app's one data hook. No client cache and no optimistic UI: after
 * every act, and on every live event, the list is read again through the
 * guarded query — which shows only what the viewer may see.
 */
export function useFiles(
  organizationId: string,
  workspaceId: string,
  options: { client?: FileClient } = {},
): FilesState {
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const client = useMemo(() => options.client ?? createFileClient(), [options.client]);
  const realtime = useRealtime();
  const live = useRealtimeLive(FILES_NOT_LIVE_AFTER_MS);
  const canWrite = useHoldsFeature(FILE_FEATURE.write);
  const canManage = useHoldsFeature(FILE_FEATURE.manage);

  const [files, setFiles] = useState<FileEntryView[] | null>(null);
  const [settings, setSettings] = useState<FileSettingsView | null>(null);
  const [members, setMembers] = useState<FilePersonView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      const [list, room] = await Promise.all([client.list(scope), client.settings(scope)]);
      setFiles(list);
      setSettings(room);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the files.');
    }
  }, [client, scope]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.list(scope), client.settings(scope)])
      .then(([list, room]) => {
        if (cancelled) return;
        setFiles(list);
        setSettings(room);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the files.');
      });
    return () => {
      cancelled = true;
    };
  }, [client, scope]);

  // The people to share with: only for somebody who may share, and the list is bound to `file:write`.
  useEffect(() => {
    if (!canWrite) return;
    let cancelled = false;
    client
      .shareableMembers(scope)
      .then((people) => {
        if (!cancelled) setMembers(people);
      })
      // Not knowing who to share with leaves "private" and "the workspace"; it is not an error to show.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, scope, canWrite]);

  useEffect(() => {
    if (!realtime) return;
    const unsubscribe = realtime.subscribe<{ fileEvents: FileEventView }>(
      FILE_OPERATIONS.fileEvents,
      () => {
        if (pending.current) return;
        pending.current = setTimeout(() => {
          pending.current = null;
          void reload();
        }, REREAD_DEBOUNCE_MS);
      },
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    );
    return () => {
      unsubscribe();
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [realtime, scope, reload]);

  const run = useCallback(
    async (action: (api: FileClient) => Promise<void>): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await action(client);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That could not be done.');
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
        await reload();
      }
    },
    [client, reload],
  );

  return {
    files,
    settings,
    members,
    error,
    busy,
    live,
    canWrite,
    canManage,
    client,
    scope,
    reload,
    run,
    dismissError: () => setError(null),
  };
}
