import type { LimitChecker } from '@kwtech/module-kit';
import type { PosFeatureKey } from '../src/feature-keys.js';
import { PosCatalogueResolver } from '../src/server/graphql/pos-catalogue.resolver.js';
import type { PosAccessCheck } from '../src/server/ports.js';
import { PosEventPublisher } from '../src/server/pos.events.js';
import type { PosEvent, PosPubSub } from '../src/server/pos.pubsub.js';
import { PosAccessService } from '../src/server/pos-access.service.js';
import { PosCatalogueService } from '../src/server/pos-catalogue.service.js';
import { PosCustomerService } from '../src/server/pos-customer.service.js';
import { PosSettingsService } from '../src/server/pos-settings.service.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the service and resolver suites. */

export const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
export const OTHER_STORE = { organizationId: 'org-2', workspaceId: 'ws-2' };
export const ANA = 'user-ana';
export const BEN = 'user-ben';

/** A recording engine: every publish kept, nobody listening. */
export function recordingPubSub(): PosPubSub & { sent: PosEvent[] } {
  const engine = {
    sent: [] as PosEvent[],
    async publish(_trigger: string, payload: unknown) {
      engine.sent.push(payload as PosEvent);
    },
    async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
      // Nothing streams in these suites.
    },
  };
  return engine;
}

export interface HarnessOptions {
  limits?: LimitChecker;
  /** Who holds which key beyond what the guard checked. Omitted: the access port is UNBOUND. */
  holders?: Partial<Record<PosFeatureKey, readonly string[]>>;
}

export function harness(options: HarnessOptions = {}) {
  const prisma: FakeClient = fakeClient();
  const pubsub = recordingPubSub();
  const events = new PosEventPublisher(pubsub);
  const accessPort: PosAccessCheck | undefined = options.holders
    ? { holds: async (_org, _ws, userId, key) => (options.holders?.[key] ?? []).includes(userId) }
    : undefined;
  const access = new PosAccessService(accessPort);
  const catalogue = new PosCatalogueService(prisma, events, options.limits);
  const customers = new PosCustomerService(prisma, events);
  const settings = new PosSettingsService(prisma, events);
  const resolver = new PosCatalogueResolver(
    catalogue,
    customers,
    settings,
    access,
    { resolveActorId: (request) => (request as { userId?: string } | undefined)?.userId },
    pubsub,
  );
  return { prisma, pubsub, events, access, catalogue, customers, settings, resolver };
}

/** A GraphQL context for `userId`. */
export function as(userId: string): { req: { userId: string } } {
  return { req: { userId } };
}

/** A limit checker with a fixed cap. */
export function capAt(limit: number): LimitChecker {
  return {
    async check({ current }) {
      return { allowed: current < limit, limit, current, remaining: Math.max(limit - current, 0) };
    },
  };
}
