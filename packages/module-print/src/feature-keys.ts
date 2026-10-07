import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the printing side lets somebody do, and how much of it
 * (docs/PRINT-STUDIO-PLAN.md §10).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: a paired computer prints for one
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 *
 * Keys are ATOMIC and split by RISK. Seeing which computers and printers a
 * workspace has is one thing. Pairing a computer is another, and the
 * privileged one: a paired computer RECEIVES every job the workspace prints.
 */
export const PRINT_FEATURE = {
  /** See the workspace's paired computers, their printers and whether they are online. */
  read: 'print:read',
  /** Send a file to one of the workspace's printers, through the computer it is on. */
  send: 'print:send',
  /** Pair a computer to print for the workspace, and revoke one. */
  manageAgents: 'print:manage_agents',
} as const;

export type PrintFeatureKey = (typeof PRINT_FEATURE)[keyof typeof PRINT_FEATURE];

/*
 * ── no key for the computer itself ──────────────────────────────────────────
 *
 * A paired computer is not a person and holds no role. What admits it is its
 * secret, at the socket handshake; its operations are PUBLIC surfaces that
 * refuse anything without that admission (`print-agent.resolver.ts`).
 */

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature` — the
 * decorator belongs to `module-permissions`, and a module may not import a
 * module (§9) — so `FeatureGuard` enforces each operation through its binding.
 * A missing binding is an UNGUARDED OPERATION, which is why
 * `surface-coverage.test.ts` fails on any operation that is not bound here.
 */
export const PRINT_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: PRINT_FEATURE.read,
    module: 'print',
    level: 'workspace',
    label: 'See the printers',
    description: 'See the computers paired to print for this workspace, their printers, and whether they are online.',
    tags: ['print'],
    bindings: [op('Query.printAgents')],
  },
  {
    key: PRINT_FEATURE.send,
    module: 'print',
    /*
     * Its own key, apart from seeing the printers: a job uses paper and ink
     * somebody pays for, and a workspace may want people who can see what is
     * installed without being able to print on it.
     *
     * Both operations sit under it — reading a job back is reading how YOUR
     * job went, and the service refuses anybody else's.
     */
    level: 'workspace',
    label: 'Print',
    description: 'Send a file to one of this workspace’s printers, through the computer it is connected to.',
    tags: ['print'],
    bindings: [op('Mutation.startPrintJob'), op('Query.printJob')],
  },
  {
    key: PRINT_FEATURE.manageAgents,
    module: 'print',
    /*
     * ⚠ PRIVILEGED because a paired computer receives the workspace's print
     * jobs: whoever may pair one may point the workspace's printing at a
     * computer of their own. Revoking sits under the same key on purpose — the
     * person who can add a computer is the person who must be able to take it
     * away, and a key that could only add would leave a mistake standing.
     */
    isPrivileged: true,
    level: 'workspace',
    label: 'Pair and revoke computers',
    description: 'Pair a computer so it can print for this workspace, and revoke one that should no longer.',
    tags: ['print'],
    bindings: [op('Mutation.createPrintPairingCode'), op('Mutation.revokePrintAgent')],
  },
];

export const PRINT_LIMIT = {
  /** How many computers may be paired to one workspace at a time. */
  agents: 'print:agents',
} as const;

/**
 * The cap, PLAN-SOURCED and COUNTED PER WORKSPACE.
 *
 * Revoked computers do not count: the row stays as a record, and a workspace
 * must be able to replace a broken computer without a higher plan.
 *
 * The module counts, in the transaction that inserts; the host's `LimitChecker`
 * only resolves the number (`LimitCheckInput.current`).
 */
export const PRINT_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: PRINT_LIMIT.agents,
    module: 'print',
    label: 'Paired computers per workspace',
    description: 'How many computers may be paired to print for one workspace at a time. Revoked ones do not count.',
    source: 'plan',
    countedOver: 'workspace',
    required: false,
    // One at the counter and one in the back. A shop needing more is on a plan that says so.
    defaultValue: 2,
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface PrintRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly PrintFeatureKey[];
}

export const PRINT_ROLE_PRESETS: readonly PrintRolePreset[] = [
  {
    key: 'print-user',
    label: 'Printing user',
    icon: 'printer',
    level: 'workspace',
    features: [PRINT_FEATURE.read, PRINT_FEATURE.send],
  },
  {
    key: 'print-admin',
    label: 'Printing admin',
    icon: 'printer',
    level: 'workspace',
    features: [PRINT_FEATURE.read, PRINT_FEATURE.send, PRINT_FEATURE.manageAgents],
  },
];
