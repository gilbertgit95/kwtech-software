/**
 * `@kwtech/module-queuing-window/react` — the web half.
 *
 * A SEPARATE entry point from '.', which stays framework-free. `react` and
 * `@kwtech/web-ui` are optional peers for that reason.
 *
 * ⚠ NAMED exports, never `export *`: half of this barrel is `'use client'`, and
 * a client module does not answer the enumeration `export *` compiles to.
 */

export { QUEUE_CALL_CHIME } from './call-chime.js';
export { type QueueWebModuleOptions, queueWebModule } from './module.js';
export { QueueConsolePage } from './pages/queue-console-page.js';
export { QueueDisplayPage } from './pages/queue-display-page.js';
export { QueueSettingsPage } from './pages/queue-settings-page.js';
export {
  createQueueClient,
  DEFAULT_GRAPHQL_PATH,
  type QueueClient,
  type QueueConsoleView,
  type QueueDisplayCodeView,
  type QueueEventView,
  type QueueLineView,
  type QueueScopeView,
  type QueueSeatView,
  type QueueSessionView,
  type QueueStaffMemberView,
  type QueueTicketView,
  type QueueWindowView,
} from './queue-client.js';
export {
  QUEUE_CONSOLE_PATH,
  QUEUE_DISPLAY_PATH,
  QUEUE_SETTINGS_PATH,
  queueConsoleHref,
  queueSettingsHref,
  WORKSPACE_NAV_GROUP,
} from './routes.js';
export { primeSpeech, speakAnnouncement } from './speech.js';
export { type DisplayThemeState, useDisplayTheme } from './use-display-theme.js';
export { type QueueConsoleState, useQueueConsole } from './use-queue-console.js';
export {
  type DisplayNotice,
  type DisplayPhase,
  type QueueDisplayState,
  useQueueDisplay,
} from './use-queue-display.js';
export {
  announcementSentence,
  codeFromFragment,
  displayStorageKeys,
  filterBoard,
  isStale,
  type QueueBoardCallView,
  type QueueBoardView,
  type QueueDisplayEventView,
  servingRows,
  spokenCall,
  spokenLabel,
} from './view/board-view.js';
export {
  activeLines,
  activeWindows,
  clockTime,
  displayLink,
  isTypingTarget,
  linesServedBy,
  type SessionAge,
  seatAt,
  servingAt,
  sessionAge,
  spaceLine,
} from './view/console-view.js';
export {
  DISPLAY_THEME_STORAGE_KEY,
  type DisplayTheme,
  type DisplayThemeMode,
  isDarkDisplay,
  parseDisplayTheme,
} from './view/display-theme.js';
export { FALLBACK_PITCH_SHIFT, pickVoice, type SpeechPlan, speechPlan, type VoiceLike } from './view/voice-view.js';
