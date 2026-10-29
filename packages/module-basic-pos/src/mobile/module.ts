import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { POS_FEATURE } from '../feature-keys.js';
import { PosSellScreen } from './pos-sell-screen.js';

/**
 * What the point of sale offers the phone layout (issue #22): one app, the
 * till — selling only.
 *
 * Gated by `pos:sell`, not `pos:read`: the phone app IS selling, so somebody
 * who may look at the point of sale but not sell would be shown a till that
 * refuses every sale. The till's own API authorises every request anyway.
 */
export function posMobileModule(): MobileModuleDescriptor {
  return {
    key: 'pos',
    screens: [
      { key: 'pos', label: 'Sell', icon: 'store', feature: POS_FEATURE.sell, order: 10, component: PosSellScreen },
    ],
  };
}
