import { appHubWebModule } from '@kwtech/module-app-hub/react';
import { authWebModule } from '@kwtech/module-auth/react';
import { backupWebModule } from '@kwtech/module-backup/react';
import { booksWebModule } from '@kwtech/module-basic-bookkeeping/react';
import { stockWebModule } from '@kwtech/module-basic-inventory/react';
import { posWebModule } from '@kwtech/module-basic-pos/react';
import { bookingWebModule } from '@kwtech/module-booking/react';
import { chatWebModule } from '@kwtech/module-chat/react';
import { jobsWebModule } from '@kwtech/module-jobs/react';
import { composeApps, type WebModuleDescriptor } from '@kwtech/module-kit';
import { localNetworkWebModule } from '@kwtech/module-local-network/react';
import { noteWebModule } from '@kwtech/module-note/react';
import { notificationWebModule } from '@kwtech/module-notification/react';
import { permissionsWebModuleWith } from '@kwtech/module-permissions/react';
import { PLATFORM_BILLING_FEATURE } from '@kwtech/module-platform-billing';
import { platformBillingWebModule } from '@kwtech/module-platform-billing/react';
import { printWebModule } from '@kwtech/module-print/react';
import { studioWebModule } from '@kwtech/module-print-studio/react';
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
/**
 * ⚠ The Billing page REPLACES permissions' read-only subscription page (#96):
 * one place an organization sees its plan. Handed to permissions as its
 * `planPage`, because the two modules may not know each other (PLAN §9): it
 * drops its own page and points the organization overview's card here,
 * shown to the holders of the Billing page's key.
 */
const permissionsWithBillingPage = permissionsWebModuleWith({
  planPage: {
    section: 'billing',
    feature: PLATFORM_BILLING_FEATURE.read,
    title: 'Billing',
    description: 'Your plan, what is due and when, payment details, bills and receipts.',
  },
});

const FEATURE_MODULES: readonly WebModuleDescriptor[] = [
  authWebModule,
  permissionsWithBillingPage,
  // The organization's Billing page (#96): plan, what is due, requests, payment details and history.
  platformBillingWebModule,
  chatWebModule(),
  // The public display opens its own socket, so it needs to know where the API is.
  queueWebModule({ wsUrl: process.env.NEXT_PUBLIC_WS_URL }),
  // Placeholder sub-apps: a key and a static screen each, so the Apps page runs more than one app.
  noteWebModule(),
  taskWebModule(),
  posWebModule(),
  // Stock: what is on the shelf, what each product uses up, deliveries, waste and stock takes — after the POS.
  stockWebModule(),
  // The books: cash on hand, investors, profit shares and loans — after the POS on the Apps page.
  booksWebModule(),
  // Booking: services, who performs them and when, and the day's reservations — after the books.
  bookingWebModule(),
  // The print studio: photos laid out on paper at exact sizes, and documents — after booking.
  studioWebModule(),
  // Printers: the computers paired to print for the workspace — beside the studio that will print through them.
  // Its setup guide shows where a print agent finds the server: the same public socket address the queue's display uses.
  printWebModule({ wsUrl: process.env.NEXT_PUBLIC_WS_URL }),
  // The bell, right of chat's inbox in the header (header-tool order 20).
  notificationWebModule(),
  /*
   * The background runner's one page, in Administration. CORE, not a sub-app
   * (JOBS-PLAN D9): it lists the processes of whichever modules above declare
   * one. The labels are what THIS app calls those modules — the runner may
   * import none of them, so it cannot know. Add a module's here when it
   * declares its first process; without one it is headed by its key.
   */
  jobsWebModule({
    moduleLabels: {
      task: 'Tasks',
      booking: 'Booking',
      studio: 'Print Studio',
      backup: 'Backups',
      platform_billing: 'Billing',
    },
  }),
  /*
   * Server → Backups (issue #2): the server's backup folder, super admins
   * only. Its file downloads go through app/api/backups/download.
   */
  backupWebModule(),
  /*
   * Server → Local Network (#66), after Backups: the shop's local certificate
   * and the address phones open, super admins only. ⚠ Read INLINE, as
   * NEXT_PUBLIC_WS_URL is above: this list is composed for the browser too,
   * where `config/env.ts` (a server-side boot assertion) is not loaded. Off
   * unless exactly "on": no page and no drawer entry, the key kept.
   */
  localNetworkWebModule({ enabled: process.env.NEXT_PUBLIC_LOCAL_NETWORK === 'on' }),
];

/*
 * The workspace's Apps page, handed every sub-app the modules above declare
 * (the queue, notes, tasks, the point of sale, the books, booking and the print studio today). Composed from the list
 * rather than naming them, so a new sub-app module added above appears on the
 * page with no edit here — and
 * `composeApps` throws on two apps sharing a key, which saved layouts depend on.
 */
export const WEB_MODULES: readonly WebModuleDescriptor[] = [
  ...FEATURE_MODULES,
  appHubWebModule({ apps: composeApps(FEATURE_MODULES) }),
];
