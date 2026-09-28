import type { LimitChecker } from '@kwtech/module-kit';
import { TaskBoardService } from '../src/server/board.service.js';
import { TaskResolver } from '../src/server/graphql/task.resolver.js';
import type {
  TaskAccessCheck,
  TaskMember,
  TaskMemberDirectory,
  TaskNotice,
  TaskNotifier,
} from '../src/server/ports.js';
import { TaskEventPublisher } from '../src/server/task.events.js';
import type { TaskEvent, TaskPubSub } from '../src/server/task.pubsub.js';
import { TaskService } from '../src/server/task.service.js';
import { TaskCommentService } from '../src/server/task-comment.service.js';
import { TaskWriteService } from '../src/server/task-write.service.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the service, resolver and realtime suites. */

export const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
export const OTHER_WORKSPACE = { organizationId: 'org-1', workspaceId: 'ws-2' };
export const ANA = 'user-ana';
export const BEN = 'user-ben';
export const CAL = 'user-cal';

/** An engine like `graphql-subscriptions`' in-memory one: fan-out, no replay. */
export function memoryPubSub(): TaskPubSub & { sent: TaskEvent[] } {
  const listeners = new Set<(trigger: string, payload: unknown) => void>();
  const engine = {
    sent: [] as TaskEvent[],
    async publish(trigger: string, payload: unknown) {
      engine.sent.push(payload as TaskEvent);
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
  /** Who holds `task:assign`. Omitted: the access port is UNBOUND. */
  assigners?: readonly string[];
  /** Who holds `task:manage_all`. */
  managers?: readonly string[];
  /** The workspace's active members who may be assigned. Omitted: the directory is UNBOUND. */
  members?: readonly string[];
  /** Omitted: the notifier is UNBOUND. */
  notify?: boolean;
}

export function harness(options: HarnessOptions = {}) {
  const prisma: FakeClient = fakeClient();
  const pubsub = memoryPubSub();
  const access: TaskAccessCheck | undefined =
    options.assigners || options.managers
      ? {
          async holdsAssign(_organizationId, _workspaceId, userId) {
            return (options.assigners ?? []).includes(userId);
          },
          async holdsManageAll(_organizationId, _workspaceId, userId) {
            return (options.managers ?? []).includes(userId);
          },
        }
      : undefined;
  const directory: TaskMemberDirectory | undefined = options.members
    ? {
        async listAssignable(): Promise<readonly TaskMember[]> {
          return (options.members ?? []).map((userId) => ({ userId, displayName: userId.replace('user-', '') }));
        },
        async activeMembers(_organizationId, _workspaceId, userIds) {
          return new Set(userIds.filter((userId) => (options.members ?? []).includes(userId)));
        },
        async describe(userIds) {
          return userIds.map((userId) => ({ userId, displayName: userId.replace('user-', '') }));
        },
      }
    : undefined;
  const notices: Array<{ kind: 'assigned' | 'commented'; notice: TaskNotice }> = [];
  const notifier: TaskNotifier | undefined = options.notify
    ? {
        async assigned(notice) {
          notices.push({ kind: 'assigned', notice });
        },
        async commented(notice) {
          notices.push({ kind: 'commented', notice });
        },
      }
    : undefined;

  const events = new TaskEventPublisher(pubsub);
  const boards = new TaskBoardService(prisma, events, options.limits, directory);
  const tasks = new TaskService(prisma, directory);
  const writes = new TaskWriteService(prisma, events, options.limits, access, directory, notifier);
  const comments = new TaskCommentService(prisma, events, access, notifier);
  const resolver = new TaskResolver(
    boards,
    tasks,
    writes,
    comments,
    { resolveActorId: (req) => req as string },
    pubsub,
  );
  return { prisma, pubsub, boards, tasks, writes, comments, resolver, notices };
}

/** A board with the default columns, owned by `ownerId`. */
export async function boardOf(h: ReturnType<typeof harness>, ownerId: string, visibility = 'workspace') {
  const { board, columns } = await h.boards.create(SCOPE, ownerId, { name: `${ownerId}'s board`, visibility });
  const [todo, doing, done] = columns;
  if (!todo || !doing || !done) throw new Error('default columns missing');
  return { board, todo, doing, done };
}
