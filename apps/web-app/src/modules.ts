import { authWebModule } from '@kwtech/module-auth/react';
import { chatWebModule } from '@kwtech/module-chat/react';
import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { notificationWebModule } from '@kwtech/module-notification/react';
import { permissionsWebModule } from '@kwtech/module-permissions/react';
import { queueWebModule } from '@kwtech/module-queuing-window/react';

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
export const WEB_MODULES: readonly WebModuleDescriptor[] = [
  authWebModule,
  permissionsWebModule,
  chatWebModule(),
  // The public display opens its own socket, so it needs to know where the API is.
  queueWebModule({ wsUrl: process.env.NEXT_PUBLIC_WS_URL }),
  // The bell, right of chat's inbox in the header (header-tool order 20).
  notificationWebModule(),
];
