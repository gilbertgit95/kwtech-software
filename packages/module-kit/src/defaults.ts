/**
 * WHAT HAPPENS WHEN NOBODY SAYS — the declaration half, owned here for the same
 * reason `FeatureContribution` and `LimitContribution` are.
 *
 * Every module may have a decision an operator should be able to make once
 * rather than at every creation; only one module stores and resolves those
 * decisions. The resolver (`@kwtech/module-permissions`) imports this shape like
 * everyone else and narrows it where it needs more than a contract can require.
 *
 * ## Why this had to exist
 *
 * `APP_DEFAULT_REGISTRY` was a const inside the resolving module with no
 * contribution path — exactly where `LIMIT_REGISTRY` was before a module needed
 * to declare a cap. The consequence was the same shape of silence: a module
 * with a default-shaped decision had two options, hardcode it and offer the
 * operator nothing, or have the resolving module import the module (§9 forbids
 * it). `module-chat` arrived with two of them at once — the role a group's
 * CREATOR gets and the role somebody ADDED gets, the same pair `workspace.*`
 * already had — and could declare neither.
 *
 * ⚠ A default that is not declared through this interface DOES NOT EXIST. The
 * screen lists the registry, so an undeclared key has no row to set; and the
 * resolver reads the registry to answer, so a `perm_default` row for an
 * undeclared key is ignored. Setting the value in the database would change
 * nothing, with no error to explain why.
 */
export interface DefaultContribution {
  /**
   * Namespaced by the thing it is a default FOR, not the thing it points AT —
   * `chat.creator_role` rather than `role.chat_creator` — because the process
   * is what somebody is looking for when they open the screen.
   *
   * ⚠ Stored in the database. Renaming one silently unsets the default it
   * names: the old row stops matching the catalogue and is ignored, and the new
   * key has no row. A rename needs a migration, exactly as a feature key does.
   */
  key: string;
  /** The module key, so defaults can be grouped and attributed like features. */
  module: string;
  /**
   * WHAT KIND OF THING the value names — a role, a plan, a number of days, one
   * of a fixed set of words.
   *
   * A plain string, deliberately loose, exactly as `LimitContribution.countedOver`
   * and `bindings.surface` are: this package must not own the resolving module's
   * vocabulary, and that module refuses a kind it cannot resolve.
   */
  kind: string;
  /**
   * WHEN it is consulted — the process it is the default for.
   *
   * Loose for the same reason and more sharply: the resolving module cannot
   * know that conversations get created. The screen groups by this, because
   * somebody arrives asking "what happens when a group is created" rather than
   * "which defaults point at a role".
   */
  moment: string;
  label: string;
  description: string;
  /**
   * What happens when this is NOT set, in a sentence the screen shows.
   *
   * ⚠ REQUIRED, because unset is a legitimate configuration for every default
   * and the consequence differs wildly: an unset plan leaves an organization
   * entitled to nothing, while an unset workspace role leaves a creator who can
   * still enter the workspace they made. A screen showing "Not set" for both
   * would describe two very different situations with one word.
   */
  whenUnset: string;
  /**
   * The values this default may take, when they are a FIXED SET rather than
   * rows in a table.
   *
   * ⚠ THE REASON THIS FIELD EXISTS. Every default the resolving module shipped
   * points at something it stores — a role, a plan — so its screen could offer
   * a picker over rows. A contributed default may point at neither: chat's two
   * name one of three participant roles, which are an enum in chat's own schema
   * and not rows anybody can list. Without this the screen has nothing to
   * offer, and the operator is asked to type a magic string.
   *
   * Omitted for a default whose target IS a row — the resolving module knows
   * how to list those.
   */
  choices?: readonly { value: string; label: string }[];
}

/**
 * THE HEADING A MOMENT GETS, contributed by whichever module owns the process.
 *
 * ## ⚠ Why declaring the default is not enough
 *
 * The defaults screen groups by MOMENT, because somebody arrives asking "what
 * happens when a group is created" rather than "which of these point at a
 * role". It rendered a hardcoded list of the six moments the resolving module
 * knew, and filtered the defaults into them — so a default whose moment was not
 * in that list had no section to appear in. Composed, settable through the API,
 * and INVISIBLE on the only screen anybody sets it from: the exact silence
 * `DefaultContribution` exists to end, one level up.
 *
 * ## A NAME, not a reference — the same as a nav group
 *
 * Two modules may have defaults at one moment, so a moment is a shared
 * namespace and neither owns it outright. `composeDefaultMoments` resolves two
 * suggestions about one moment the way `composeNavGroups` does: the lowest
 * order wins, and disagreeing about the title is not an error.
 */
export interface DefaultMomentContribution {
  /** Matches `DefaultContribution.moment` exactly. */
  moment: string;
  /** The section heading — a sentence about the process, not a noun. */
  title: string;
  /**
   * What an operator needs to know about the moment BEFORE reading the settings
   * under it — usually which other things win over a default, since a default
   * that is only consulted "where nothing else said" is the normal case.
   */
  blurb: string;
  /**
   * Lower is higher up the page. Space them — 10, 50, 90 — so one can be
   * inserted between two without renumbering.
   *
   * ⚠ An UNDECLARED moment sorts after every declared one rather than before,
   * for the reason `navGroupRank` gives: a module whose moment nobody placed
   * appears at the bottom, which is visible and harmless.
   */
  order: number;
}
