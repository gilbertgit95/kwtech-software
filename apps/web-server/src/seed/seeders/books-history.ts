import { readFile } from 'node:fs/promises';
import { normaliseEmail } from '@kwtech/module-auth';
import {
  BOOKS_EXPENSE_CATEGORIES,
  BOOKS_PURCHASE_CATEGORIES,
  booksDayToDate,
  checkBooksAmount,
  prepareBooksDay,
  prepareBooksEntry,
  prepareBooksName,
  prepareBooksText,
  workspaceBooksDay,
} from '@kwtech/module-basic-bookkeeping';
import { DEFAULT_TIME_ZONE } from '@kwtech/module-kit';
import type { Seeder } from '../types.js';

/**
 * A business's past investments, from its own records, into ONE workspace's
 * books: `SEED_BOOKS_HISTORY_FILE` into `SEED_POS_CATALOGUE_WORKSPACE_ID` — the
 * same store the POS history went into.
 *
 * ## Why the data is a file outside the repository
 *
 * These are real investors' names and amounts. The repository is public, so
 * the file is named by a path in the environment and never committed; this
 * seeder is only the reader. The file is a JSON export of the investment
 * sheet: `{ investors: [{ name }], entries: [{ ref, day, item, quantity,
 * unitPrice, amount, kind, category, installment, paidBy, sheetRow }] }`,
 * money in centavos, `paidBy` an investor's name or `business`.
 *
 * ⚠ The dev snapshot (`pnpm db:snapshot`) exports every table, so running this
 * against a dev database and then snapshotting would put those names in the
 * public `seed-data/snapshot.json`.
 *
 * ## What one sheet row becomes
 *
 * - Paid by an INVESTOR: their money, spent on the business — a `capital`
 *   entry in (cash) and the spending out (cash) on the same day. Cash on hand
 *   is unchanged; their capital, and so their share, grows by the amount. An
 *   item bought on instalments is capital for its full price on the day the
 *   business got it: the instalments are the investor's debt, not the
 *   business's.
 * - Paid by the BUSINESS: a reinvestment — the spending alone, out of cash
 *   the business earned.
 * - The spending is a `purchase` (equipment, which lasts) or an `expense`
 *   (supplies, power, research), as the file says. Supplies are expenses
 *   because this store's POS items carry no cost: as purchases they would
 *   never come off profit.
 *
 * ## Why it only creates, and never twice
 *
 * Each row's `ref` becomes its entries' `clientId` (`history:<ref>:capital`,
 * `history:<ref>:spend`), unique per workspace — the key that stops a double
 * press recording twice — so a re-run skips what it already imported.
 * Investors are found by name before one is created. Rules are the module's
 * (`prepareBooksEntry`, `prepareBooksDay`, `prepareBooksName`), so every row is
 * one the app would have accepted; a row dated in a period whose profit was
 * already shared is refused, as the app refuses it.
 */
