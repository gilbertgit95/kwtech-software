import type { LimitChecker } from '@kwtech/module-kit';
import { emptyLayoutSpec, type StudioLayoutSpec } from '../src/domain/layout.js';
import { inches, mm } from '../src/domain/units.js';
import { StudioResolver } from '../src/server/graphql/studio.resolver.js';
import type { StudioAccessCheck, StudioMemberDirectory } from '../src/server/ports.js';
import type { StudioModuleOptions } from '../src/server/studio.options.js';
import { StudioService } from '../src/server/studio.service.js';
import { StudioPruneLogsProcess } from '../src/server/studio-prune.process.js';
import { StudioSettingsService } from '../src/server/studio-settings.service.js';
import { StudioWriteService } from '../src/server/studio-write.service.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the service, resolver and process suites. */

export const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
export const OTHER_WORKSPACE = { organizationId: 'org-1', workspaceId: 'ws-2' };
export const ANA = 'user-ana';
export const BEN = 'user-ben';
export const CAL = 'user-cal';

/** A 4R sheet with 3 mm margins and two 1 × 1 cells. */
export function sampleSpec(overrides: Partial<StudioLayoutSpec> = {}): StudioLayoutSpec {
  return {
    ...emptyLayoutSpec({ key: '4r', label: '4R', width: inches(4), height: inches(6) }, mm(3)),
    cells: [
      { x: 0, y: 0, width: inches(1), height: inches(1), label: '1 × 1' },
      { x: inches(1) + mm(2), y: 0, width: inches(1), height: inches(1), label: '1 × 1' },
    ],
    ...overrides,
  };
}

export interface HarnessOptions {
  limits?: LimitChecker;
  /** Who holds `studio:manage_all`. Omitted: the port is UNBOUND. */
  managers?: readonly string[];
  directory?: StudioMemberDirectory;
  options?: StudioModuleOptions;
}

export function harness(options: HarnessOptions = {}) {
  const prisma: FakeClient = fakeClient();
  const accessCalls: string[] = [];
  const access: StudioAccessCheck | undefined = options.managers
    ? {
        async holdsManageAll(_organizationId, _workspaceId, userId) {
          accessCalls.push(userId);
          return (options.managers ?? []).includes(userId);
        },
      }
    : undefined;

  const moduleOptions: StudioModuleOptions = {
    resolveActorId: (request) => (request as { userId?: string } | undefined)?.userId,
    ...options.options,
  };
  const studio = new StudioService(prisma, access, options.directory);
  const writes = new StudioWriteService(prisma, options.limits, access);
  const settings = new StudioSettingsService(prisma);
  const resolver = new StudioResolver(studio, writes, settings, moduleOptions);
  const prune = new StudioPruneLogsProcess(prisma, moduleOptions);
  return { prisma, studio, writes, settings, resolver, prune, accessCalls };
}

/** A caught rejection's refusal reason, or 'did not throw'. */
export async function reasonOf(act: Promise<unknown>): Promise<string> {
  try {
    await act;
  } catch (error) {
    return (error as { reason?: string }).reason ?? `threw ${String(error)}`;
  }
  return 'did not throw';
}
