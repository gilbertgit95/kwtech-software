import type { LimitChecker } from '@kwtech/module-kit';
import { formatDisplayCode, isDisplayPassShaped, MAX_FAILED_CODE_ATTEMPTS } from '../src/domain/session.js';
import type { QueueWorkspaceLocator } from '../src/server/ports.js';
import { hashDisplayPass, QueueDisplayService } from '../src/server/queue-display.service.js';
import { QueueWriteService } from '../src/server/queue-write.service.js';
import { fakeClient } from './fake-client.js';

/**
 * A TV exchanging a code for a pass. Every refusal is null, and the tests below
 * are mostly about what else must — and must not — happen alongside it.
 */

const SCOPE = { organizationId: 'org', workspaceId: 'ws' };

const locator: QueueWorkspaceLocator = {
  async locate(organizationKey, workspaceKey) {
    return organizationKey === 'acme' && workspaceKey === 'main'
      ? { organizationId: 'org', workspaceId: 'ws', workspaceName: 'Main branch' }
      : null;
  },
};

const displaysCap = (limit: number): LimitChecker => ({
  async check({ current }) {
    return { allowed: current < limit, limit, current, remaining: Math.max(0, limit - current) };
  },
});

async function started(maxDisplays = 5) {
  const { client, state } = fakeClient();
  const writes = new QueueWriteService(client, displaysCap(maxDisplays));
  const session = await writes.startQueue(SCOPE, 'boss', { continueNumbering: false });
  return {
    state,
    writes,
    code: session.displayCode as string,
    displays: new QueueDisplayService(client, locator),
    attempts: () => state.queueSession[0]?.failedCodeAttempts,
  };
}

describe('QueueDisplayService.openDisplay', () => {
  it('exchanges the right code, typed the way a person would, for a pass', async () => {
    const { displays, code } = await started();
    const opened = await displays.openDisplay('acme', 'main', formatDisplayCode(code).toLowerCase());

    expect(isDisplayPassShaped(opened?.pass)).toBe(true);
    expect(opened?.workspaceName).toBe('Main branch');
  });

  it('⚠ stores only the hash of the pass', async () => {
    const { displays, code, state } = await started();
    const opened = await displays.openDisplay('acme', 'main', code);

    expect(state.queueDisplayPass).toHaveLength(1);
    expect(state.queueDisplayPass[0]?.tokenHash).toBe(hashDisplayPass(opened?.pass as string));
    expect(state.queueDisplayPass[0]?.tokenHash).not.toBe(opened?.pass);
  });

  it('⚠ counts a wrong code, and keeps the count though the answer is a refusal', async () => {
    const { displays, attempts } = await started();
    expect(await displays.openDisplay('acme', 'main', 'AAAA-AAAA')).toBeNull();
    expect(attempts()).toBe(1);
  });

  it('⚠ refuses even the right code once the attempts are used up', async () => {
    const { displays, code, state } = await started();
    (state.queueSession[0] as { failedCodeAttempts: number }).failedCodeAttempts = MAX_FAILED_CODE_ATTEMPTS;

    expect(await displays.openDisplay('acme', 'main', code)).toBeNull();
    expect(state.queueDisplayPass).toHaveLength(0);
  });

  it('refuses a right code on a full session, without counting it as a wrong one', async () => {
    const { displays, code, attempts } = await started(1);
    expect(await displays.openDisplay('acme', 'main', code)).not.toBeNull();
    expect(await displays.openDisplay('acme', 'main', code)).toBeNull();
    expect(attempts()).toBe(0);
  });

  it('⚠ answers an unknown organization, an unknown workspace and a stopped queue identically', async () => {
    const { displays, code, writes, attempts } = await started();
    const unknownOrganization = await displays.openDisplay('globex', 'main', code);
    const unknownWorkspace = await displays.openDisplay('acme', 'annex', code);
    await writes.stopQueue(SCOPE, 'boss');
    const stopped = await displays.openDisplay('acme', 'main', code);

    expect([unknownOrganization, unknownWorkspace, stopped]).toEqual([null, null, null]);
    expect(attempts()).toBe(0);
  });

  it('refuses a code too long to be one, without reading it', async () => {
    const { displays, code } = await started();
    expect(await displays.openDisplay('acme', 'main', `${code}${' '.repeat(40)}`)).toBeNull();
  });

  it('opens nothing when the host bound no locator', async () => {
    const { client } = fakeClient();
    expect(await new QueueDisplayService(client).openDisplay('acme', 'main', 'K7QM4XHT')).toBeNull();
  });
});
