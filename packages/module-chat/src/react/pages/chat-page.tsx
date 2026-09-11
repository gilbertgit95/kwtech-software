'use client';

/**
 * `/chat` — the full-page home for conversations.
 *
 * ⚠ A STUB, deliberately, and listed in the descriptor anyway. The list, the
 * thread, the composer, the invite dialog and the requests inbox are the next
 * step's whole body; contributing the route now is what proves the path the
 * header widget depends on — descriptor → compose → grant filter → rendered
 * route → `FeatureDenied` for somebody who holds no `chat:read`. The same
 * arrangement `/admin/roles` shipped under while its page was a stub.
 *
 * It is NOT optional once the panel exists either. The panel is a shortcut to
 * this data, and building the shortcut first would make it the only home —
 * permanently cramped, with no room for a conversation anybody actually reads.
 */
export function ChatPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 py-10 text-center">
      <h1 className="text-lg font-medium text-foreground">Chat</h1>
      <p className="text-sm text-muted-foreground">
        Conversations are not on this page yet. The header icon already knows how many messages are waiting for you.
      </p>
    </div>
  );
}
