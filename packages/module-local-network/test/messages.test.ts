import { LOCAL_NETWORK_API_OFF_MESSAGE, localNetworkStateMessage } from '../src/domain/messages.js';

describe('the page’s words', () => {
  it('says what to run when the certificate is missing', () => {
    expect(localNetworkStateMessage('certificate_missing', { publishedOrigin: 'https://192.168.1.68' })).toContain(
      'pnpm https:setup',
    );
  });

  it('names the origin the profile publishes when it is not on the shop’s network', () => {
    const message = localNetworkStateMessage('origin_invalid', {
      publishedOrigin: 'https://192.168.1.68:8443',
      problem: 'it has a port; Caddy listens on 443 only',
    });
    expect(message).toContain('https://192.168.1.68:8443 (it has a port; Caddy listens on 443 only)');
    expect(message).toContain('pnpm https:setup');
  });

  it('still says what to run when the profile publishes no address', () => {
    expect(localNetworkStateMessage('origin_invalid', { publishedOrigin: null })).toContain('publishes no address');
  });

  it('tells the page that the API’s switch is off, and that a build follows the fix', () => {
    expect(LOCAL_NETWORK_API_OFF_MESSAGE).toContain('pnpm https:setup');
    expect(LOCAL_NETWORK_API_OFF_MESSAGE).toContain('pnpm build');
  });
});
