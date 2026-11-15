import { Readable } from 'node:stream';
import type { LimitChecker } from '@kwtech/module-kit';
import { FileEventPublisher } from '../src/server/file.events.js';
import type { FileModuleOptions } from '../src/server/file.options.js';
import type { FileEvent, FilePubSub } from '../src/server/file.pubsub.js';
import { FileService } from '../src/server/file.service.js';
import { FileCleanupProcess } from '../src/server/file-cleanup.process.js';
import { FileTransferService } from '../src/server/file-transfer.service.js';
import { FileWriteService } from '../src/server/file-write.service.js';
import type {
  FileMember,
  FileMemberDirectory,
  FileNotifier,
  FileSharedNotice,
  FileStore,
  FileStoreEntry,
} from '../src/server/ports.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the service, process and realtime suites. */

export const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
export const OTHER_WORKSPACE = { organizationId: 'org-1', workspaceId: 'ws-2' };
export const ANA = 'user-ana';
export const BEN = 'user-ben';
export const CAL = 'user-cal';

export const MEMBERS: readonly FileMember[] = [
  { userId: ANA, displayName: 'Ana' },
  { userId: BEN, displayName: 'Ben' },
  { userId: CAL, displayName: 'Cal' },
];

/** The store in memory: what `createFolderFileStore` promises, without a disk. */
export function memoryStore(): FileStore & { bytes: Map<string, Buffer>; touched: Map<string, Date> } {
  const bytes = new Map<string, Buffer>();
  const touched = new Map<string, Date>();
  const keyOf = (workspaceId: string, storageKey: string) => `${workspaceId}/${storageKey}`;
  return {
    bytes,
    touched,
    async write(workspaceId, storageKey, source, maxBytes) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of source) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        size += buffer.length;
        if (size > maxBytes) return { kind: 'too_large' };
        chunks.push(buffer);
      }
      bytes.set(keyOf(workspaceId, storageKey), Buffer.concat(chunks));
      touched.set(keyOf(workspaceId, storageKey), new Date('2026-11-16T04:00:00.000Z'));
      return { kind: 'stored', sizeBytes: size };
    },
    async open(workspaceId, storageKey) {
      const held = bytes.get(keyOf(workspaceId, storageKey));
      return held ? { stream: Readable.from([held]), sizeBytes: held.length } : null;
    },
    async remove(workspaceId, storageKey) {
      bytes.delete(keyOf(workspaceId, storageKey));
      touched.delete(keyOf(workspaceId, storageKey));
    },
    async list(workspaceId) {
      const entries: FileStoreEntry[] = [];
      for (const [key, at] of touched) {
        const [workspace, storageKey] = key.split('/');
        if (workspace === workspaceId && storageKey) entries.push({ storageKey, partial: false, modifiedAt: at });
      }
      return entries;
    },
  };
}

/** An engine like `graphql-subscriptions`' in-memory one, recording what was sent. */
export function memoryPubSub(): FilePubSub & { sent: FileEvent[] } {
  const engine = {
    sent: [] as FileEvent[],
    async publish(_trigger: string, payload: unknown) {
      engine.sent.push(payload as FileEvent);
    },
    async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
      // The realtime suite tests the filter, not the engine.
    },
  };
  return engine;
}

export function directory(members: readonly FileMember[] = MEMBERS): FileMemberDirectory {
  return {
    async listShareable() {
      return members;
    },
    async describe(userIds) {
      return members.filter((member) => userIds.includes(member.userId));
    },
  };
}

export function recordingNotifier(): FileNotifier & { sent: FileSharedNotice[] } {
  const notifier = {
    sent: [] as FileSharedNotice[],
    async shared(event: FileSharedNotice) {
      notifier.sent.push(event);
    },
  };
  return notifier;
}

/** A checker that answers fixed caps, in MB, and records nothing. */
export function fixedCaps(caps: Record<string, number | null>): LimitChecker {
  return {
    async check({ key, current }) {
      const limit = caps[key] ?? null;
      return { allowed: true, limit, current, remaining: limit };
    },
  };
}

export interface Harness {
  client: FakeClient;
  store: ReturnType<typeof memoryStore>;
  pubsub: ReturnType<typeof memoryPubSub>;
  notifier: ReturnType<typeof recordingNotifier>;
  files: FileService;
  writes: FileWriteService;
  transfers: FileTransferService;
  cleanup: FileCleanupProcess;
}

export function harness(
  options: {
    limits?: LimitChecker;
    members?: readonly FileMember[] | null;
    store?: FileStore | null;
    moduleOptions?: FileModuleOptions;
  } = {},
): Harness {
  const client = fakeClient();
  const store = memoryStore();
  const pubsub = memoryPubSub();
  const notifier = recordingNotifier();
  const members = options.members === null ? undefined : directory(options.members ?? MEMBERS);
  const boundStore = options.store === null ? undefined : (options.store ?? store);
  const events = new FileEventPublisher(pubsub);
  const files = new FileService(client, options.limits, members);
  const writes = new FileWriteService(client, files, events, boundStore, members, notifier);
  const transfers = new FileTransferService(client, files, writes, options.moduleOptions ?? {}, boundStore);
  const cleanup = new FileCleanupProcess(client, files, events, boundStore);
  return { client, store, pubsub, notifier, files, writes, transfers, cleanup };
}

/** Uploads `content` as `actorId` through both halves, as the browser would. */
export async function uploadAs(
  h: Harness,
  actorId: string,
  name: string,
  content: string,
  sharing: { visibility: string; sharedWith?: string[] } = { visibility: 'private' },
  scope = SCOPE,
) {
  const now = h.client.now;
  const { ticket } = await h.transfers.startUpload(
    scope,
    actorId,
    {
      name,
      sizeBytes: Buffer.byteLength(content),
      visibility: sharing.visibility,
      sharedWith: sharing.sharedWith ?? [],
    },
    now,
  );
  return h.transfers.upload(ticket, Readable.from([Buffer.from(content)]), now);
}
