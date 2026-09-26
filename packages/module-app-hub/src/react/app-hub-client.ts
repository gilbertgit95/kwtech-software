'use client';

import { type AppHubLayout, readLayout } from '../domain/layout.js';
import { APP_HUB_OPERATIONS } from '../operations.js';

/**
 * How the Apps page reaches the API — through the app's same-origin route
 * handler, which attaches the session. A parameter for the reason the queue's
 * is: the handler belongs to `module-auth`, and this module may not name its
 * URL (PLAN §9). The default is where this app mounts it.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface AppHubScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface AppHubLayoutsView {
  mine: AppHubLayout | null;
  workspace: AppHubLayout | null;
}

export interface AppHubClient {
  layouts(scope: AppHubScopeView): Promise<AppHubLayoutsView>;
  saveMine(scope: AppHubScopeView, layout: AppHubLayout): Promise<void>;
  resetMine(scope: AppHubScopeView): Promise<void>;
  /** ⚠ Needs `app_hub:layout_manage`. */
  saveWorkspace(scope: AppHubScopeView, layout: AppHubLayout): Promise<void>;
  /** ⚠ Needs `app_hub:layout_manage`. */
  resetWorkspace(scope: AppHubScopeView): Promise<void>;
}

export function createAppHubClient(options: { graphqlPath?: string } = {}): AppHubClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call. Throws the API's FIRST error message, so
   * "The grid may have at most 6 cells" reaches the reader as written.
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

  const scoped = (scope: AppHubScopeView, extra: Record<string, unknown> = {}) => ({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...extra,
  });

  /** Text the server sent → a layout, or null. A stale shape reads as "none saved", never as a crash. */
  const read = (text: string | null): AppHubLayout | null => {
    if (text === null) return null;
    try {
      return readLayout(JSON.parse(text));
    } catch {
      return null;
    }
  };

  return {
    async layouts(scope) {
      const data = await graphql<{ appHubLayouts: { mine: string | null; workspace: string | null } }>(
        APP_HUB_OPERATIONS.appHubLayouts,
        scoped(scope),
      );
      return { mine: read(data.appHubLayouts.mine), workspace: read(data.appHubLayouts.workspace) };
    },
    async saveMine(scope, layout) {
      await graphql(APP_HUB_OPERATIONS.saveMyAppHubLayout, scoped(scope, { layout: JSON.stringify(layout) }));
    },
    async resetMine(scope) {
      await graphql(APP_HUB_OPERATIONS.resetMyAppHubLayout, scoped(scope));
    },
    async saveWorkspace(scope, layout) {
      await graphql(APP_HUB_OPERATIONS.saveWorkspaceAppHubLayout, scoped(scope, { layout: JSON.stringify(layout) }));
    },
    async resetWorkspace(scope) {
      await graphql(APP_HUB_OPERATIONS.resetWorkspaceAppHubLayout, scoped(scope));
    },
  };
}
