import { readFile } from 'node:fs/promises';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { localNetworkAddresses } from '../domain/addresses.js';
import { localNetworkStateMessage } from '../domain/messages.js';
import type { LocalNetworkState, LocalNetworkView } from '../types.js';
import { describeCertificate } from './certificate.js';
import type { ResolvedLocalNetworkOptions } from './local-network.options.js';
import { LOCAL_NETWORK_OPTIONS, LOCAL_NETWORK_READ_FILE } from './local-network.tokens.js';

export type LocalNetworkReadFile = (path: string) => Promise<string>;

function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/**
 * The page's answer, worked out on EVERY request rather than once at boot:
 * the file is a few hundred bytes, and reading it each time means a new `pnpm
 * https:setup` (or a deleted `.caddy/`) shows on the next load without
 * restarting the API.
 *
 * ⚠ It opens exactly one path, `certificatePath`, and lists nothing. The
 * folder that file is in holds the authority's private keys.
 */
@Injectable()
export class LocalNetworkService {
  private readonly logger = new Logger('LocalNetwork');
  private readonly read: LocalNetworkReadFile;

  constructor(
    @Inject(LOCAL_NETWORK_OPTIONS) private readonly options: ResolvedLocalNetworkOptions,
    @Optional() @Inject(LOCAL_NETWORK_READ_FILE) read?: LocalNetworkReadFile,
  ) {
    this.read = read ?? readText;
  }

  async view(): Promise<LocalNetworkView> {
    // Off: the answer says so, and nothing is read. A remote server has no certificate to look for.
    const setup = this.options.setup;
    if (!setup) return this.notReady('off', null);
    const { origin } = setup;
    /*
     * ⚠ The origin first, and on a bad one the certificate is not even read:
     * neither is shown when the address is wrong, because a phone that
     * trusts the certificate and opens a wrong address learns nothing but
     * that "it doesn't work".
     */
    if (!origin.ok) return this.notReady('origin_invalid', origin.problem);

    let text: string;
    try {
      text = await this.read(setup.certificatePath);
    } catch (error) {
      // Missing is the ordinary case (`.caddy/` deleted, or not copied to this computer); anything else is logged.
      if ((error as { code?: unknown }).code !== 'ENOENT') {
        this.logger.warn({ event: 'local_network.certificate_unreadable', code: (error as { code?: unknown }).code });
      }
      return this.notReady('certificate_missing', null);
    }

    const described = describeCertificate(text);
    if ('problem' in described) {
      this.logger.warn({ event: 'local_network.certificate_refused', problem: described.problem });
      return this.notReady('certificate_missing', null);
    }

    const addresses = localNetworkAddresses(origin.host);
    return {
      state: 'ready',
      problem: null,
      appUrl: addresses.appUrl,
      certificateUrl: addresses.certificateUrl,
      certificate: described.view,
    };
  }

  private notReady(state: Exclude<LocalNetworkState, 'ready'>, problem: string | null): LocalNetworkView {
    return {
      state,
      problem: localNetworkStateMessage(state, { publishedOrigin: this.options.publishedOrigin, problem }),
      appUrl: null,
      certificateUrl: null,
      certificate: null,
    };
  }
}
