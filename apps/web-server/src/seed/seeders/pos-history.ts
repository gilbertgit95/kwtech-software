import { readFile } from 'node:fs/promises';
import { normaliseEmail } from '@kwtech/module-auth';
import {
  checkPosPrice,
  checkPosQuantity,
  computeOrderTotals,
  type PosRefusal,
  preparePosCode,
  preparePosName,
  preparePosNote,
} from '@kwtech/module-basic-pos';
import type { Seeder } from '../types.js';

/**
 * A store's past sales, from its own records, into ONE point of sale:
 * `SEED_POS_HISTORY_FILE` into `SEED_POS_CATALOGUE_WORKSPACE_ID`.
 *
 * ## Why the data is a file outside the repository
 *
 * These are real sales with real customers' names. The repository is public,
 * so the file is named by a path in the environment and never committed; this
 * seeder is only the reader. The file is a JSON export of the store's sales
 * sheet: `{ newItems: [...], orders: [{ ref, paidAt, customerName, recorded,
 * tip, changeOwed, lines: [{ code, unitPrice, quantity, discount, note }] }] }`,
 * money in centavos.
 *
 * ⚠ The dev snapshot (`pnpm db:snapshot`) exports every POS table, so running
 * this against a dev database and then snapshotting would put those names in
 * the public `seed-data/snapshot.json`.
 *
 * ## Why it only creates, and never twice
 *
 * Each order carries a `ref` (its store day and place in the day). It becomes
 * the order's `paymentClientId`, which is unique per store, so a re-run finds
 * the orders it made and skips them — the same key that stops a double click
 * from paying twice. An order edited in the app since is left as it is.
 *
 * ## An order as the till would have made it
 *
 * Totals come from the module's `computeOrderTotals`, the function the server
 * stores on every change, so reports read these exactly as they read a sale
 * rung up today. Each line copies the item's name, kind, code and category
 * from the catalogue, as `addLine` does. A number is taken from the store's
 * counter, so numbers stay gapless after the history. Names go through the
 * module's `prepare*`, so a row is one the till would have accepted.
 *
 * Items must already exist (the `pos:catalogue` seeder runs first); the file's
 * `newItems` are created when missing. A customer marked `recorded` is linked
 * to the store's customer of that name, created if there is none; anyone else
 * is a walk-in whose name stays on the order only (D5).
 */
