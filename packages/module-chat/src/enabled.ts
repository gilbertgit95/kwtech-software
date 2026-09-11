/**
 * ⚠ ONE READER FOR THE ONE SWITCH, so the server and the web descriptor cannot
 * disagree about what "on" means.
 *
 * Switching chat off is three different acts and only one of them is this:
 *
 *   NOT INSTALLED — the host never composes `chatServerModule()` or
 *   `chatWebModule()`. Nothing to build, nothing to check, and the real answer
 *   for an app that does not want chat.
 *
 *   DISABLED — installed, switched off without a deploy: no resolvers, no
 *   subscriptions, no routes, no nav entry, no header slot. That is this flag.
 *
 *   DELETED — not a thing. Disabling keeps every row and re-enabling restores
 *   the product exactly.
 *
 * The default is ON, because a host that composed the module meant to have it.
 * Written as `!== false` rather than `=== true` for exactly that: an options
 * object with no opinion is an opinion in favour.
 *
 * ⚠ A DISABLE MUST KEEP `CHAT_FEATURE_REGISTRY` COMPOSED in the host's seed.
 * Dropping it makes the feature sync DEPRECATE the `chat:*` rows, and a
 * deprecated feature grants nothing — so every role would silently lose its
 * chat rights and get them back only on re-registration. Uninstalling should
 * deprecate them; disabling must not.
 */
export function chatIsEnabled(options: { enabled?: boolean } = {}): boolean {
  return options.enabled !== false;
}
