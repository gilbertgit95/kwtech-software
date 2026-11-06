'use client';

import { LOCAL_NETWORK_OPERATIONS } from '../operations.js';
import type { LocalNetworkView } from '../types.js';

/** The app's same-origin GraphQL handler, which attaches the session (module-auth's; this module may not name it). */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

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
  /** The API's answer. Its switch being off is an ordinary answer, `state: 'off'`, never an error. */
  view(): Promise<LocalNetworkView>;
}

/**
 * The page's client: one method per operation, errors as sentences a person
 * can read ("Cannot reach the server."). Through the app's same-origin
 * GraphQL handler, which attaches the session; the browser never calls the
 * API directly.
 */
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
       * The body is read BEFORE the status is judged: GraphQL answers a
       * document the schema refuses with a 400 and its reason in the body, and
       * that reason ("Cannot query field …", from a web app built against
       * another API) says more than "Cannot reach the server."
       */
      const body = await readBody(response);
      const message = body?.errors?.[0]?.message;
      if (message !== undefined) throw new Error(message);
      if (!response.ok) throw new Error('Cannot reach the server.');
      const view = body?.data?.localNetwork;
      if (!view) throw new Error('The server returned no data.');
      return view;
    },
  };
}
