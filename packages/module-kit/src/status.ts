/**
 * The vocabulary of the global status bar.
 *
 * Lives here, in the contract package, for the same reason `FeatureContribution`
 * does: EVERY module has something to say, and exactly one component renders it.
 * Putting the channel in a feature module instead — `module-auth` was the
 * obvious candidate, since it already owns the session — would force every
 * other module to import that one just to publish a sentence, closing the cycle
 * PLAN §9 keeps open.
 *
 * This file is deliberately React-free and runtime-free: types plus two pure
 * functions, so the server can name a `StatusLevel` without pulling in a
 * renderer. The React bindings are the separate `@kwtech/module-kit/react`
 * entry point.
 */

/**
 * How loud a message is, and nothing else.
 *
 * Not a colour and not an icon — those are the renderer's business, and a
 * module that named them could not be re-themed. Four levels rather than
 * more, because a fifth would be a distinction the bar has no room to draw.
 */
export type StatusLevel = 'info' | 'success' | 'warning' | 'error';

/**
 * One thing the bar could say.
 *
 * Client-side only: `action` holds a function, so a message never crosses a
 * serialization boundary. A server component contributes one by rendering the
 * `<PublishStatus>` marker from the /react entry, not by passing an object.
 */
export interface StatusMessage {
  /**
   * Stable for the life of the message, and the identity used to replace it.
   *
   * Republishing the same id UPDATES rather than appends — which is what makes
   * a poller that reports its state every few seconds show one line instead of
   * a growing pile.
   */
  id: string;
  level: StatusLevel;
  text: string;
  /** The module key or app area that published it. For debugging and for grouping, never for display. */
  source?: string;
  /**
   * Survives navigation.
   *
   * Off by default, which is the safe direction: a page's message is about that
   * page, and carrying it to the next one is how a stale error follows someone
   * around. Connectivity is the case that genuinely wants it on — the server
   * being unreachable is not a property of the route you happen to be looking
   * at.
   */
  sticky?: boolean;
  /** An affordance the message itself offers — "Retry now" on an unreachable server. */
  action?: { label: string; run: () => void };
}

/**
 * Severity order, as data rather than as a chain of comparisons.
 *
 * Exported because the bar is not the only thing that ranks: a test asserting
 * "an error outranks a warning" should read the same table the renderer does,
 * or it is asserting about a second copy of the rule.
 */
export const STATUS_PRIORITY: Record<StatusLevel, number> = {
  error: 3,
  warning: 2,
  success: 1,
  info: 0,
};

/** More severe first; ties keep the order they were published in. */
export function compareStatus(a: StatusMessage, b: StatusMessage): number {
  return STATUS_PRIORITY[b.level] - STATUS_PRIORITY[a.level];
}

/**
 * Severity-ordered copy, stable within a level.
 *
 * `Array.prototype.sort` is specified as stable, so publication order survives
 * inside a level — the second warning of a page does not jump above the first.
 */
export function sortStatuses(messages: readonly StatusMessage[]): StatusMessage[] {
  return [...messages].sort(compareStatus);
}

/**
 * The one message the bar leads with.
 *
 * There is a single strip and messages arrive from independent publishers, so
 * something has to choose. Severity wins, and that ordering is the point rather
 * than a tidiness: "saving failed" above "the server is unreachable" describes a
 * symptom over its cause, and the reader acts on the first line they read.
 */
export function selectPrimaryStatus(messages: readonly StatusMessage[]): StatusMessage | undefined {
  let primary: StatusMessage | undefined;
  for (const message of messages) {
    if (!primary || STATUS_PRIORITY[message.level] > STATUS_PRIORITY[primary.level]) primary = message;
  }
  return primary;
}
