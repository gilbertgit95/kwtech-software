import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PrintReportedPrinter } from '@kwtech/module-print';
import type { PrinterDriver } from './driver.js';

/**
 * Two invented printers, for developing where there is no spooler to ask —
 * inside WSL, on a build machine.
 *
 * ⚠ NAMED SO NOBODY MISTAKES THEM. A person seeing these in the web app must
 * know at a glance that no paper will come out.
 */
export const FAKE_PRINTERS: readonly PrintReportedPrinter[] = [
  {
    name: 'Fake A4 inkjet (no paper comes out)',
    driver: 'kwtech print-agent fake driver',
    isDefault: true,
    status: 'ready',
    papers: [
      { name: 'A4', width: 21000, height: 29700, margins: { top: 300, right: 300, bottom: 300, left: 300 } },
      { name: '4R (4 x 6 in)', width: 10160, height: 15240, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
    ],
    settings: {
      mediaTypes: [
        { id: 'fake:Plain', label: 'Plain paper' },
        { id: 'fake:Glossy', label: 'Glossy photo paper' },
      ],
      mediaType: 'fake:Plain',
      qualities: [
        { id: 'fake:Standard', label: 'Standard' },
        { id: 'fake:High', label: 'High' },
      ],
      quality: 'fake:Standard',
    },
  },
  {
    name: 'Fake printer, switched off',
    driver: 'kwtech print-agent fake driver',
    isDefault: false,
    status: 'offline',
    papers: [{ name: 'A4', width: 21000, height: 29700, margins: null }],
    // A printer whose driver says nothing about paper types: the web app offers no settings for it.
    settings: { mediaTypes: [], mediaType: null, qualities: [], quality: null },
  },
];

/**
 * `onPrinted` hears what a real driver would have put on paper: the file's
 * length and its SHA-256, which is how a developer checks that what arrived
 * is what was sent, byte for byte.
 */
export function createFakeDriver(
  excluded: readonly string[] = [],
  options: { onPrinted?: (line: string) => void } = {},
): PrinterDriver {
  return {
    async print(request) {
      if (!FAKE_PRINTERS.some((printer) => printer.name === request.printerName)) {
        throw new Error(`There is no printer called "${request.printerName}" on this computer.`);
      }
      const bytes = await readFile(request.file);
      const digest = createHash('sha256').update(bytes).digest('hex');
      options.onPrinted?.(
        `Fake print on "${request.printerName}": ${bytes.length} bytes, sha256 ${digest}, paper ${request.paper?.name ?? 'the printer’s own'}, paper type ${request.mediaType ?? 'as set'}, quality ${request.quality ?? 'as set'}, ${request.copies} copy(ies). No paper comes out.`,
      );
    },
    async list() {
      return FAKE_PRINTERS.filter((printer) => !excluded.includes(printer.name)).map((printer) => ({
        ...printer,
        papers: printer.papers.map((paper) => ({ ...paper })),
        settings: {
          ...printer.settings,
          mediaTypes: printer.settings.mediaTypes.map((option) => ({ ...option })),
          qualities: printer.settings.qualities.map((option) => ({ ...option })),
        },
      }));
    },
  };
}
