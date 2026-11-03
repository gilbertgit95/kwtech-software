import { POS_SETUP_SPECS, type PosSetupSheetKey, type PosSetupTab } from '../src/domain/setup.js';

/**
 * A sheet as a person (or the export) leaves it: the heading row, then the
 * rows' cells in the FILE's units — pesos, Yes/No — as `writeWorkbook` writes
 * them, so this suite reads what a real file holds.
 */
export function tab(key: PosSetupSheetKey, rows: readonly Record<string, unknown>[]): PosSetupTab {
  const spec = POS_SETUP_SPECS[key];
  const columns = spec.columns as readonly { key: string; header: string; kind: string }[];
  const cell = (kind: string, value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    if (kind === 'money' && typeof value === 'number') return value / 100;
    if (kind === 'yes_no' && typeof value === 'boolean') return value ? 'Yes' : 'No';
    return value;
  };
  return {
    name: spec.name,
    rows: [
      { line: 1, cells: columns.map((column) => column.header) },
      ...rows.map((row, index) => ({
        line: index + 2,
        cells: columns.map((column) => cell(column.kind, row[column.key])),
      })),
    ],
  };
}
