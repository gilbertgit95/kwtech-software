import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLocalNetworkOptions } from '../src/server/local-network.options.js';
import { LocalNetworkService } from '../src/server/local-network.service.js';
import type { LocalNetworkOriginCheck } from '../src/types.js';

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'root.crt'), 'utf8');
const ON_THE_SHOP_NETWORK: LocalNetworkOriginCheck = { ok: true, host: '192.168.1.68' };

/**
 * A folder laid out as Caddy's `pki/authorities/local/` is: the public root
 * certificate beside the files that must never be opened.
 */
let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'local-network-'));
  writeFileSync(join(folder, 'root.crt'), FIXTURE);
  writeFileSync(join(folder, 'root.key'), '-----BEGIN EC PRIVATE KEY-----\nroot\n-----END EC PRIVATE KEY-----\n');
  writeFileSync(
    join(folder, 'intermediate.key'),
    '-----BEGIN EC PRIVATE KEY-----\nint\n-----END EC PRIVATE KEY-----\n',
  );
  writeFileSync(join(folder, 'intermediate.crt'), FIXTURE);
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

/** The real reader, recording every path it is asked for. */
function recordingReader(): { opened: string[]; read: (path: string) => Promise<string> } {
  const opened: string[] = [];
  return {
    opened,
    read: (path) => {
      opened.push(path);
      return readFile(path, 'utf8');
    },
  };
}

function service(
  origin: LocalNetworkOriginCheck,
  read: (path: string) => Promise<string>,
  certificatePath = join(folder, 'root.crt'),
): LocalNetworkService {
  const options = resolveLocalNetworkOptions({
    enabled: true,
    certificatePath,
    origin,
    publishedOrigin: 'https://192.168.1.68:8443',
  });
  return new LocalNetworkService(options, read);
}

describe('LocalNetworkService', () => {
  it('shows the certificate and both addresses when everything is set up', async () => {
    const view = await service(ON_THE_SHOP_NETWORK, recordingReader().read).view();
    expect(view.state).toBe('ready');
    expect(view.problem).toBeNull();
    expect(view.appUrl).toBe('https://192.168.1.68');
    expect(view.certificateUrl).toBe('http://192.168.1.68/kwtech-local-ca.crt');
    expect(view.certificate?.sha256).toMatch(/^D1:8A:55/u);
  });

  it('⚠ opens root.crt and nothing else in its folder', async () => {
    const reader = recordingReader();
    const view = await service(ON_THE_SHOP_NETWORK, reader.read).view();
    expect(reader.opened).toEqual([join(folder, 'root.crt')]);
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');
  });

  it('⚠ shows nothing, and reads nothing, when the origin is not on the shop’s network', async () => {
    const reader = recordingReader();
    const view = await service({ ok: false, problem: 'it has a port' }, reader.read).view();
    expect(reader.opened).toEqual([]);
    expect(view).toEqual({
      state: 'origin_invalid',
      problem: expect.stringContaining('https://192.168.1.68:8443 (it has a port)'),
      appUrl: null,
      certificateUrl: null,
      certificate: null,
    });
  });

  it('says "not set up", and shows no address, when the certificate is missing', async () => {
    rmSync(join(folder, 'root.crt'));
    const view = await service(ON_THE_SHOP_NETWORK, recordingReader().read).view();
    expect(view.state).toBe('certificate_missing');
    expect(view.problem).toContain('pnpm https:setup');
    expect([view.appUrl, view.certificateUrl, view.certificate]).toEqual([null, null, null]);
  });

  it('⚠ treats a file holding a private key as not set up, and returns none of it', async () => {
    writeFileSync(
      join(folder, 'root.crt'),
      `${FIXTURE}-----BEGIN EC PRIVATE KEY-----\nx\n-----END EC PRIVATE KEY-----\n`,
    );
    const view = await service(ON_THE_SHOP_NETWORK, recordingReader().read).view();
    expect(view.state).toBe('certificate_missing');
    expect(view.certificate).toBeNull();
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');
  });

  it('reads the file on every request, so a new https:setup shows without a restart', async () => {
    rmSync(join(folder, 'root.crt'));
    const subject = service(ON_THE_SHOP_NETWORK, recordingReader().read);
    expect((await subject.view()).state).toBe('certificate_missing');
    writeFileSync(join(folder, 'root.crt'), FIXTURE);
    expect((await subject.view()).state).toBe('ready');
  });
});

describe('LocalNetworkService, switched off', () => {
  it('⚠ answers off, shows nothing and opens nothing', async () => {
    const reader = recordingReader();
    const off = new LocalNetworkService(resolveLocalNetworkOptions({}), reader.read);
    const view = await off.view();
    expect(reader.opened).toEqual([]);
    expect(view).toEqual({
      state: 'off',
      problem: expect.stringContaining('LOCAL_NETWORK="on"'),
      appUrl: null,
      certificateUrl: null,
      certificate: null,
    });
  });
});

describe('resolveLocalNetworkOptions', () => {
  it('needs nothing while off: a remote server has no certificate to point at', () => {
    expect(resolveLocalNetworkOptions({ enabled: false }).setup).toBeNull();
    expect(resolveLocalNetworkOptions({}).setup).toBeNull();
  });

  it('stops the boot without a certificate path or an origin, naming the fix', () => {
    expect(() => resolveLocalNetworkOptions({ enabled: true, origin: ON_THE_SHOP_NETWORK })).toThrow(/root\.crt/u);
    expect(() => resolveLocalNetworkOptions({ enabled: true, certificatePath: '/x/root.crt' })).toThrow(
      /checkLocalOrigin/u,
    );
  });

  it('⚠ stops the boot when pointed at a private key', () => {
    expect(() =>
      resolveLocalNetworkOptions({ enabled: true, certificatePath: '/x/root.key', origin: ON_THE_SHOP_NETWORK }),
    ).toThrow(/private key/u);
  });
});
