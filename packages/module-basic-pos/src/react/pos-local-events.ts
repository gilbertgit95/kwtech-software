import type { POS_OPERATIONS } from '../operations.js';
import type { PosEventView, PosScopeView } from './pos-client.js';

/**
 * This browser's own writes, told to this browser's own screens AT ONCE
 * (issue #50).
 *
 * Every write already publishes a `posEvents` change on the server, and every
 * screen re-reads when it hears one. But that round trip is the socket's, and
 * with the socket down a change made on the Items tab never reached the Sell
 * tab in the SAME page: the reference dialog kept the old list until a reload.
 * So a write that succeeds is also announced here, in the page, with the same
 * kind the server will publish, and the screens treat it exactly like the
 * socket's event. With the socket up the server's copy arrives a moment later
 * and the debounce folds the two into one read.
 *
 * ⚠ A MODULE-LEVEL CHANNEL, deliberately, and not a context: the client that
 * announces is made by `createPosClient` wherever a hook needs one, and a
 * provider would have to be threaded to every one of them. Listeners filter by
 * workspace, so two stores open on one Apps page do not hear each other.
 */

type PosOperationName = keyof typeof POS_OPERATIONS;

/** The kinds a write here can announce — the server's `PosChange`s that a write causes. */
export type PosLocalChange = 'catalogue' | 'customers' | 'settings' | 'order';

/**
 * What each write announces when it succeeds: the SAME kinds its server
 * service publishes (`events.changed(...)` in `src/server/`). An order write
 * announces the order it answers with.
 *
 * ⚠ EVERY MUTATION IS LISTED. `test/local-events.test.ts` fails on a new
 * mutation missing from here, so a new write cannot silently stop refreshing
 * the screens beside it.
 */
export const POS_WRITE_ECHOES = {
  savePosItem: ['catalogue'],
  setPosItemArchived: ['catalogue'],
  setPosAvailability: ['catalogue'],
  // A setup import may also replace the reference options (`pos-setup.service.ts`).
  importPosSetup: ['catalogue', 'settings'],
  savePosCategory: ['catalogue'],
  setPosCategoryArchived: ['catalogue'],
  savePosOrderTypeOption: ['catalogue'],
  setPosOrderTypeOptionArchived: ['catalogue'],
  setPosDefaultOrderType: ['catalogue'],
  savePosCustomer: ['customers'],
  setPosCustomerArchived: ['customers'],
  savePosSettings: ['settings'],
  savePosReferenceOptions: ['settings'],
  // Order sounds (issue #68): a Cashier screen beside the Settings tab hears the new choice at once.
  savePosAlertTones: ['settings'],
  savePosMyAlertTones: ['settings'],
  createPosOrder: ['order'],
  addPosOrderLine: ['order'],
  updatePosOrderLine: ['order'],
  removePosOrderLine: ['order'],
  refreshPosOrderLine: ['order'],
  setPosOrderCustomer: ['order'],
  setPosOrderLabel: ['order'],
  setPosOrderType: ['order'],
  holdPosOrder: ['order'],
  payPosOrder: ['order'],
  payLaterPosOrder: ['order'],
  cancelPosOrder: ['order'],
  settlePosChangeOwed: ['order'],
  setPosLineDiscount: ['order'],
  setPosOrderDiscount: ['order'],
  refundPosOrder: ['order'],
  voidPosOrder: ['order'],
} as const satisfies Partial<Record<PosOperationName, readonly PosLocalChange[]>>;

/** A write this channel announces. */
export type PosWriteName = keyof typeof POS_WRITE_ECHOES;

export function isPosWrite(operation: string): operation is PosWriteName {
  return Object.hasOwn(POS_WRITE_ECHOES, operation);
}

/** One announcement: the event a screen already handles, for a workspace. */
export interface PosLocalEvent {
  scope: PosScopeView;
  event: PosEventView;
}

const listeners = new Set<(announced: PosLocalEvent) => void>();

/**
 * Tells this page's screens what a successful write changed. `orderId` is the
 * order an order write answered with. `actorId` is null: this page made it.
 */
export function announcePosWrite(scope: PosScopeView, operation: PosWriteName, orderId: string | null): void {
  for (const kind of POS_WRITE_ECHOES[operation]) {
    const announced: PosLocalEvent = {
      scope,
      event: { kind, orderId: kind === 'order' ? orderId : null, actorId: null },
    };
    for (const listener of [...listeners]) {
      // ⚠ A screen's failure is its own: it must not stop the next one hearing, nor fail the write.
      try {
        listener(announced);
      } catch (error) {
        console.warn('Point of sale: a screen could not take a change.', error);
      }
    }
  }
}

/** Hears this page's writes in `scope`'s workspace. Returns the unsubscribe. */
export function onPosWrite(scope: PosScopeView, listener: (event: PosEventView) => void): () => void {
  const filtered = (announced: PosLocalEvent) => {
    if (announced.scope.organizationId !== scope.organizationId) return;
    if (announced.scope.workspaceId !== scope.workspaceId) return;
    listener(announced.event);
  };
  listeners.add(filtered);
  return () => {
    listeners.delete(filtered);
  };
}
