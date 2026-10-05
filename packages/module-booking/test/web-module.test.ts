import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeApps, composeNav, composeRoutes } from '@kwtech/module-kit';
import { BOOKING_FEATURE } from '../src/feature-keys.js';
import { BookingApp } from '../src/react/booking-app.js';
import { bookingWebModule } from '../src/react/module.js';
import { bookingManageHref, bookingPublicHref } from '../src/react/routes.js';

/** What adopting booking on the web contributes. */
describe('bookingWebModule', () => {
  const module = bookingWebModule();

  it('offers booking on the Apps page, gated on booking:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({
        key: 'booking',
        label: 'Booking',
        feature: BOOKING_FEATURE.read,
        component: BookingApp,
      }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['booking']);
  });

  it('⚠ puts nothing in the drawer — a sub-app is reached from the Apps page', () => {
    expect(composeNav([module], [BOOKING_FEATURE.read], { params: {} })).toEqual([]);
  });

  it('⚠ has exactly two routes, both the CUSTOMER’s: public, fullscreen, keyed on nothing', () => {
    const routes = composeRoutes([module]);
    expect(routes.map((route) => route.path)).toEqual(['/book/:linkId', '/my-booking/:token']);
    for (const route of routes) {
      expect([route.path, route.feature, route.chrome, route.nav]).toEqual([
        route.path,
        undefined,
        'fullscreen',
        undefined,
      ]);
    }
  });

  it('builds the two addresses, encoding what goes into them', () => {
    expect(bookingPublicHref('aB3_-x')).toBe('/book/aB3_-x');
    expect(bookingManageHref('a/b?c')).toBe('/my-booking/a%2Fb%3Fc');
  });

  it('carries its keys and its cap, so an app composing descriptors sees them', () => {
    expect(module.features?.map((spec) => spec.key)).toEqual(Object.values(BOOKING_FEATURE));
    expect(module.limits?.map((spec) => spec.key)).toEqual(['booking:resources']);
  });
});

/** Every file under a directory, as paths. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

describe('the React half', () => {
  const files = filesUnder(join(__dirname, '..', 'src', 'react'));
  const sources = files.map((file) => ({ file, source: readFileSync(file, 'utf8') }));

  it('⚠ never imports the server half — it would ship Nest to the browser', () => {
    const offenders = sources.filter(({ source }) => /from '\.\.\/(\.\.\/)?server\//u.test(source));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it('⚠ never calls a request a booking to the customer (D2): the page asks, it does not book', () => {
    const page = sources.find(({ file }) => file.endsWith('public-booking-page.tsx'))?.source ?? '';
    expect(page).toContain('Request this booking');
    expect(page).toContain('We will confirm your booking');
    expect(page).toContain('you are not booked until we do');
    expect(page).not.toMatch(/>\s*(Book now|You are booked|Booking confirmed)/iu);
  });

  it('⚠ names no trade (D1): services and resources, never a stylist or a printer’s shop', () => {
    const trade = /\b(stylist|barber|salon|haircut|dentist|clinic|tarpaulin)\b/iu;
    expect(sources.filter(({ source }) => trade.test(source)).map(({ file }) => file)).toEqual([]);
  });
});

/**
 * There are no render tests here, so the dialog's rule is held by reading it
 * (the operator, 2026-10-05: a form closed by itself and lost what was typed).
 */
describe('the dialog every form opens in', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'react', 'components', 'controls.tsx'), 'utf8');
  const dialog = source.slice(source.indexOf('<dialog'), source.indexOf('</dialog>'));

  it('⚠ does not close on a press outside it — selecting text and letting go outside the box is one', () => {
    expect(dialog).toContain('<dialog');
    expect(dialog).not.toMatch(/<dialog[^>]*\bonClick=/su);
  });

  it('⚠ refuses Escape once something has been typed or chosen, and says so', () => {
    expect(dialog).toMatch(
      /onCancel=\{\(event\) => \{\s*if \(!changed\.current\) return;\s*event\.preventDefault\(\);/u,
    );
    expect(dialog).toContain('onInput={');
    expect(dialog).toContain('Kept open so what you entered is not lost');
  });

  it('still has a visible way out', () => {
    expect(dialog).toContain('aria-label="Close"');
  });
});
