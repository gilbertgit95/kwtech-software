import { appHubWebModule } from '@kwtech/module-app-hub/react';
import { authWebModule } from '@kwtech/module-auth/react';
import { booksWebModule } from '@kwtech/module-basic-bookkeeping/react';
import { posWebModule } from '@kwtech/module-basic-pos/react';
import { bookingWebModule } from '@kwtech/module-booking/react';
import { chatWebModule } from '@kwtech/module-chat/react';
import { jobsWebModule } from '@kwtech/module-jobs/react';
import { composeApps, type WebModuleDescriptor } from '@kwtech/module-kit';
import { noteWebModule } from '@kwtech/module-note/react';
import { notificationWebModule } from '@kwtech/module-notification/react';
import { permissionsWebModule } from '@kwtech/module-permissions/react';
import { queueWebModule } from '@kwtech/module-queuing-window/react';
import { taskWebModule } from '@kwtech/module-task/react';

/**
 * Every module this app composes, listed once (PLAN §9).
 *
 * Routes, navigation and middleware protection all derive from this array, so
 * adding the tenth module is the same one-line edit as adding the second.
 * Duplicate paths and duplicate feature keys throw at composition time rather
 * than at first request.
 *
 * `module-permissions` contributes /admin/roles, keyed on `admin:access`. The
 * page body is still a Phase 6 stub, but listing it here is what puts a real
 * entry in the side drawer and proves the whole path: descriptor -> composeNav
 * -> grant filter -> rendered link. It is hidden from anyone who does not hold
 * the key, so an unfinished page is not an exposed one.
 */
/*
 * `module-chat` is the first module to contribute a HEADER SLOT as well as
 * routes, and it is called rather than spread because it carries the one switch
 * that turns chat off without a deploy — `chatWebModule({ enabled: false })`
 * contributes no route, no nav entry and no icon, while keeping its feature
 * registry so a disable does not strip `chat:*` from every role that holds it.
 */
const FEATURE_MODULES: readonly WebModuleDescriptor[] = [
  authWebModule,
  permissionsWebModule,
  chatWebModule(),
  // The public display opens its own socket, so it needs to know where the API is.
  queueWebModule({ wsUrl: process.env.NEXT_PUBLIC_WS_URL }),
  // Placeholder sub-apps: a key and a static screen each, so the Apps page runs more than one app.
  noteWebModule(),
  taskWebModule(),
  posWebModule(),
  // The books: cash on hand, investors, profit shares and loans — after the POS on the Apps page.
  booksWebModule(),
  // Booking: services, who performs them and when, and the day's reservations — after the books.
  bookingWebModule(),
  // The bell, right of chat's inbox in the header (header-tool order 20).
  notificationWebModule(),
  /*
   * The background runner's one page, in Administration. CORE, not a sub-app
   * (JOBS-PLAN D9): it lists the processes of whichever modules above declare
   * one. The labels are what THIS app calls those modules — the runner may
   * import none of them, so it cannot know. Add a module's here when it
   * declares its first process; without one it is headed by its key.
   */
  jobsWebModule({ moduleLabels: { task: 'Tasks', booking: 'Booking' } }),
];

/*
 * The workspace's Apps page, handed every sub-app the modules above declare
 * (the queue, notes, tasks, the point of sale, the books and booking today). Composed from the list
 * rather than naming them, so a new sub-app module added above appears on the
 * page with no edit here — and
 * `composeApps` throws on two apps sharing a key, which saved layouts depend on.
 */
export const WEB_MODULES: readonly WebModuleDescriptor[] = [
  ...FEATURE_MODULES,
  appHubWebModule({ apps: composeApps(FEATURE_MODULES) }),
];
