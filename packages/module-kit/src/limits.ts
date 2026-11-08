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
  /**
   * Which plan set this cap and which plan raises it (#101), when the cap is
   * plan-sourced and refused. Absent for a role-sourced cap, for an app with no
   * plans, and from a checker that does not know plans: the sentence then says
   * only the number (`limitReachedText`).
   */
  raise?: LimitRaise;
}

/** A plan as a cap refusal names it. */
export interface LimitPlanRef {
  key: string;
  label: string;
}

/**
 * ⚠ WORKED OUT BY THE ENFORCER, NEVER BY THE MODULE. A module cannot know the
 * plans (§9: modules do not import permissions), so the checker that resolved
 * the cap adds this; the module only carries it into its refusal.
 */
export interface LimitRaise {
  /** The organization's plan that set the cap; null when no plan did (the declared default). */
  plan: LimitPlanRef | null;
  /**
   * The smallest public plan with a higher cap, and that cap (`null` = no
   * limit). Null when no public plan allows more: the sentence then points to
   * a Custom plan.
   */
  next: (LimitPlanRef & { limit: number | null }) | null;
}

/** What a cap counts, as the sentence says it: `{ one: 'branch', many: 'branches' }`. */
export interface LimitNoun {
  one: string;
  many: string;
}

function counted(value: number, noun: LimitNoun): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? noun.one : noun.many}`;
}

/**
 * THE ONE SENTENCE FOR A CAP REACHED (#101), so the modules that refuse caps do
 * not each grow their own wording:
 *
 *   - "Basic allows 1 branch. Pro allows 5."
 *   - "Pro allows 5 branches. This is the most any plan allows. Contact us for a Custom plan."
 *   - "Basic allows 1 branch. Pro has no limit."
 *   - "You can have 3 boards here." (a cap no plan set: a role's, or the default)
 *
 * `limit` null (no cap) never reaches here: a refusal always has a number.
 */
export function limitReachedText(decision: Pick<LimitDecision, 'limit' | 'raise'>, noun: LimitNoun): string {
  const cap = decision.limit ?? 0;
  const raise = decision.raise;
  if (!raise?.plan) {
    const base = `You can have ${counted(cap, noun)} here.`;
    return raise?.next ? `${base} ${nextSentence(raise.next)}` : base;
  }
  const base = `${raise.plan.label} allows ${counted(cap, noun)}.`;
  return raise.next
    ? `${base} ${nextSentence(raise.next)}`
    : `${base} This is the most any plan allows. Contact us for a Custom plan.`;
}

function nextSentence(next: NonNullable<LimitRaise['next']>): string {
  return next.limit === null
    ? `${next.label} has no limit.`
    : `${next.label} allows ${next.limit.toLocaleString('en-US')}.`;
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