export const booksHistorySeeder: Seeder = {
  name: 'books:history',
  phase: 'seed',
  description:
    'Import past investments from SEED_BOOKS_HISTORY_FILE into the SEED_POS_CATALOGUE_WORKSPACE_ID books (new rows only).',
  async run({ prisma, log }) {
    const file = process.env.SEED_BOOKS_HISTORY_FILE;
    const workspaceId = process.env.SEED_POS_CATALOGUE_WORKSPACE_ID;
    if (!file || !workspaceId) {
      log('skipped — set SEED_BOOKS_HISTORY_FILE and SEED_POS_CATALOGUE_WORKSPACE_ID');
      return;
    }
    const history = parseHistory(JSON.parse(await readFile(file, 'utf8')) as unknown);

    const workspace = await prisma.permWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, organizationId: true, timeZone: true },
    });
    if (!workspace) throw new Error(`SEED_POS_CATALOGUE_WORKSPACE_ID: no workspace ${workspaceId}`);
    // Who every imported entry was recorded by: the sheet names nobody.
    const email = process.env.SEED_USER_EMAIL;
    const actor = email
      ? await prisma.authUser.findUnique({ where: { email: normaliseEmail(email) }, select: { id: true } })
      : null;
    if (!actor) throw new Error('books:history needs SEED_USER_EMAIL to name an existing account');
    const scope = { organizationId: workspace.organizationId, workspaceId: workspace.id };
    const today = workspaceBooksDay(new Date(), workspace.timeZone ?? DEFAULT_TIME_ZONE);
    const settings = await prisma.booksSettings.findUnique({ where: { workspaceId: workspace.id } });
    const sharedThrough = settings?.sharedThrough ? settings.sharedThrough.toISOString().slice(0, 10) : null;

    // ── investors ──────────────────────────────────────────────────────────
    const investorIds = new Map<string, string>();
    for (const investor of history.investors) {
      const prepared = prepareBooksName(investor.name);
      if ('refused' in prepared) throw new Error(`books:history: investor "${investor.name}" (${prepared.refused})`);
      const existing = await prisma.booksInvestor.findUnique({
        where: { workspaceId_nameKey: { workspaceId: workspace.id, nameKey: prepared.nameKey } },
        select: { id: true },
      });
      const id =
        existing?.id ??
        (
          await prisma.booksInvestor.create({
            data: { ...scope, name: prepared.name, nameKey: prepared.nameKey, createdById: actor.id },
            select: { id: true },
          })
        ).id;
      if (!existing) log(`created investor ${prepared.name}`);
      investorIds.set(prepared.nameKey, id);
    }

    // ── entries ────────────────────────────────────────────────────────────
    let created = 0;
    let kept = 0;
    // One row at a time, in the sheet's order, so entries are recorded in the order the sheet lists them.
    for (const row of history.entries) {
      const where = `sheet row ${row.sheetRow} (${row.item})`;
      const day = prepareBooksDay(row.day, today);
      if ('refused' in day) throw new Error(`books:history: ${where}: date ${row.day} (${day.refused})`);
      if (sharedThrough !== null && day.day <= sharedThrough) {
        throw new Error(`books:history: ${where}: profit is already shared through ${sharedThrough}`);
      }
      const amountRefusal = checkBooksAmount(row.amount);
      if (amountRefusal) throw new Error(`books:history: ${where}: amount (${amountRefusal})`);
      const spend = prepareBooksEntry({
        kind: row.kind,
        amount: row.amount,
        place: 'cash',
        toPlace: null,
        investorId: null,
        loanId: null,
        category: row.category,
      });
      if ('refused' in spend) throw new Error(`books:history: ${where}: ${spend.refused}`);
      const description = describe(row, where);

      const investorId = row.paidBy === 'business' ? null : investorIds.get(row.paidBy.toLocaleLowerCase('en'));
      if (investorId === undefined) throw new Error(`books:history: ${where}: no investor "${row.paidBy}"`);

      const common = { ...scope, day: booksDayToDate(day.day), toPlace: null, recordedById: actor.id };
      const writes = [
        ...(investorId
          ? [
              {
                ...common,
                clientId: `history:${row.ref}:capital`,
                kind: 'capital' as const,
                amount: row.amount,
                place: 'cash' as const,
                investorId,
                description: `Paid for: ${description}`,
                category: null,
              },
            ]
          : []),
        {
          ...common,
          clientId: `history:${row.ref}:spend`,
          kind: row.kind,
          amount: row.amount,
          place: 'cash' as const,
          investorId: null,
          description: investorId ? `${description} — paid by ${row.paidBy}` : `${description} — reinvested`,
          category: spend.category,
        },
      ];
      // The capital before its spending, as it happened: the money came in, then went on the item.
      for (const entry of writes) {
        const existing = await prisma.booksEntry.findUnique({
          where: { workspaceId_clientId: { workspaceId: workspace.id, clientId: entry.clientId } },
          select: { id: true },
        });
        if (existing) {
          kept++;
          continue;
        }
        await prisma.booksEntry.create({ data: entry });
        created++;
      }
    }
    log(`${created} entr(ies) created, ${kept} already there`);
  },
};

interface HistoryRow {
  ref: string;
  day: string;
  item: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  kind: 'purchase' | 'expense';
  category: string;
  installment: boolean;
  paidBy: string;
  sheetRow: number;
}

interface History {
  investors: { name: string }[];
  entries: HistoryRow[];
}

/** "Photo Paper Glossy × 2", plus "(instalments)" — one line the ledger shows under the category. */
function describe(row: HistoryRow, where: string): string {
  const text = `${row.item}${row.quantity > 1 ? ` × ${row.quantity}` : ''}${row.installment ? ' (instalments)' : ''}`;
  const prepared = prepareBooksText(text);
  if ('refused' in prepared || prepared.text === null) throw new Error(`books:history: ${where}: item name`);
  return prepared.text;
}

function parseHistory(raw: unknown): History {
  const fail = (what: string): never => {
    throw new Error(`books:history: SEED_BOOKS_HISTORY_FILE ${what}`);
  };
  if (typeof raw !== 'object' || raw === null) return fail('is not a JSON object');
  const { investors, entries } = raw as { investors?: unknown; entries?: unknown };
  if (!Array.isArray(investors) || !Array.isArray(entries)) return fail('needs "investors" and "entries" arrays');
  const int = (value: unknown, what: string): number =>
    Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : fail(`: ${what} is not a whole number`);
  const text = (value: unknown, what: string): string =>
    typeof value === 'string' && value.length > 0 ? value : fail(`: ${what} is missing`);
  const categories = new Set([...BOOKS_EXPENSE_CATEGORIES, ...BOOKS_PURCHASE_CATEGORIES]);

  return {
    investors: investors.map((entry: Record<string, unknown>, index) => ({
      name: text(entry.name, `investors[${index}].name`),
    })),
    entries: entries.map((entry: Record<string, unknown>, index) => {
      const at = `entries[${index}]`;
      const kind = entry.kind === 'purchase' || entry.kind === 'expense' ? entry.kind : fail(`: ${at}.kind`);
      const category = text(entry.category, `${at}.category`);
      // A typo in a category splits a month's table in two; only the known ones are taken.
      if (!categories.has(category)) fail(`: ${at}.category "${category}" is not one the app offers`);
      return {
        ref: text(entry.ref, `${at}.ref`),
        day: text(entry.day, `${at}.day`),
        item: text(entry.item, `${at}.item`),
        quantity: int(entry.quantity, `${at}.quantity`),
        unitPrice: int(entry.unitPrice, `${at}.unitPrice`),
        amount: int(entry.amount, `${at}.amount`),
        kind,
        category,
        installment: entry.installment === true,
        paidBy: text(entry.paidBy, `${at}.paidBy`),
        sheetRow: int(entry.sheetRow ?? 0, `${at}.sheetRow`),
      };
    }),
  };
}
