import { POS_FEATURE } from '../src/feature-keys.js';
import { POS_MOBILE_SECTION, posMobileModule } from '../src/mobile/index.js';

/** What adopting the point of sale offers the phone layout. */
describe('posMobileModule', () => {
  const screen = posMobileModule().screens?.[0];
  if (!screen) throw new Error('posMobileModule declares no screen.');

  it('offers Take orders to sellers, Cashier to whoever may take payment (issue #69), Orders to whoever may see orders (issue #72)', () => {
    expect(screen.sections).toEqual([
      { key: 'sell', label: 'Take orders', feature: POS_FEATURE.sell },
      { key: 'cashier', label: 'Cashier', feature: POS_FEATURE.takePayment },
      { key: 'orders', label: 'Orders', feature: POS_FEATURE.read },
    ]);
  });

  it('⚠ keeps the section keys stable — they are kept in addresses and on home screens', () => {
    expect(POS_MOBILE_SECTION).toEqual({ sell: 'sell', cashier: 'cashier', orders: 'orders' });
  });

  it('gates the app itself on pos:read, as the Apps page does', () => {
    expect(screen).toEqual(expect.objectContaining({ key: 'pos', feature: POS_FEATURE.read }));
  });
});
