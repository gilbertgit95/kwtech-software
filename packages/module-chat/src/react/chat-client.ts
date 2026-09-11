'use client';

/**
 * How chat's screens reach the API.
 *
 * ## Why the module cannot just call the API
 *
 * The browser has no route to it. `API_URL` is deliberately not `NEXT_PUBLIC_`
 * — publishing the API origin to every visitor is what the httpOnly-cookie
 * design exists to avoid — so every call goes through a route handler on the
 * app's own origin, which attaches the bearer token from the cookie.
 *
 * ## Why the path is a PARAMETER and not a constant
 *
 * That route handler belongs to `@kwtech/module-auth`, and these two modules
 * may not know about each other (PLAN §9). Hardcoding it here would be this
 * module naming the other one's URL — the same coupling the seam avoids,
 * smuggled in as a string instead of an import. So the default is the path this
 * app happens to mount, and any app that mounts it elsewhere passes its own.
 * Apps configure; modules do not guess.
 *
 * ⚠ The identical arrangement, and the identical default, as
 * `module-permissions`' client. Two modules agreeing on a default is not
 * coupling: neither reads the other's, and an app that moves the endpoint tells
 * both.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

/** A participant as the screens read one. */
export interface ChatParticipantView {
  userId: string;
  displayName: string;
  /** 'invited' | 'active'. Nobody else is ever listed. */
  status: string;
}

/** One conversation in the viewer's list. Mirrors `ChatConversationType`. */
export interface ChatConversationView {
  id: string;
  title: string | null;
  icon: string | null;
  isDirect: boolean;
  createdById: string;
  archived: boolean;
  lastMessageAt: string | null;
  /** The VIEWER's own standing: 'active' or 'invited'. */
  myStatus: string;
  unread: number;
  participants: ChatParticipantView[];
}

export interface ChatClient {
  listConversations(): Promise<ChatConversationView[]>;
}

const CONVERSATION_FIELDS = `
  id
  title
  icon
  isDirect
  createdById
  archived
  lastMessageAt
  myStatus
  unread
  participants { userId displayName status }
`;

export function createChatClient(options: { graphqlPath?: string } = {}): ChatClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call.
   *
   * Throws on `errors` so each caller writes one happy path, and surfaces the
   * FIRST error's message rather than a generic one: the API's refusals are
   * already written for a reader, and replacing them with "Something went
   * wrong" throws away the only useful thing in the response.
   */
  async function graphql<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The session is an httpOnly cookie on this origin; without this the
      // request goes out unauthenticated and every call 401s.
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

  return {
    async listConversations() {
      /*
       * Everything the viewer is in OR invited to, with the unread count
       * already computed per conversation — one grouped pass on the server, not
       * a count per row per render. See `ChatService.listConversations`.
       */
      const data = await graphql<{ chatConversations: ChatConversationView[] }>(
        `query ChatConversations { chatConversations { ${CONVERSATION_FIELDS} } }`,
      );
      return data.chatConversations;
    },
  };
}
