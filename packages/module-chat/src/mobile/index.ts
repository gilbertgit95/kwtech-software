/**
 * `@kwtech/module-chat/mobile` — chat on the phone layout (issue #22).
 *
 * Browser code, like `/react`: it may import this package's root and `/react`
 * parts, `@kwtech/module-kit` and `@kwtech/web-ui`, and never `/server`
 * (`pnpm check:boundaries`).
 */
export { ChatMobileView } from './chat-mobile-view.js';
export { chatMobileModule } from './module.js';
