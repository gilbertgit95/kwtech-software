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
