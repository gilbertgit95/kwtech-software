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
 * What off means differs by side (operator, 2026-11-06, #84):
 *   - the WEB app: absent. No page and no drawer entry.
 *   - the API: present, answering `state: 'off'`, reading nothing and needing
 *     no certificate path or address. Not absent, because the committed
 *     `schema.graphql` is rewritten at every boot, and a field that came and
 *     went with a profile setting would make it differ from machine to machine
 *     (and the operations test with it). The plan's first version left it out.
 *
 * ⚠ A HOST THAT SWITCHES IT OFF MUST KEEP `LOCAL_NETWORK_FEATURE_REGISTRY`
 * COMPOSED in its seed, as chat's comment explains for chat: dropping it makes
 * `db:sync` deprecate `local_network:*`, and turning the page back on would
 * bring the key back without the grants a super admin gave other roles.
 */
export function localNetworkIsEnabled(options: { enabled?: boolean | undefined } = {}): boolean {
  return options.enabled === true;
}
