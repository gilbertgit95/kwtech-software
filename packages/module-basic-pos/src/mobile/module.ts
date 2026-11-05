import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { POS_FEATURE } from '../feature-keys.js';
import { PosMobileApp } from './pos-mobile-app.js';
import { POS_MOBILE_SECTION } from './sections.js';

/**
 * What the point of sale offers the phone layout (issue #22): the Point of
 * sale app, with its SECTIONS — Sell (Take orders); Cashier (issue #69) for
 * whoever may take payment, so a cashier or a manager never has to be at a
 * desktop to settle a held order; and Orders (issue #72), past orders to find,
 * open and print. Items, Reports and the others join here as sections when
 * they come to the phone, each gated by its own key, without the app or its
 * address changing.
 *
 * The app is gated by `pos:read`, as on the Apps page; Sell by `pos:sell`;
 * Cashier by `pos:take_payment`, as the full screen's Cashier tab is; Orders
 * by `pos:read`, as the full screen's Orders tab is — so whoever may open the
 * app at all has it, a seller who may not sell included. The
 * phone frame offers an app only while its holder has at least one of its
 * sections, so somebody who may look at the point of sale but not sell is not
 * shown a point of sale with nothing in it. The till's API authorises anyway.
 */
export function posMobileModule(): MobileModuleDescriptor {
  return {
    key: 'pos',
    screens: [
      {
        key: 'pos',
        label: 'Point of sale',
        icon: 'store',
        feature: POS_FEATURE.read,
        order: 10,
        sections: [
          { key: POS_MOBILE_SECTION.sell, label: 'Take orders', feature: POS_FEATURE.sell },
          { key: POS_MOBILE_SECTION.cashier, label: 'Cashier', feature: POS_FEATURE.takePayment },
          { key: POS_MOBILE_SECTION.orders, label: 'Orders', feature: POS_FEATURE.read },
        ],
        component: PosMobileApp,
      },
    ],
  };
}
