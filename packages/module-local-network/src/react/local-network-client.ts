'use client';

import { LOCAL_NETWORK_OPERATIONS } from '../operations.js';
import type { LocalNetworkView } from '../types.js';
import { isLocalNetworkMissingFromApi } from './view/local-network-view.js';

/** The app's same-origin GraphQL handler, which attaches the session (module-auth's; this module may not name it). */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

/**
 * What the page is told: the API's view, or that the API has no Local Network
 * at all (its switch is off while the web app's is on). The second is not an
 * error: it is a setting to fix, and the page says which.
 */
export type LocalNetworkAnswer = { kind: 'view'; view: LocalNetworkView } | { kind: 'api_off' };

interface GraphqlBody {
  data?: { localNetwork?: LocalNetworkView } | null;
  errors?: { message: string }[];
}

/** The JSON body, or null when there is none (a proxy's HTML error page, an empty 502). */
async function readBody(response: Response): Promise<GraphqlBody | null> {
  try {
    return (await response.json()) as GraphqlBody;
  } catch {
    return null;
  }
}

/** One method per operation. */
export interface LocalNetworkClient {
  view(): Promise<LocalNetworkAnswer>;
}

export function createLocalNetworkClient(options: { graphqlPath?: string } = {}): LocalNetworkClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  return {
    async view() {
      let response: Response;
      try {
        response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ query: LOCAL_NETWORK_OPERATIONS.localNetwork, variables: {} }),
          cache: 'no-store',
        });
      } catch {
        throw new Error('Cannot reach the server.');
      }
      if (response.status === 401) throw new Error('Your session has ended. Sign in again.');
      /*
       * ⚠ The body is read BEFORE the status is judged: a query for a field
       * the schema lacks is answered 400 with GraphQL's errors in the body, and
       * that 400 is exactly how "the API's switch is off" arrives. Judging the
       * status first would turn it into "Cannot reach the server."
       */
      const body = await readBody(response);
      const message = body?.errors?.[0]?.message;
      if (message !== undefined) {
        if (isLocalNetworkMissingFromApi(message)) return { kind: 'api_off' };
        throw new Error(message);
      }
      if (!response.ok) throw new Error('Cannot reach the server.');
      const view = body?.data?.localNetwork;
      if (!view) throw new Error('The server returned no data.');
      return { kind: 'view', view };
    },
  };
}
