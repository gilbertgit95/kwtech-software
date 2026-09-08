/**
 * The metadata keys a handler uses to declare the rights it needs.
 *
 * ## Why these strings are HERE and not in the enforcing module
 *
 * `@RequireFeature` reaches the guard through Nest's metadata registry, which
 * is a shared namespace keyed by string. Whoever sets the key and whoever reads
 * it must agree on it exactly, and a mismatch fails SILENTLY in the worst
 * direction: the guard finds no declared features and lets the request through.
 *
 * That agreement is a contract between modules, which is what this package is
 * for. It lived in `module-permissions` while permissions was the only module
 * with anything to guard. `module-auth` then grew `users:*` — rights over its
 * OWN tables, enforced by the permissions guard — and could not import the
 * decorator, because the two modules may not import each other (PLAN §9). The
 * choice was to copy the string, which is exactly the silent fork above, or to
 * move it to the package both already depend on.
 *
 * ## What did NOT move
 *
 * The GUARD, and the resolution of who holds what. Declaring a requirement is a
 * contract; deciding whether it is met is permissions' whole job. That is the
 * same division this package already makes for features themselves:
 * `FeatureContribution` is here, `FeatureSpec` and the registry are there.
 *
 * ## Why constants and not the decorator
 *
 * `SetMetadata` comes from `@nestjs/common`, and this package imports no
 * framework at runtime — it is composed by a browser bundle as readily as by a
 * Nest app. Each server-side module wraps these keys in its own one-line
 * decorator. The wrapper is trivial and cannot drift; the STRING is the part
 * that must never fork, and it is written once, here.
 */

/** Declared features. Reflected as `FeatureKey[]` — an empty array means none. */
export const REQUIRED_FEATURES = 'kwtech:required-features';

/**
 * `'all'` (the default) or `'any'`, for a handler declaring more than one key.
 *
 * The default is deliberate: asking for two keys and silently accepting one is
 * how over-permissive endpoints happen, so OR has to be opted into.
 */
export const REQUIRED_FEATURES_MODE = 'kwtech:required-features-mode';

export type FeatureMode = 'all' | 'any';
