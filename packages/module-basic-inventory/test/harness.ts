import type { LimitChecker } from '@kwtech/module-kit';
import type { StockChangeListener, StockSaleFeed, StockSourceEvent, StockSourceItem } from '../src/server/ports.js';
import { StockEventPublisher } from '../src/server/stock.events.js';
import type { StockEvent, StockPubSub } from '../src/server/stock.pubsub.js';
import { StockCatalogueService } from '../src/server/stock-catalogue.service.js';
import { StockCatchUpProcess } from '../src/server/stock-catch-up.process.js';
import { StockDirectoryService } from '../src/server/stock-directory.service.js';
import { StockIntakeService } from '../src/server/stock-intake.service.js';
import { StockMoveService } from '../src/server/stock-move.service.js';
import { StockTakeService } from '../src/server/stock-take.service.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the service suites. */

export const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
export const OTHER = { organizationId: 'org-2', workspaceId: 'ws-2' };
export const ANA = 'user-ana';

/** A recording engine: every publish kept, nobody listening. */
export function recordingPubSub(): StockPubSub & { sent: StockEvent[] } {
  const engine = {
    sent: [] as StockEvent[],
    async publish(_trigger: string, payload: unknown) {
      engine.sent.push(payload as StockEvent);
    },
    async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
      // Nothing streams in these suites.
    },
  };
  return engine;
}

/**
 * The operator's catalogue (2026-10-21): a Sintraboard Photo Print in A4 and
 * A3, a Vinyl Sticker plain or with a photo top, a mug sold as it is, and a
 * service nobody has given a list.
 */
export const POS_ITEMS: StockSourceItem[] = [
  {
    itemId: 'sintra',
    variantId: null,
    itemName: 'Sintraboard Photo Print',
    variantName: null,
    kind: 'service',
    code: null,
    archived: false,
  },
  {
    itemId: 'sintra',
    variantId: 'sintra-a4',
    itemName: 'Sintraboard Photo Print',
    variantName: 'A4',
    kind: 'service',
    code: null,
    archived: false,
  },
  {
    itemId: 'sintra',
    variantId: 'sintra-a3',
    itemName: 'Sintraboard Photo Print',
    variantName: 'A3',
    kind: 'service',
    code: null,
    archived: false,
  },
  {
    itemId: 'mug',
    variantId: null,
    itemName: 'Mug 11 oz',
    variantName: null,
    kind: 'product',
    code: 'MUG',
    archived: false,
  },
  {
    itemId: 'layout',
    variantId: null,
    itemName: 'Layout fee',
    variantName: null,
    kind: 'service',
    code: null,
    archived: false,
  },
];

/** A feed that answers whatever events it holds at or after `since`, and remembers what it was asked. */
export function fixedFeed(events: StockSourceEvent[]): StockSaleFeed & { asked: Date[] } {
  const feed = {
    asked: [] as Date[],
    async eventsSince(_org: string, _ws: string, since: Date, limit: number) {
      feed.asked.push(since);
      return events.filter((event) => new Date(event.at) >= since).slice(0, limit);
    },
  };
  return feed;
}

export interface HarnessOptions {
  /** The POS's items. Omitted: the catalogue port is UNBOUND — there is no POS. */
  source?: StockSourceItem[] | null;
  /** The POS's feed. Omitted: UNBOUND. */
  feed?: StockSaleFeed;
  /** The cap. Omitted: UNBOUND, the declared default. */
  limits?: LimitChecker;
}

export function harness(options: HarnessOptions = {}) {
  const prisma: FakeClient = fakeClient();
  const pubsub = recordingPubSub();
  const told: string[] = [];
  const listener: StockChangeListener = {
    async stockChanged(_org, workspaceId) {
      told.push(workspaceId);
    },
  };
  const events = new StockEventPublisher(pubsub, listener);
  const directory = new StockDirectoryService({
    describe: async (ids) => ids.map((userId) => ({ userId, displayName: userId === ANA ? 'Ana' : userId })),
  });
  const source = options.source === null ? undefined : { itemsOf: async () => options.source ?? POS_ITEMS };
  const catalogue = new StockCatalogueService(prisma, events, options.limits, source);
  const moves = new StockMoveService(prisma, events, directory);
  const takes = new StockTakeService(prisma, events, directory);
  const intake = new StockIntakeService(prisma, events);
  const catchUp = new StockCatchUpProcess(prisma, intake, options.feed);
  return { prisma, pubsub, told, catalogue, moves, takes, intake, catchUp };
}

let client = 0;
/** A fresh client id per press. */
export function press(): string {
  client += 1;
  return `press-${client}`;
}
