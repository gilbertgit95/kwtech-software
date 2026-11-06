import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeCertificate } from '../src/server/certificate.js';

/**
 * `fixtures/root.crt` is a throwaway CA certificate made for this suite; its
 * key was deleted when it was made. The expected values are what `openssl
 * x509 -noout -fingerprint -sha256` / `-sha1` / `-enddate` printed for it.
 */
const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'root.crt'), 'utf8');
const SHA256 = 'D1:8A:55:1A:EF:82:DE:79:1A:29:AF:8A:28:24:FB:D9:CC:DE:6E:80:1F:C4:A9:E6:8F:64:21:D0:00:8B:E6:32';
const SHA1 = '41:E5:C0:82:23:93:5F:8B:C2:C4:F3:3F:BF:80:3B:F1:B9:29:C0:09';

describe('describeCertificate', () => {
  it('gives the fingerprints openssl gives, the subject and the expiry', () => {
    const described = describeCertificate(FIXTURE);
    if (!('view' in described)) throw new Error(`refused: ${described.problem}`);
    expect(described.view.sha256).toBe(SHA256);
    expect(described.view.sha1).toBe(SHA1);
    expect(described.view.subject).toBe('CN=Test Local Authority - ECC Root');
    expect(described.view.expiresAt).toBe('2036-11-03T01:15:07.000Z');
    expect(described.view.pem.trim()).toBe(FIXTURE.trim());
  });

  it('⚠ refuses a file that holds a private key, even beside a certificate', () => {
    const withKey = `${FIXTURE}-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----\n`;
    expect(describeCertificate(withKey)).toEqual({ problem: 'holds_a_private_key' });
    expect(describeCertificate('-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----\n')).toEqual({
      problem: 'holds_a_private_key',
    });
  });

  it('⚠ never echoes the file: only the parsed certificate is returned', () => {
    const described = describeCertificate(`a comment somebody left\n${FIXTURE}trailing text\n`);
    if (!('view' in described)) throw new Error(`refused: ${described.problem}`);
    expect(described.view.pem).not.toContain('a comment');
    expect(described.view.pem).not.toContain('trailing');
  });

  it('refuses what is not a certificate', () => {
    expect(describeCertificate('')).toEqual({ problem: 'not_a_certificate' });
    expect(describeCertificate('-----BEGIN CERTIFICATE-----\nnot base64\n-----END CERTIFICATE-----\n')).toEqual({
      problem: 'not_a_certificate',
    });
  });
});
