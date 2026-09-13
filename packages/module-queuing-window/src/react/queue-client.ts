'use client';

import { QUEUE_OPERATIONS } from '../operations.js';

/**
 * How the queue's screens reach the API — through the app's same-origin route
 * handler, which attaches the session. The path is a parameter for the reason
 * chat's is: that handler belongs to `module-auth`, and this module may not name
 * its URL (PLAN §9). The default is where this app mounts it.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface QueueScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface QueueTicketView {
  id: string;
  lineId: string;
  label: string;
  number: number;
  cycle: number;
  /** 'called' | 'done' | 'no_show'. */
  status: string;
  windowId: string;
  windowName: string;
  calledAt: string;
  recallCount: number;
}

export interface QueueLineView {
  id: string;
  name: string;
  prefix: string;
  startNumber: number;
  endNumber: number;
  padTo: number;
  sortOrder: number;
  archived: boolean;
}

export interface QueueWindowView {
  id: string;
  name: string;
  sortOrder: number;
  archived: boolean;
  /** Empty means the window calls from every line. */
  lineIds: string[];
}

export interface QueueSeatView {
  windowId: string;
  userId: string;
  displayName: string;
  /** False when the holder can no longer serve here. Null when the server cannot tell. */
  canServe: boolean | null;
  nickname: string | null;
}

export interface QueueSessionView {
  id: string;
  startedAt: string;
  startedById: string;
  continuedNumbering: boolean;
  codeLocked: boolean;
}

export interface QueueConsoleView {
  settings: { enabled: boolean; showStaffNames: boolean };
  session: QueueSessionView | null;
  lines: QueueLineView[];
  windows: QueueWindowView[];
  seats: QueueSeatView[];
  /** Who is asking. */
  myUserId: string;
  myWindowId: string | null;
  myNickname: string | null;
  serving: QueueTicketView[];
  recent: QueueTicketView[];
}

export interface QueueDisplayCodeView {
  /** Formatted: `K7QM-4XHT`. */
  code: string;
  activeDisplays: number;
  maxDisplays: number;
  failedCodeAttempts: number;
  locked: boolean;
  displayPath: string | null;
}

export interface QueueStaffMemberView {
  userId: string;
  displayName: string;
}

export interface QueueEventView {
  kind: string;
  change: string | null;
  ticket: QueueTicketView | null;
}

export interface QueueLineInput {
  name?: string | null;
  prefix?: string;
  startNumber?: number | null;
  endNumber?: number | null;
  padTo?: number | null;
  sortOrder?: number | null;
}

export interface QueueClient {
  console(scope: QueueScopeView): Promise<QueueConsoleView>;
  displayCode(scope: QueueScopeView): Promise<QueueDisplayCodeView | null>;
  staffCandidates(scope: QueueScopeView): Promise<QueueStaffMemberView[]>;

  startQueue(scope: QueueScopeView, continueNumbering: boolean): Promise<void>;
  stopQueue(scope: QueueScopeView): Promise<void>;
  setShowStaffNames(scope: QueueScopeView, show: boolean): Promise<void>;

  /** ⚠ Pass a FRESH `clientRequestId` per press, so a retried request never skips a number. */
  callNext(scope: QueueScopeView, lineId: string, clientRequestId: string): Promise<QueueTicketView>;
  callNumber(scope: QueueScopeView, lineId: string, number: number): Promise<QueueTicketView>;
  recall(scope: QueueScopeView, ticketId: string): Promise<void>;
  complete(scope: QueueScopeView, ticketId: string): Promise<void>;
  noShow(scope: QueueScopeView, ticketId: string): Promise<void>;

  assignWindow(scope: QueueScopeView, windowId: string, userId: string, confirmReplace: boolean): Promise<void>;
  freeWindow(scope: QueueScopeView, windowId: string): Promise<void>;
  releaseMySeat(scope: QueueScopeView): Promise<void>;

  createWindow(scope: QueueScopeView, name: string): Promise<void>;
  renameWindow(scope: QueueScopeView, windowId: string, name: string): Promise<void>;
  setWindowLines(scope: QueueScopeView, windowId: string, lineIds: string[]): Promise<void>;
  setWindowArchived(scope: QueueScopeView, windowId: string, archived: boolean): Promise<void>;

  createLine(scope: QueueScopeView, input: QueueLineInput & { name: string; prefix: string }): Promise<void>;
  updateLine(scope: QueueScopeView, lineId: string, input: QueueLineInput): Promise<void>;
  setLineArchived(scope: QueueScopeView, lineId: string, archived: boolean): Promise<void>;
  setLineNextNumber(scope: QueueScopeView, lineId: string, next: number): Promise<void>;

  setMyNickname(scope: QueueScopeView, nickname: string): Promise<void>;
  clearMyNickname(scope: QueueScopeView): Promise<void>;
  clearNickname(scope: QueueScopeView, userId: string): Promise<void>;

