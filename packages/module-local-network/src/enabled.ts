/**
 * ⚠ ONE READER FOR THE ONE SWITCH, so the server and the web descriptor cannot
 * disagree about what "on" means. Copied in shape from module-chat's
 * `chatIsEnabled` (`packages/module-chat/src/enabled.ts`), with the default
 * turned the other way.
 *
 * ⚠ THE DEFAULT IS OFF, the opposite of chat (docs/LOCAL-NETWORK-PLAN.md §4,
 * decision L5). Chat is on because a host that composed it wanted it. This
 * page is right for ONE kind of installation only, a shop's own network
 * behind Caddy; on a remote server with a domain it would publish an address
 * and a certificate that are wrong there. So an options object with no
 * opinion, `enabled: undefined`, or anything but `true` is off: `=== true`,
 * never `!== false`. The profile turns it on (`LOCAL_NETWORK="on"`, written by
 * `pnpm https:setup`), and a remote server's profile never has it.
 *
 * Off means ABSENT: no resolvers and no page, so the query is not in the
 * schema at all and a request that sends it anyway gets GraphQL's own "cannot
 * query field". There is no "not enabled" refusal to define.
 *
 * ⚠ A HOST THAT SWITCHES IT OFF MUST KEEP `LOCAL_NETWORK_FEATURE_REGISTRY`
 * COMPOSED in its seed, as chat's comment explains for chat: dropping it makes
 * `db:sync` deprecate `local_network:*`, and turning the page back on would
 * bring the key back without the grants a super admin gave other roles.
 */
export function localNetworkIsEnabled(options: { enabled?: boolean | undefined } = {}): boolean {
  return options.enabled === true;
}