export const posHistorySeeder: Seeder = {
  name: 'pos:history',
  phase: 'seed',
  description:
    'Import past sales from SEED_POS_HISTORY_FILE into the SEED_POS_CATALOGUE_WORKSPACE_ID point of sale (new orders only).',
  async run({ prisma, log }) {
    const file = process.env.SEED_POS_HISTORY_FILE;
    const workspaceId = process.env.SEED_POS_CATALOGUE_WORKSPACE_ID;
    if (!file || !workspaceId) {
      log('skipped — set SEED_POS_HISTORY_FILE and SEED_POS_CATALOGUE_WORKSPACE_ID');
      return;
    }
    const history = parseHistory(JSON.parse(await readFile(file, 'utf8')) as unknown);

    const workspace = await prisma.permWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, organizationId: true, name: true },
    });
    if (!workspace) throw new Error(`SEED_POS_CATALOGUE_WORKSPACE_ID: no workspace ${workspaceId}`);
    // The cashier every imported sale is credited to: the sheet names none.
    const email = process.env.SEED_USER_EMAIL;
    const actor = email
      ? await prisma.authUser.findUnique({ where: { email: normaliseEmail(email) }, select: { id: true } })
      : null;
    if (!actor) throw new Error('pos:history needs SEED_USER_EMAIL to name an existing account');
    const scope = { organizationId: workspace.organizationId, workspaceId: workspace.id };

    // ── items the catalogue lacks ──────────────────────────────────────────
    for (const item of history.newItems) {
      const code = checked(preparePosCode(item.code), item.code).code;
      if (!code) throw new Error(`pos:history: ${item.name} has no code`);
      const existing = await prisma.posItem.findUnique({
        where: { workspaceId_code: { workspaceId: workspace.id, code } },
        select: { id: true },
      });
      if (existing) continue;
      const categoryName = checked(preparePosName(item.category), item.category).name;
      const sortOrder = await prisma.posCategory.count({ where: { workspaceId: workspace.id } });
      const category = await prisma.posCategory.upsert({
        where: { workspaceId_nameKey: { workspaceId: workspace.id, nameKey: categoryName.toLowerCase() } },
        create: { ...scope, name: categoryName, nameKey: categoryName.toLowerCase(), sortOrder },
        update: {},
        select: { id: true },
      });
      await prisma.posItem.create({
        data: {
          ...scope,
          categoryId: category.id,
          kind: item.kind,
          name: checked(preparePosName(item.name), item.name).name,
          code,
          price: price(item.price, item.code),
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      log(`created item ${code}`);
    }

    const catalogue = new Map(
      (
        await prisma.posItem.findMany({
          where: { workspaceId: workspace.id },
          select: { id: true, code: true, name: true, kind: true, category: { select: { name: true } } },
        })
      ).map((item) => [item.code, item]),
    );

    // ── orders ─────────────────────────────────────────────────────────────
    const customers = new Map<string, string>();
    let created = 0;
    let kept = 0;
    // One order at a time, in the file's order: each takes the next number, and numbers follow the dates.
    for (const order of history.orders) {
      const paymentClientId = `history:${order.ref}`;
      const existing = await prisma.posOrder.findUnique({
        where: { workspaceId_paymentClientId: { workspaceId: workspace.id, paymentClientId } },
        select: { id: true },
      });
      if (existing) {
        kept++;
        continue;
      }

      const customerName = order.customerName
        ? checked(preparePosName(order.customerName), order.customerName).name
        : null;
      const customerId =
        customerName && order.recorded ? await customerFor(customerName, customers, prisma, scope, actor.id) : null;

      const lines = order.lines.map((line) => {
        const item = catalogue.get(line.code);
        if (!item) throw new Error(`pos:history: sheet row ${line.sheetRow}: no item with code ${line.code}`);
        const quantityRefusal = checkPosQuantity(line.quantity);
        if (quantityRefusal) throw new Error(`pos:history: sheet row ${line.sheetRow}: quantity (${quantityRefusal})`);
        return {
          item,
          line,
          unitPrice: price(line.unitPrice, `sheet row ${line.sheetRow}`),
          note: line.note ? checked(preparePosNote(line.note), line.note).note : null,
        };
      });
      const totals = computeOrderTotals(
        lines.map(({ unitPrice, line }) => ({
          unitPrice,
          quantity: line.quantity,
          discount: line.discount ? { kind: 'amount' as const, value: line.discount } : null,
        })),
        null,
      );
      const paidAt = new Date(order.paidAt);

      await prisma.$transaction(async (tx) => {
        // The store's counter, as `takeNumber` in the order service: numbers stay gapless.
        const counter = await tx.posCounter.upsert({
          where: { workspaceId: workspace.id },
          create: { ...scope, nextNumber: 2 },
          update: { nextNumber: { increment: 1 } },
        });
        await tx.posOrder.create({
          data: {
            ...scope,
            status: 'paid',
            number: counter.nextNumber - 1,
            customerId,
            customerName,
            gross: totals.gross,
            lineDiscounts: totals.lineDiscounts,
            subtotal: totals.subtotal,
            orderDiscount: totals.orderDiscount,
            total: totals.total,
            paymentMethod: 'cash',
            // What the customer handed over: the total, what they left as a tip, and change still owed to them.
            received: totals.total + order.tip + order.changeOwed,
            change: 0,
            tip: order.tip,
            paymentClientId,
            changeOwed: order.changeOwed,
            createdById: actor.id,
            finalisedAt: paidAt,
            finalisedById: actor.id,
            paidAt,
            paidById: actor.id,
            createdAt: paidAt,
            lines: {
              create: lines.map(({ item, line, unitPrice, note }, index) => {
                const figures = totals.lines[index];
                if (!figures) throw new Error('pos:history: totals and lines disagree');
                return {
                  ...scope,
                  position: index + 1,
                  itemId: item.id,
                  name: item.name,
                  kind: item.kind,
                  code: item.code,
                  categoryName: item.category?.name ?? null,
                  unitPrice,
                  quantity: line.quantity,
                  note,
                  ...(line.discount
                    ? {
                        discountKind: 'amount' as const,
                        discountValue: line.discount,
                        discountReason: 'From the sales sheet',
                        discountById: actor.id,
                        discountAt: paidAt,
                      }
                    : {}),
                  discountAmount: figures.discount,
                  gross: figures.gross,
                  total: figures.total,
                  net: figures.net,
                  createdAt: paidAt,
                };
              }),
            },
          },
        });
      });
      created++;
    }
    log(`${workspace.name}: imported ${created} order(s), ${kept} already there, ${customers.size} customer(s) linked`);
  },
};

type Scope = { organizationId: string; workspaceId: string };
type SeedPrisma = Parameters<Seeder['run']>[0]['prisma'];

/** The store's customer of that name, or a new one: a regular's history then shows under their name (D5). */
async function customerFor(
  name: string,
  cache: Map<string, string>,
  prisma: SeedPrisma,
  scope: Scope,
  actorId: string,
): Promise<string> {
  const known = cache.get(name);
  if (known) return known;
  const existing = await prisma.posCustomer.findFirst({
    where: { workspaceId: scope.workspaceId, name, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const id =
    existing?.id ??
    (
      await prisma.posCustomer.create({
        data: { ...scope, name, note: 'Imported from the sales sheet', createdById: actorId },
        select: { id: true },
      })
    ).id;
  cache.set(name, id);
  return id;
}

interface HistoryLine {
  code: string;
  unitPrice: number;
  quantity: number;
  discount: number | null;
  note: string | null;
  sheetRow: number;
}

interface HistoryOrder {
  ref: string;
  paidAt: string;
  customerName: string | null;
  recorded: boolean;
  tip: number;
  changeOwed: number;
  lines: HistoryLine[];
}

interface History {
  newItems: { code: string; name: string; kind: 'product' | 'service'; category: string; price: number }[];
  orders: HistoryOrder[];
}

/**
 * The file, checked for shape before anything is written: a malformed row must
 * stop the run with its sheet row named, not import half a day.
 */
function parseHistory(raw: unknown): History {
  const fail = (what: string): never => {
    throw new Error(`pos:history: SEED_POS_HISTORY_FILE ${what}`);
  };
  if (typeof raw !== 'object' || raw === null) return fail('is not a JSON object');
  const { newItems, orders } = raw as { newItems?: unknown; orders?: unknown };
  if (!Array.isArray(newItems) || !Array.isArray(orders)) return fail('needs "newItems" and "orders" arrays');
  const int = (value: unknown, what: string): number =>
    Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : fail(`: ${what} is not a whole number`);
  const text = (value: unknown, what: string): string =>
    typeof value === 'string' && value.length > 0 ? value : fail(`: ${what} is missing`);

  return {
    newItems: newItems.map((entry: Record<string, unknown>, index) => ({
      code: text(entry.code, `newItems[${index}].code`),
      name: text(entry.name, `newItems[${index}].name`),
      kind: entry.kind === 'service' ? 'service' : 'product',
      category: text(entry.category, `newItems[${index}].category`),
      price: int(entry.price, `newItems[${index}].price`),
    })),
    orders: orders.map((entry: Record<string, unknown>, index) => {
      const at = `orders[${index}]`;
      const paidAt = text(entry.paidAt, `${at}.paidAt`);
      if (Number.isNaN(Date.parse(paidAt))) fail(`: ${at}.paidAt is not a date`);
      if (!Array.isArray(entry.lines) || entry.lines.length === 0) fail(`: ${at} has no lines`);
      return {
        ref: text(entry.ref, `${at}.ref`),
        paidAt,
        customerName: typeof entry.customerName === 'string' && entry.customerName ? entry.customerName : null,
        recorded: entry.recorded === true,
        tip: int(entry.tip ?? 0, `${at}.tip`),
        changeOwed: int(entry.changeOwed ?? 0, `${at}.changeOwed`),
        lines: (entry.lines as Record<string, unknown>[]).map((line, position) => {
          const where = `${at}.lines[${position}] (sheet row ${String(line.sheetRow)})`;
          return {
            code: text(line.code, `${where}.code`),
            unitPrice: int(line.unitPrice, `${where}.unitPrice`),
            quantity: int(line.quantity, `${where}.quantity`),
            discount: line.discount == null ? null : int(line.discount, `${where}.discount`),
            note: typeof line.note === 'string' && line.note ? line.note : null,
            sheetRow: int(line.sheetRow ?? 0, `${where}.sheetRow`),
          };
        }),
      };
    }),
  };
}

/** A `prepare*` result, or a loud failure naming the entry. */
function checked<T extends object>(result: T | { refused: PosRefusal }, what: string): T {
  if ('refused' in result) throw new Error(`pos:history: "${what}" refused (${result.refused})`);
  return result;
}

/** Centavos, checked as the item screen checks a price. */
function price(centavos: number, what: string): number {
  const refusal = checkPosPrice(centavos);
  if (refusal) throw new Error(`pos:history: ${what} price refused (${refusal})`);
  return centavos;
}
