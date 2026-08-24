/**
 * @kwtech/web-ui — the component vocabulary shared by every web app.
 *
 * Scope rule: anything in here must be useful to more than one app. A
 * component with exactly one consumer belongs in that app until a second one
 * needs it — extracting early is how component libraries end up full of
 * abstractions nobody wanted.
 *
 * Platform rule: this package is React DOM. When mobile-ui arrives, the parts
 * that are genuinely platform-neutral — design tokens, formatters, validation
 * schemas — move out to a shared package rather than being duplicated. Keep
 * tokens in ./theme so that extraction stays a file move.
 */
export {};
