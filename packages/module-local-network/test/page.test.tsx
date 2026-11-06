import { renderToStaticMarkup } from 'react-dom/server';
import { LocalNetworkSections } from '../src/react/pages/local-network-page.js';
import type { LocalNetworkView } from '../src/types.js';

const READY: LocalNetworkView = {
  state: 'ready',
  problem: null,
  appUrl: 'https://192.168.1.68',
  certificateUrl: 'http://192.168.1.68/kwtech-local-ca.crt',
  certificate: {
    pem: '-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n',
    sha256: 'D1:8A:55',
    sha1: '41:E5:C0',
    subject: 'CN=Caddy Local Authority - 2026 ECC Root',
    expiresAt: '2036-09-03T05:13:29.000Z',
  },
};

function render(view: LocalNetworkView, protocol: string): string {
  return renderToStaticMarkup(<LocalNetworkSections view={view} protocol={protocol} />);
}

describe('the Local Network page', () => {
  it('shows the certificate, both QR codes, the address and this computer’s line when ready', () => {
    const html = render(READY, 'https:');
    expect(html).toContain('Download certificate');
    expect(html).toContain('QR code for http://192.168.1.68/kwtech-local-ca.crt');
    expect(html).toContain('QR code for https://192.168.1.68');
    expect(html).toContain('https://localhost');
    expect(html).toContain('trusts <strong>any</strong> site');
  });

  it('shows both fingerprints over HTTPS, with the rule to follow', () => {
    const html = render(READY, 'https:');
    expect(html).toContain('D1:8A:55');
    expect(html).toContain('41:E5:C0');
    expect(html).toContain('Compare only if this page opened with <strong>no</strong> certificate warning');
  });

  it('⚠ shows no fingerprint over plain HTTP, only why', () => {
    const html = render(READY, 'http:');
    expect(html).not.toContain('D1:8A:55');
    expect(html).not.toContain('41:E5:C0');
    expect(html).toContain('Not shown on a page opened over');
  });

  it('⚠ shows only the reason, and no certificate or address, when not set up', () => {
    const html = render(
      {
        state: 'origin_invalid',
        problem: 'Local Network is on, but this profile publishes https://192.168.1.68:8443 (it has a port).',
        appUrl: null,
        certificateUrl: null,
        certificate: null,
      },
      'https:',
    );
    expect(html).toContain('Not set up');
    expect(html).toContain('https://192.168.1.68:8443 (it has a port)');
    expect(html).not.toContain('Download certificate');
    expect(html).not.toContain('QR code');
  });
});
