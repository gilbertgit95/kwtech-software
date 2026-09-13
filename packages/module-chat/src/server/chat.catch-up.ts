/**
 * Catch-up — see `withCatchUp` in `@kwtech/module-kit`, where the ordering that
 * keeps a reconnecting chat from losing mail is written down.
 *
 * It started here and moved when `module-queuing-window` became its second
 * consumer (PLAN §9 rule 8): neither module may import the other. Re-exported
 * under its old path so nothing in chat had to change.
 */
export { type CatchUpOptions, withCatchUp } from '@kwtech/module-kit';
