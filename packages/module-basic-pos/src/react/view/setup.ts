import { countSheetPlan, type SheetImportMode, type SheetProblem, sheetReadMe } from '@kwtech/module-kit';
import type { ImportWizardPreview, ImportWizardSheet, WorkbookSheetInput } from '@kwtech/web-ui/react';
import {
  POS_SETUP_SHEET,
  POS_SETUP_SHEET_ORDER,
  POS_SETUP_SHEET_SPECS,
  POS_SETUP_SPECS,
  type PosSetupInput,
  type PosSetupPlan,
  type PosSetupReading,
  type PosSetupSheetKey,
  type PosSetupStore,
  posSetupExportRows,
} from '../../domain/setup.js';
import type { PosCatalogueView, PosSettingsView } from '../pos-client.js';

/**
 * The Items tab's Excel import and export (issue #35), as the browser does it:
 * the store as the plan reads it, the wizard's preview, the mutation's input,
 * and the files. Pure; the rules themselves are `domain/setup.ts`.
 */

/** The store as `planPosSetup` reads it: the catalogue with archived rows (as Items loads it) and the references. */
export function setupStore(
  catalogue: PosCatalogueView,
  settings: Pick<PosSettingsView, 'referenceOptions' | 'defaultReference'>,
): PosSetupStore {
  return {
    categories: catalogue.categories.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      archived: row.archivedAt !== null,
    })),
    orderTypes: catalogue.orderTypes.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      isDefault: row.isDefault,
      archived: row.archivedAt !== null,
    })),
    items: catalogue.items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      kind: item.kind === 'service' ? 'service' : 'product',
      categoryId: item.categoryId,
      description: item.description,
      price: item.price,
      cost: item.cost,
      archived: item.archivedAt !== null,
    })),
    variants: catalogue.items.flatMap((item) =>
      item.variants.map((variant) => ({
        id: variant.id,
        itemId: item.id,
        code: variant.code,
        name: variant.name,
        price: variant.price,
        cost: variant.cost,
        sortOrder: variant.sortOrder,
        archived: variant.archivedAt !== null,
      })),
    ),
    references: { options: settings.referenceOptions, defaultReference: settings.defaultReference },
  };
}

/**
 * What the wizard shows for a file: per tab, what it would do, every problem
 * on its row and column, what Replace archives by name, and the tabs the file
 * does not have. ⚠ A problem with a whole tab (a heading missing, a cap) is
 * FATAL — it can never be skipped, as the server never skips it either.
 */
export function setupPreview(
  reading: Pick<PosSetupReading, 'problems' | 'fatal'>,
  plan: PosSetupPlan,
  store: PosSetupStore,
): ImportWizardPreview {
  const all = [...reading.problems, ...plan.problems];
  const itemName = new Map(store.items.map((item) => [item.id, item.name]));
  const sheets: ImportWizardSheet[] = POS_SETUP_SHEET_ORDER.map((key) => {
    const name = POS_SETUP_SHEET[key];
    const problems = all
      .filter((problem) => problem.sheet === name && problem.line !== null)
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    const shown = problems.map((problem) => ({ line: problem.line, column: problem.column, message: problem.message }));
    if (key === 'references') return referencesSheet(plan, problems, shown, name);
    const sheetPlan = plan[key];
    if (sheetPlan === null) return missingSheet(name);
    const counts = countSheetPlan(sheetPlan, problems);
    const archived =
      key === 'variants'
        ? (plan.variants?.archive ?? []).map((variant) => `${itemName.get(variant.itemId) ?? '?'} — ${variant.name}`)
        : sheetPlan.archive.map((row) => (row as { name: string }).name);
    return { name, missing: false, counts, problems: shown, archived };
  });
  const fatal = [
    ...reading.fatal.map(sheetMessage),
    ...all.filter((problem) => problem.line === null && !reading.fatal.includes(problem)).map(sheetMessage),
  ];
  return { sheets, fatal: [...new Set(fatal)] };
}

function missingSheet(name: string): ImportWizardSheet {
  return {
    name,
    missing: true,
    counts: { create: 0, update: 0, unchanged: 0, archive: 0, errors: 0 },
    problems: [],
    archived: [],
  };
}

function referencesSheet(
  plan: PosSetupPlan,
  problems: readonly SheetProblem[],
  shown: ImportWizardSheet['problems'],
  name: string,
): ImportWizardSheet {
  if (plan.references === null) {
    // Not in the file — or in it, but refused whole (the list's own problems are fatal).
    return problems.length > 0 ? { ...missingSheet(name), missing: false, problems: shown } : missingSheet(name);
  }
  const { counts } = plan.references;
  return {
    name,
    missing: false,
    counts: { ...counts, errors: new Set(problems.map((problem) => problem.line)).size },
    problems: shown,
    archived: [],
  };
}

function sheetMessage(problem: SheetProblem): string {
  return `${problem.sheet}: ${problem.message}`;
}

/** The mutation's `input` (`ImportPosSetupInput`): the rows flattened as the API takes them. */
export type PosSetupMutationInput = ReturnType<typeof setupMutationInput>;

/** The mutation's `input`: the rows flattened as the API takes them, and the person's choices. */
export function setupMutationInput(input: PosSetupInput, mode: SheetImportMode, skipErrorRows: boolean) {
  const flat = <R>(rows: { line: number; row: R }[] | null) =>
    rows?.map((entry) => ({ line: entry.line, ...entry.row })) ?? null;
  return {
    mode,
    skipErrorRows,
    categories: flat(input.categories),
    orderTypes: flat(input.orderTypes),
    items: flat(input.items),
    variants: flat(input.variants),
    references: flat(input.references),
    held: input.held,
  };
}

/** The template: every tab with its headings and an example row, and the Read me first. */
export function setupTemplate(): { readMe: string[][]; sheets: WorkbookSheetInput[] } {
  return {
    readMe: sheetReadMe(
      'Point of sale setup — fill in each sheet, then import it on the Items tab',
      POS_SETUP_SHEET_SPECS,
    ),
    sheets: POS_SETUP_SHEET_SPECS.map((sheet) => ({ sheet })),
  };
}

/** The export: the chosen tabs with the store's rows, and the Read me, so the file can be imported back. */
export function setupExport(
  store: PosSetupStore,
  choice: { sheets: readonly string[]; includeArchived: boolean },
): { readMe: string[][]; sheets: WorkbookSheetInput[] } {
  const rows = posSetupExportRows(store, choice.includeArchived);
  const keys = POS_SETUP_SHEET_ORDER.filter((key) => choice.sheets.includes(POS_SETUP_SHEET[key]));
  const specs = keys.map((key) => POS_SETUP_SPECS[key]);
  return {
    readMe: sheetReadMe('Point of sale setup — edit it, then import it on the Items tab', specs),
    sheets: keys.map((key: PosSetupSheetKey) => ({ sheet: POS_SETUP_SPECS[key], rows: rows[key] })),
  };
}

/** The tab names, in the file's order, for the export dialog. */
export const SETUP_SHEET_NAMES: readonly string[] = POS_SETUP_SHEET_ORDER.map((key) => POS_SETUP_SHEET[key]);
