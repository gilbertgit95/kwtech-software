import type { BooksLedgerEntry } from '../domain/balances.js';
import { booksDayFromDate } from '../domain/days.js';
import type { BooksSalesImportFigures } from '../domain/profit.js';
import type { BooksDay, BooksShareMode } from '../types.js';
import { refusalError } from './books.errors.js';
import type {
  BooksEntryRow,
  BooksEntryWhere,
  BooksSalesImportRow,
  BooksSettingsRow,
  BooksTransaction,
  InScope,
} from './books.repository.js';

/**
 * Reading and locking the books the way EVERY service must. In one file so
 * there is one way to do it: a service that skipped the lock could record an
 * expense into a period whose profit was being shared at that moment.
 */

/**
 * How many live entries one read adds up. Past it the answer says it is
 * TRUNCATED rather than quietly wrong — a small business records a few
 * thousand a year. Adding up in the database instead is PLAN §12's.
 */
export const BOOKS_LEDGER_MAX = 50_000;

/** A workspace's settings, defaults filled in, days as days. */
export interface BooksSettingsView {
  shareMode: BooksShareMode;
  posImportFrom: BooksDay | null;
  posRecordedThrough: BooksDay | null;
  sharedThrough: BooksDay | null;
  /** 0 when there is no row yet. */
  version: number;
}

const NO_SETTINGS: BooksSettingsView = {
  shareMode: 'capital',
  posImportFrom: null,
  posRecordedThrough: null,
  sharedThrough: null,
  version: 0,
};

const dayOrNull = (date: Date | null): BooksDay | null => (date === null ? null : booksDayFromDate(date));

/**
 * A settings row as a view — or the defaults when there is none, AND when the
 * row is another organization's: the workspace id is unique across tenants,
 * and a mismatch must read as "no settings", never as somebody else's.
 */
export function settingsView(row: BooksSettingsRow | null, scope: InScope): BooksSettingsView {
  if (!row || row.organizationId !== scope.organizationId) return NO_SETTINGS;
  return {
    shareMode: row.shareMode,
    posImportFrom: dayOrNull(row.posImportFrom),
    posRecordedThrough: dayOrNull(row.posRecordedThrough),
    sharedThrough: dayOrNull(row.sharedThrough),
    version: row.version,
  };
}

export async function readSettings(
  client: Pick<BooksTransaction, 'booksSettings'>,
  scope: InScope,
): Promise<BooksSettingsView> {
  return settingsView(await client.booksSettings.findUnique({ where: { workspaceId: scope.workspaceId } }), scope);
}

/**
 * ⚠ THE WRITE LOCK. Every write calls this FIRST inside its transaction: it
 * upserts the workspace's settings row, bumping its version, which takes that
 * row's lock until the commit.
 *
 * - Two writes in one workspace queue behind each other, so each reads the
 *   balances the one before it left — two payouts at once cannot both fit in
 *   what one investor is owed.
 * - A profit share or an import read the entries at version N and commit only
 *   if the row is still at N (`moveMarks`): an entry written in between bumped
 *   it, and the share is refused as a conflict rather than splitting a profit
 *   that no longer exists.
 *
 * Returns the settings AS LOCKED: what the write must check against.
 */
export async function lockBooks(
  tx: Pick<BooksTransaction, 'booksSettings'>,
  scope: InScope,
  actorId: string,
): Promise<BooksSettingsView> {
  const row = await tx.booksSettings.upsert({
    where: { workspaceId: scope.workspaceId },
    create: { ...scope, updatedById: actorId },
    update: { version: { increment: 1 } },
  });
  if (row.organizationId !== scope.organizationId) throw refusalError('not_found');
  return settingsView(row, scope);
}

/**
 * Moves a watermark (`sharedThrough`, `posRecordedThrough`) IF the books are
 * still at `version` — the compare-and-set a profit share or an import commits
 * with. Zero rows: somebody wrote in between; `conflict`, and the transaction
 * rolls back.
 */
export async function moveMarks(
  tx: Pick<BooksTransaction, 'booksSettings'>,
  scope: InScope,
  actorId: string,
  version: number,
  marks: { posRecordedThrough?: Date | null; sharedThrough?: Date | null },
): Promise<void> {
  const updated = await tx.booksSettings.updateMany({
    where: { ...scope, version },
    data: { ...marks, version: { increment: 1 }, updatedById: actorId },
  });
  if (updated.count === 0) throw refusalError('conflict');
}

/** A `BigInt` column as the number it always is (every amount is a safe integer, `BOOKS_AMOUNT_MAX`). */
export function centavos(value: bigint): number {
  return Number(value);
}

/** An entry row as the domain sums it. */
export function toLedgerEntry(row: BooksEntryRow): BooksLedgerEntry {
  return {
    kind: row.kind,
    amount: centavos(row.amount),
    place: row.place,
    toPlace: row.toPlace,
    day: booksDayFromDate(row.day),
    investorId: row.investorId,
    loanId: row.loanId,
    voided: row.voidedAt !== null,
  };
}

export function toImportFigures(row: BooksSalesImportRow): BooksSalesImportFigures {
  return { toDay: booksDayFromDate(row.toDay), costOfGoods: centavos(row.costOfGoods), voided: row.voidedAt !== null };
}

const ENTRY_ORDER = [{ day: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }];

/**
 * Entries in ledger order — by day, then as recorded. `where` names the
 * workspace, and `voidedAt: null` for the live ones only.
 */
export async function readEntries(
  client: Pick<BooksTransaction, 'booksEntry'>,
  where: BooksEntryWhere,
): Promise<{ rows: BooksEntryRow[]; truncated: boolean }> {
  const rows = await client.booksEntry.findMany({ where, orderBy: ENTRY_ORDER, take: BOOKS_LEDGER_MAX });
  return { rows, truncated: rows.length >= BOOKS_LEDGER_MAX };
}

/** Every live entry, as the balances need them. */
export async function liveLedger(
  client: Pick<BooksTransaction, 'booksEntry'>,
  scope: InScope,
): Promise<{ entries: BooksLedgerEntry[]; truncated: boolean }> {
  const { rows, truncated } = await readEntries(client, { ...scope, voidedAt: null });
  return { entries: rows.map(toLedgerEntry), truncated };
}

/** Every import, voided ones included (they carry `voided`), for cost of goods. */
export async function allImports(
  client: Pick<BooksTransaction, 'booksSalesImport'>,
  scope: InScope,
): Promise<BooksSalesImportRow[]> {
  return client.booksSalesImport.findMany({
    where: scope,
    orderBy: [{ toDay: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: BOOKS_LEDGER_MAX,
  });
}

/** Whether a thrown error is Prisma's unique violation, detected structurally. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
