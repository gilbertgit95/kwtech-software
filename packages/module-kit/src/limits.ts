/**
 * HOW MANY, as opposed to what — the declaration half, owned here for the same
 * reason `FeatureContribution` is.
 *
 * Every module may declare a cap; only one module enforces caps. The enforcer
 * (`@kwtech/module-permissions`) imports this shape like everyone else, and
 * narrows it to its own `LimitSpec` where it needs more than a contract can
 * require.
 *
 * ## Why this had to exist before `module-chat` could be built
 *
 * `LIMIT_REGISTRY` is a const inside the enforcing module with no contribution
 * path, and the consequences were not "chat cannot declare a cap" — they were
 * worse than that, because nothing failed:
 *
 *   - `checkLimit` returns ALLOWED for a key no registry declares. A limit
 *     nobody declared is not a limit, which is right in isolation and means an
 *     undeclared `chat:group_chats` is silently infinite.
 *   - `resolveLimits` builds its map by walking the registry, so a
 *     `perm_role_limit` row for an undeclared key is dropped BEFORE any checker
 *     could see it. Setting the number in the database would have changed
 *     nothing, with no error to explain why.
 *
 * So a cap that is not declared through this interface does not exist, and the
 * enforcing module is expected to say so loudly rather than pass.
 */
export interface LimitContribution {
  key: string;
  /** The module key, so a limit can be grouped and attributed like a feature. */
  module: string;
  label: string;
  description: string;
  /**
   * Where the number comes from.
   *
   *   plan — bought, through an organization's subscription.
   *   role — granted, through the holder's app-level role.
   *
   * ⚠ NOT interchangeable, and this is the field a contributing module is most
   * likely to get wrong. A plan-sourced limit has no meaning before an
   * organization exists, so an APP-LEVEL feature cannot be capped by a plan —
   * two users with no organization between them have no subscription to read.
   * `module-chat` is the worked example: every `chat:*` key is app level, so its
   * cap is role-sourced and no plan can sell it (PLAN §12.41).
   */
  source: 'plan' | 'role';
  /**
   * Which entity the count is taken over.
   *
   * A plain string here, deliberately loose, exactly as `bindings.surface` is:
   * this package must not own the enforcing module's vocabulary, and a module
   * counting over something it has never heard of is the module's business.
   * The enforcer narrows it and refuses what it cannot count.
   */
  countedOver: string;
  /**
   * Whether every PLAN must set this, checked when plans are seeded. Meaningless
   * for a role-sourced limit, which falls to its default for any role that says
   * nothing about it.
   */
  required?: boolean;
  /**
   * The cap when nothing assigns one. `null` means genuinely unrestricted.
   *
   * ⚠ Choose it as the answer for somebody the operator has not thought about
   * yet, because that is exactly who gets it: an unconfigured role, a lapsed
   * subscription, a deployment that adopted the module and has not seeded
   * anything. `null` there is an unbounded resource handed to an unknown party.
   */
  defaultValue: number | null;
}

/**
 * Whether one more fits, and enough detail to say why not.
 *
 * `remaining` is null rather than Infinity when unrestricted: this crosses a
 * JSON boundary, `JSON.stringify(Infinity)` is `null`, and a client cannot tell
 * that apart from "unknown". Null on purpose is at least honest.
 */
export interface LimitDecision {
  allowed: boolean;
  limit: number | null;
  current: number;
  remaining: number | null;
}

export interface LimitCheckInput {
  /** Whose cap to resolve — the user, never the row being created. */
  actorId: string;
  key: string;
  /**
   * ⚠ HOW MANY THERE ALREADY ARE, COUNTED BY THE CALLER. The single most
   * important line in this file.
   *
   * The checker resolves the CAP; the module that owns the rows supplies the
   * COUNT. It cannot be the other way round, and the existing implementation is
   * the proof: `PermissionsService.checkCapacity` counts with a hardcoded
   * if/else over `perm_membership`, `perm_workspace` and friends, so it can
   * count nothing a module adds later. Teaching it to count chat groups would
   * put chat's tables inside the permissions module — the import that §9 forbids
   * and that portability depends on not happening.
   *
   * Count it in the same transaction as the insert where it matters. A cap
   * checked outside one is advisory: two simultaneous creates both read
   * `current` before either writes.
   */
  current: number;
  /** For a plan-sourced cap. Omitted at app level, where no subscription is consulted. */
  organizationId?: string;
  workspaceId?: string;
}

/**
 * The port a module takes to ask "may there be one more of these".
 *
 * Structural and injected, like every other seam here — the module declares the
 * question, the host supplies whatever answers it.
 */
export interface LimitChecker {
  check(input: LimitCheckInput): Promise<LimitDecision>;
}

/**
 * "No limit" — the DEFAULT, and a design goal rather than a convenience.
 *
 * A module that declares caps must still run in an app with no permission model
 * at all: unguarded, but functional. That is the real test of whether a module
 * is reusable, and the alternative — throwing, or refusing to register — makes
 * the permissions module a hard dependency of every module that ever counts
 * anything.
 *
 * ⚠ It is a null object, not a fallback. A host that MEANS to enforce caps and
 * forgets to bind a checker gets silence, which is the same shape of failure as
 * the undeclared key above. Hosts are expected to bind explicitly; the enforcing
 * module's adapter exists for that.
 */
export const NULL_LIMIT_CHECKER: LimitChecker = {
  async check({ current }: LimitCheckInput): Promise<LimitDecision> {
    return { allowed: true, limit: null, current, remaining: null };
  },
};
