/**
 * Which install instructions a device needs, and whether it is already running
 * the installed app.
 *
 * Kept apart from the page so the one fiddly rule — an iPad that says it is a
 * Mac — lives in exactly one place.
 */

/**
 * The three ways in.
 *
 * - `ios`: Safari's Share → Add to Home Screen. iOS never offers an install
 *   prompt of its own, so the steps are the whole story.
 * - `android`: Chrome's "Install app", which this page can trigger directly
 *   once the browser hands it `beforeinstallprompt`.
 * - `desktop`: Chrome or Edge can install it too, but the page's real job there
 *   is a QR code to carry the link to a phone.
 */
export type InstallPlatform = 'ios' | 'android' | 'desktop';

/**
 * ⚠ iPadOS 13 and later report a Macintosh user agent to get desktop sites.
 * The tell is a touch screen, which no Mac has: without that check an iPad
 * would be shown desktop instructions and a QR code pointing at itself.
 */
export function detectInstallPlatform(device: { userAgent: string; maxTouchPoints: number }): InstallPlatform {
  const ua = device.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && device.maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/**
 * True when the page was opened from the home-screen icon rather than in a
 * browser tab.
 *
 * Two checks because the platforms disagree: Chrome and current Safari answer
 * the `display-mode` media query, and older iOS only sets the non-standard
 * `navigator.standalone`. Browser-only: call it from an effect, never during
 * render, or the server's markup and the client's first pass differ.
 */
export function isRunningInstalled(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // A Safari-only property that the DOM typings do not declare.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Calls `onChange` whenever the page moves into or out of the installed app,
 * and returns the unsubscribe.
 *
 * ⚠ Reading `isRunningInstalled()` once on mount is not enough. On a computer,
 * Chrome and Edge move the open tab INTO the new app window when someone
 * installs from this page, without reloading it: the page is now standalone,
 * with no browser bar and no back button, and a value read at mount still
 * says "in a browser" (issue #42). The media query's `change` event is what
 * reports the move.
 */
export function watchRunningInstalled(onChange: (installed: boolean) => void): () => void {
  const query = window.matchMedia('(display-mode: standalone)');
  function handle() {
    onChange(isRunningInstalled());
  }
  query.addEventListener('change', handle);
  return () => query.removeEventListener('change', handle);
}

/**
 * True when the page before this one was a page of this app, so going BACK
 * returns to it (the module the person opened the user menu from) rather than
 * leaving the app.
 *
 * A same-origin referrer is the test. Without one — the QR code, a link in a
 * message, a fresh app window — `history.back()` would go to another site or
 * nowhere, so the caller follows its `/` link instead.
 */
export function cameFromThisApp(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    // An unparsable referrer is no evidence of where the person came from.
    return false;
  }
}
