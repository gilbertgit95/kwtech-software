import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOCAL_NETWORK_CERTIFICATE_FILE, localNetworkAddresses } from '../src/domain/addresses.js';

describe('localNetworkAddresses', () => {
  it('builds the app over HTTPS and the certificate over plain HTTP, from the host', () => {
    expect(localNetworkAddresses('192.168.1.68')).toEqual({
      appUrl: 'https://192.168.1.68',
      certificateUrl: 'http://192.168.1.68/kwtech-local-ca.crt',
    });
  });

  it('⚠ downloads from the path Caddy serves without TLS', () => {
    // The Caddyfile is the other half of this contract. A QR code for any other
    // path is redirected to HTTPS, which a phone that does not trust the
    // certificate yet cannot open.
    const caddyfile = readFileSync(resolve(__dirname, '../../../deploy/https/Caddyfile'), 'utf8');
    expect(caddyfile).toContain(`handle /${LOCAL_NETWORK_CERTIFICATE_FILE} {`);
  });
});
