import type { LimitChecker } from '@kwtech/module-kit';
import { NoteResolver } from '../src/server/graphql/note.resolver.js';
import { NoteEventPublisher } from '../src/server/note.events.js';
import type { NoteEvent, NotePubSub } from '../src/server/note.pubsub.js';
import { NoteService } from '../src/server/note.service.js';
import { NoteWriteService } from '../src/server/note-write.service.js';
import type { NoteAccessCheck, NoteAuthorDirectory } from '../src/server/ports.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the service, resolver and realtime suites. */

export const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
export const OTHER_WORKSPACE = { organizationId: 'org-1', workspaceId: 'ws-2' };
export const ANA = 'user-ana';
export const BEN = 'user-ben';
export const CAL = 'user-cal';

/**
 * An engine that behaves like `graphql-subscriptions`' in-memory one: fan-out,
 * no replay. Subscribes when the iterator is created, which is a superset of the
 * real engine's "on first pull". The queue's suite has the same one — a test
 * helper is not worth a shared package.
 */
export function memoryPubSub(): NotePubSub & { sent: NoteEvent[] } {
  const listeners = new Set<(trigger: string, payload: unknown) => void>();
  const engine = {
    sent: [] as NoteEvent[],
    async publish(trigger: string, payload: unknown) {
      engine.sent.push(payload as NoteEvent);
      for (const listener of [...listeners]) listener(trigger, payload);
    },
    asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T> {
      const wanted = new Set(typeof triggers === 'string' ? [triggers] : triggers);
      const queue: T[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const listener = (trigger: string, payload: unknown) => {
        if (!wanted.has(trigger)) return;
        queue.push(payload as T);
        wake?.();
      };
      listeners.add(listener);

      const iterator: AsyncIterableIterator<T> = {
        async next(): Promise<IteratorResult<T>> {
          while (!closed && queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
          const value = queue.shift();
          return value === undefined ? { value: undefined, done: true } : { value, done: false };
        },
        async return(): Promise<IteratorResult<T>> {
          closed = true;
          listeners.delete(listener);
          wake?.();
          return { value: undefined, done: true };
        },
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
      return iterator;
    },
  };
  return engine;
}

export interface HarnessOptions {
  limits?: LimitChecker;
  /** Who holds `note:manage_all`. Omitted: the port is UNBOUND. */
  managers?: readonly string[];
  directory?: NoteAuthorDirectory;
}

export function harness(options: HarnessOptions = {}) {
  const prisma: FakeClient = fakeClient();
  const pubsub = memoryPubSub();
  const accessCalls: string[] = [];
  const access: NoteAccessCheck | undefined = options.managers
    ? {
        async holdsManageAll(_organizationId, _workspaceId, userId) {
          accessCalls.push(userId);
          return options.managers?.includes(userId) ?? false;
        },
      }
    : undefined;

  const events = new NoteEventPublisher(pubsub);
  const reads = new NoteService(prisma, options.directory);
  const writes = new NoteWriteService(prisma, events, options.limits, access);
  const resolver = new NoteResolver(reads, writes, { resolveActorId: (request) => request as string }, pubsub);

  return { prisma, pubsub, reads, writes, resolver, accessCalls };
}
