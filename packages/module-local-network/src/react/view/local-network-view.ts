/**
 * The page's pure rules, kept out of the component so they are tested
 * (frontend rules: "a long page is tolerated; untested logic inside it is
 * not").
 */

/**
 * Whether the fingerprints are shown, from the page's own protocol.
 *
 * ⚠ A fingerprint proves something only on a screen whose connection is
 * already authenticated (§2). Over `http://` anyone on the Wi-Fi can rewrite
 * the page and the fingerprint on it, so it is not shown there at all, only
 * why.
 *
 * Over `https:` it is shown, but ⚠ that is NOT proof either: a browser that
 * clicked through a certificate warning still reports `https:`, and nothing a
 * page can read says whether its certificate was trusted. So the page shows
 * the fingerprints WITH the rule ("only if this page opened with no
 * warning"), for the person to follow; it cannot enforce it.
 */
export function fingerprintsShown(protocol: string): boolean {
  return protocol === 'https:';
}

/** The certificate's expiry as a date in the viewer's own zone: this page is outside any workspace. */
export function formatExpiry(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** One device's place to read the fingerprint, and the moment to compare it. */
export interface DeviceFingerprintStep {
  device: string;
  /** `SHA-256` or `SHA-1`: which of the two the device shows. */
  fingerprint: 'SHA-256' | 'SHA-1';
  where: string;
  when: string;
}

/**
 * Where each device shows the fingerprint, and so when to compare
 * (docs/LOCAL-NETWORK-PLAN.md §2). Menu names differ between versions, so each
 * step also says WHICH fingerprint to look for.
 *
 * ⚠ Android shows it only after installing, so its step is "compare straight
 * after, and remove it at once if it differs" — the one device where the
 * comparison comes too late to stop the install.
 */
export const DEVICE_FINGERPRINT_STEPS: readonly DeviceFingerprintStep[] = [
  {
    device: 'iPhone, iPad',
    fingerprint: 'SHA-256',
    where: 'Settings → General → VPN & Device Management → the profile → More Details → the certificate',
    when: 'Before Install, and before turning on full trust in Certificate Trust Settings.',
  },
  {
    device: 'Android',
    fingerprint: 'SHA-256',
    where: 'Settings → Security → Encryption & credentials → Trusted credentials → User → the certificate',
    when: 'Straight after installing. If it differs, remove it there at once.',
  },
  {
    device: 'Mac',
    fingerprint: 'SHA-256',
    where: 'Keychain Access → the certificate → Details',
    when: 'Before setting Always Trust.',
  },
  {
    device: 'Windows',
    fingerprint: 'SHA-1',
    where: 'The certificate window → Details → Thumbprint',
    when: 'Before Install Certificate.',
  },
  {
    device: 'Firefox',
    fingerprint: 'SHA-256',
    where: 'Settings → Certificates → View Certificates → Authorities → the certificate → View',
    when: 'Before ticking “Trust this CA to identify websites”.',
  },
];
