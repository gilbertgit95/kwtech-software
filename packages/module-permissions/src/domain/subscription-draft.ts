import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '../types.js';

/**
 * A subscription being written, before it is a row.
 *
 * Where a plan says WHAT is sold, this says WHO has it: it attaches a plan to
 * an organization, or to one workspace inside that organization, with a status
 * and a renewal date.
 *
 * ## The two the form cannot change
 *
 * `organizationId`/`workspaceId` and `planKey` are set once, at creation, and
 * are read-only afterwards — the same call `RoleDraft` makes about `key` and
 * `level`, and for the same reason. Every entitlement decision ever made
 * against this row read all three, so moving a live subscription to another
 * plan silently re-interprets the history: "what was this organization entitled
 * to in March" would answer with what they are entitled to now.
 *
 * Changing plan is therefore two acts — end this subscription, start another —
 * which is exactly what `PermSubscription.endedAt` ("set when superseded")
 * exists to record. Two rows and a timestamp reconstruct the change; one
 * mutated row cannot.
 */
export interface SubscriptionDraft {
  organizationId: string;
  /**
   * Null means the whole organization is entitled; an id means that one
   * workspace ADDITIONALLY is.
   *
   * Additive, never an override — the schema comment on PermSubscription spells
   * out why: an override needs a precedence rule, and precedence is the part
   * teams get wrong, with a downgraded workspace plan silently revoking an
   * organization-wide entitlement as the failure that follows.
   */
  workspaceId: string | null;
  planKey: string;
  status: string;
  /**
   * When the current period ends, as an ISO date (`YYYY-MM-DD`) or empty.
   *
   * A STRING, not a Date, for the reason `PlanDraft.limits` holds strings: it
   * comes from `<input type="date">`, which yields `''` while empty and a
   * partial value mid-edit, and `new Date('')` is an Invalid Date that survives
   * every check until it reaches the column.
   *
   * Empty is legitimate and means "no renewal date recorded" — a perpetual
   * internal plan, or a row written before billing was connected. Nothing reads
   * it to decide entitlement: `status` does that, so a lapsed date cannot
   * silently switch access off without a row saying so.
   */
  currentPeriodEnd: string;
}

export const EMPTY_SUBSCRIPTION_DRAFT: SubscriptionDraft = {
  organizationId: '',
  workspaceId: null,
  planKey: '',
  /*
   * Not 'active'. Starting a subscription is the moment entitlement changes for
   * a whole tenant, and defaulting the dropdown to the value that switches
   * features on makes that the outcome of not reading the form. `past_due` is
   * the honest default for a row created before anything has been paid, and it
   * entitles nothing until someone deliberately says otherwise.
   */
  status: 'past_due',
  currentPeriodEnd: '',
};

export type SubscriptionDraftErrors = Partial<Record<keyof SubscriptionDraft, string>>;

export interface ValidateSubscriptionOptions {
  /** Plan keys that exist and are not archived. */
  planKeys?: readonly string[];
  /** Organization ids that exist. */
  organizationIds?: readonly string[];
  /**
   * Workspace ids belonging to the DRAFT'S organization — not every workspace
   * there is.
   *
   * That narrowing is the check: a workspace id from another tenant paired with
   * this organization would otherwise be a perfectly well-formed row entitling
   * one customer's workspace off another customer's subscription. The write
   * path re-reads the pairing inside its transaction, because a list handed to
   * a validator is not something the validator can verify.
   */
  workspaceIds?: readonly string[];
}

/**
 * Everything wrong with a draft, all at once.
 *
 * The membership of every id in its list is checked HERE only to give the form
 * a per-field message. It is not the guarantee — `PermissionsWriteService`
 * re-reads the organization, the workspace and the plan inside the transaction
 * that inserts the row, because a caller supplying its own "valid" lists is
 * exactly the shape of the cross-tenant write the read path already refuses
 * defensively.
 */
export function validateSubscriptionDraft(
  draft: SubscriptionDraft,
  options: ValidateSubscriptionOptions = {},
): SubscriptionDraftErrors {
  const errors: SubscriptionDraftErrors = {};

  if (!draft.organizationId.trim()) errors.organizationId = 'Choose an organization.';
  else if (options.organizationIds && !options.organizationIds.includes(draft.organizationId)) {
    errors.organizationId = 'That organization does not exist.';
  }

  if (draft.workspaceId !== null) {
    if (!draft.workspaceId.trim()) {
      // An empty string is not the same as null, and the difference is the
      // whole meaning of the field. Caught rather than coerced: coercing would
      // turn a half-filled workspace picker into an organization-wide
      // subscription, which is strictly more entitlement than was asked for.
      errors.workspaceId = 'Choose a workspace, or leave the subscription organization-wide.';
    } else if (options.workspaceIds && !options.workspaceIds.includes(draft.workspaceId)) {
      errors.workspaceId = 'That workspace is not in this organization.';
    }
  }

  if (!draft.planKey.trim()) errors.planKey = 'Choose a plan.';
  else if (options.planKeys && !options.planKeys.includes(draft.planKey)) {
    errors.planKey = 'That plan does not exist, or has been archived.';
  }

  if (!isSubscriptionStatus(draft.status)) {
    errors.status = `Status must be one of: ${SUBSCRIPTION_STATUSES.join(', ')}.`;
  }

  const period = draft.currentPeriodEnd.trim();
  if (period && !ISO_DATE.test(period)) {
    errors.currentPeriodEnd = 'Use a date, or leave it blank for no renewal date.';
  } else if (period && !isRealDate(period)) {
    // Matches the shape and is still not a date — 2026-02-31. Reported
    // separately from the shape error so the message is actionable.
    errors.currentPeriodEnd = 'That is not a real date.';
  }

  return errors;
}

/** `YYYY-MM-DD`, which is what `<input type="date">` produces. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a well-shaped date string names a day that exists.
 *
 * ⚠ `Number.isNaN(Date.parse('2026-02-31'))` is FALSE. JavaScript rolls the
 * overflow forward rather than rejecting it, so that string parses happily to
 * the 3rd of March — a renewal recorded in the wrong month, from input that
 * every obvious check passes.
 *
 * Round-tripping is what catches it: the parsed date is formatted back and
 * compared to what was typed, so a value that moved is a value that was never
 * a date. Assumes the ISO shape has already been checked.
 */
function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * The draft's period as the value a row stores, or null.
 *
 * Parsed as UTC midnight rather than local: `new Date('2026-03-01')` is already
 * UTC, but a caller reaching for `new Date(y, m, d)` would land on local
 * midnight and shift the recorded date by a day for anyone west of Greenwich —
 * which is how a renewal silently lands in the wrong month.
 */
export function subscriptionPeriodEnd(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  /*
   * Refuses a rolled-over date rather than storing what JavaScript made of it —
   * see `isRealDate`. The validator and this must agree about 2026-02-31, or a
   * draft that was refused by the form would be silently accepted with a
   * different date by anything calling the write service directly.
   */
  if (!ISO_DATE.test(trimmed) || !isRealDate(trimmed)) return null;
  return new Date(`${trimmed}T00:00:00.000Z`);
}

/** A stored period as the `YYYY-MM-DD` a date input edits. */
export function subscriptionPeriodField(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