  /**
   * A TV's code, for a pass. ⚠ NULL for every refusal — the page may say only
   * `DISPLAY_CODE_REFUSAL_MESSAGE`. Public: sent with no session.
   */
  openDisplay(
    organizationKey: string,
    workspaceKey: string,
    code: string,
  ): Promise<{ pass: string; workspaceName: string } | null>;
}

export function createQueueClient(options: { graphqlPath?: string } = {}): QueueClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call. Throws the API's FIRST error message:
   * the refusals are written for a reader ("You are not assigned a window"),
   * and a generic "Something went wrong" would throw that away.
   */
  async function graphql<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ query: document, variables }),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  const scoped = (scope: QueueScopeView, extra: Record<string, unknown> = {}) => ({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...extra,
  });
  const ops = QUEUE_OPERATIONS;

  return {
    async console(scope) {
      return (await graphql<{ queueConsole: QueueConsoleView }>(ops.queueConsole, scoped(scope))).queueConsole;
    },
    async displayCode(scope) {
      return (await graphql<{ queueDisplayCode: QueueDisplayCodeView | null }>(ops.queueDisplayCode, scoped(scope)))
        .queueDisplayCode;
    },
    async staffCandidates(scope) {
      return (await graphql<{ queueStaffCandidates: QueueStaffMemberView[] }>(ops.queueStaffCandidates, scoped(scope)))
        .queueStaffCandidates;
    },

    async startQueue(scope, continueNumbering) {
      await graphql(ops.startQueue, scoped(scope, { continueNumbering }));
    },
    async stopQueue(scope) {
      await graphql(ops.stopQueue, scoped(scope));
    },
    async setShowStaffNames(scope, show) {
      await graphql(ops.setQueueShowStaffNames, scoped(scope, { show }));
    },

    async callNext(scope, lineId, clientRequestId) {
      return (
        await graphql<{ callNextQueueTicket: QueueTicketView }>(
          ops.callNextQueueTicket,
          scoped(scope, { lineId, clientRequestId }),
        )
      ).callNextQueueTicket;
    },
    async callNumber(scope, lineId, number) {
      return (
        await graphql<{ callQueueNumber: QueueTicketView }>(ops.callQueueNumber, scoped(scope, { lineId, number }))
      ).callQueueNumber;
    },
    async recall(scope, ticketId) {
      await graphql(ops.recallQueueTicket, scoped(scope, { ticketId }));
    },
    async complete(scope, ticketId) {
      await graphql(ops.completeQueueTicket, scoped(scope, { ticketId }));
    },
    async noShow(scope, ticketId) {
      await graphql(ops.markQueueTicketNoShow, scoped(scope, { ticketId }));
    },

    async assignWindow(scope, windowId, userId, confirmReplace) {
      await graphql(ops.assignQueueWindow, scoped(scope, { windowId, userId, confirmReplace }));
    },
    async freeWindow(scope, windowId) {
      await graphql(ops.freeQueueWindow, scoped(scope, { windowId }));
    },
    async releaseMySeat(scope) {
      await graphql(ops.releaseMyQueueSeat, scoped(scope));
    },

    async createWindow(scope, name) {
      await graphql(ops.createQueueWindow, scoped(scope, { name }));
    },
    async renameWindow(scope, windowId, name) {
      await graphql(ops.updateQueueWindow, scoped(scope, { windowId, name }));
    },
    async setWindowLines(scope, windowId, lineIds) {
      await graphql(ops.setQueueWindowLines, scoped(scope, { windowId, lineIds }));
    },
    async setWindowArchived(scope, windowId, archived) {
      await graphql(ops.setQueueWindowArchived, scoped(scope, { windowId, archived }));
    },

    async createLine(scope, input) {
      await graphql(ops.createQueueLine, scoped(scope, { ...input }));
    },
    async updateLine(scope, lineId, input) {
      await graphql(ops.updateQueueLine, scoped(scope, { lineId, ...input }));
    },
    async setLineArchived(scope, lineId, archived) {
      await graphql(ops.setQueueLineArchived, scoped(scope, { lineId, archived }));
    },
    async setLineNextNumber(scope, lineId, next) {
      await graphql(ops.setQueueLineNextNumber, scoped(scope, { lineId, next }));
    },

    async setMyNickname(scope, nickname) {
      await graphql(ops.setMyQueueNickname, scoped(scope, { nickname }));
    },
    async clearMyNickname(scope) {
      await graphql(ops.clearMyQueueNickname, scoped(scope));
    },
    async clearNickname(scope, userId) {
      await graphql(ops.clearQueueNickname, scoped(scope, { userId }));
    },

    async openDisplay(organizationKey, workspaceKey, code) {
      const data = await graphql<{ openQueueDisplay: { pass: string; workspaceName: string } | null }>(
        ops.openQueueDisplay,
        { organizationKey, workspaceKey, code },
      );
      return data.openQueueDisplay;
    },
  };
}
