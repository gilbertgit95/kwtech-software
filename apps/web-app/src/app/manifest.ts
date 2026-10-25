import type { MetadataRoute } from 'next';
import { appBrand } from '@/config/env';

/**
 * The web app manifest: what turns "a site on a phone" into an installable app.
 *
 * Next serves this at `/manifest.webmanifest` and links it from every page's
 * <head> on its own. With it, Chrome on Android offers "Install app" and
 * builds a WebAPK (an entry in the app drawer and in Settings → Apps), and a
 * home-screen icon on an iPhone opens without Safari's bar. Without it, both
 * fall back to a bookmark that opens in an ordinary tab. How people install it
 * is the `/install` page.
 *
 * ⚠ `force-dynamic`. A manifest route is cached at build by default, which
 * would bake APP_NAME into the image: one build could not be deployed under two
 * names, and renaming the product would mean a rebuild rather than a restart.
 * That is the same reason the root layout uses `generateMetadata()`.
 *
 * No service worker. Chrome no longer requires one to offer the install, and a
 * worker that caches pages is the classic way to serve a signed-out user a
 * signed-in page, or yesterday's build, from the cache. It arrives with offline
 * support or web push, whichever is built first (PLAN §12).
 */
export const dynamic = 'force-dynamic';

/*
 * The icons' background, sampled from `app/apple-icon.png` so that every
 * home-screen icon is the same tile. It is also the splash screen behind the
 * icon while the app starts, and the colour of Android's title bar: a fixed
 * brand colour, because the manifest is read once at install and cannot follow
 * the palette a person picks later.
 */
const BRAND_TILE = '#3a3a3c';

export default function manifest(): MetadataRoute.Manifest {
  const { name, tagline } = appBrand();
  return {
    // `id` pins the app's identity to the root. Without it the browser derives
    // one from start_url, and changing start_url later would make every
    // installed copy a different app from the one the site now offers.
    id: '/',
    name,
    short_name: name,
    description: tagline ? `${name} — ${tagline}` : name,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: BRAND_TILE,
    theme_color: BRAND_TILE,
    /*
     * Made from `public/brand/logo-full.png`'s mark, composed on BRAND_TILE.
     * `maskable` is a separate file with the mark at 60% rather than 78%:
     * Android crops it into a circle or squircle, and only the centre 80%
     * survives every shape. One file serving both would either be cropped
     * through the logo or look shrunken where nothing is cropped.
     */
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
