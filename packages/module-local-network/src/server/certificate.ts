import { X509Certificate } from 'node:crypto';
import type { LocalNetworkCertificateView } from '../types.js';

/** Why a file was not shown as the certificate. Logged, never shown: the page says "not set up". */
export type CertificateProblem = 'holds_a_private_key' | 'not_a_certificate';

/**
 * The certificate's details, from the text of `root.crt`, or why not.
 *
 * ⚠ NOTHING FROM THE FILE IS ECHOED. The PEM returned is the PARSED
 * certificate re-encoded (`toString()`), never the file's bytes, so whatever
 * else a file holds cannot reach the page. And a file that holds a private
 * key at all is refused outright: it means the app was pointed at the wrong
 * file, and a page showing "not set up" is right until somebody fixes that.
 *
 * Fingerprints are colon-separated upper-case hex, as `openssl x509
 * -fingerprint` prints them and as the devices show them.
 */
export function describeCertificate(
  text: string,
): { view: LocalNetworkCertificateView } | { problem: CertificateProblem } {
  if (/PRIVATE KEY/u.test(text)) return { problem: 'holds_a_private_key' };
  if (!text.includes('-----BEGIN CERTIFICATE-----')) return { problem: 'not_a_certificate' };
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(text);
  } catch {
    return { problem: 'not_a_certificate' };
  }
  const expires = new Date(certificate.validTo);
  if (Number.isNaN(expires.getTime())) return { problem: 'not_a_certificate' };
  return {
    view: {
      pem: certificate.toString(),
      sha256: certificate.fingerprint256,
      sha1: certificate.fingerprint,
      // One line, as a device's details screen shows it: Node separates the parts with newlines.
      subject: certificate.subject.split('\n').join(', '),
      expiresAt: expires.toISOString(),
    },
  };
}
