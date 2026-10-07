import { paperKey, toReport } from '../src/printers/convert.js';
import { createWindowsDriver, type PdfPrintOptions } from '../src/printers/windows.js';
import { WINDOWS_TICKET_SCRIPT } from '../src/printers/windows-script.js';

/** What the script prints for one printer with two papers, the second a driver's own. */
const LISTING = [
  {
    name: 'L5290 Series(Network)',
    driver: 'EPSON L5290 Series',
    isDefault: true,
    status: 'Normal',
    papers: [
      { name: 'A4 210 x 297 mm', kind: 9, widthTenthsMm: 2100, heightTenthsMm: 2970, area: null },
      { name: '10 x 15 cm (4 x 6 in)', kind: 262, widthTenthsMm: 1016, heightTenthsMm: 1524, area: null },
    ],
  },
];
const A4 = { name: 'A4 210 x 297 mm', width: 21000, height: 29700, margins: null };
const PHOTO = { name: '10 x 15 cm (4 x 6 in)', width: 10160, height: 15240, margins: null };

function driver(listing: unknown = LISTING) {
  const printed: Array<{ file: string; options: PdfPrintOptions }> = [];
  let listings = 0;
  const windows = createWindowsDriver([], {
    run: async () => {
      listings += 1;
      return JSON.stringify(listing);
    },
    print: async (file, options) => {
      printed.push({ file, options });
    },
  });
  return { windows, printed, listings: () => listings };
}

describe('a listing', () => {
  it('keeps each paper’s number in its driver, on this computer, keyed by the names the server was given', () => {
    const report = toReport(LISTING);
    expect(report.kinds.get(paperKey('L5290 Series(Network)', 'A4 210 x 297 mm'))).toBe(9);
    expect(report.kinds.get(paperKey('L5290 Series(Network)', '10 x 15 cm (4 x 6 in)'))).toBe(262);
    // The server is not told: a job names a paper by name.
    expect(JSON.stringify(report.printers)).not.toContain('kind');
  });
});

describe('printing on Windows', () => {
  it('⚠ never scales the page, and names the paper by the driver’s own number', async () => {
    const { windows, printed } = driver();
    await windows.list();
    await windows.print({ file: 'C:\\temp\\job.pdf', printerName: 'L5290 Series(Network)', paper: PHOTO, copies: 2 });
    expect(printed).toEqual([
      {
        file: 'C:\\temp\\job.pdf',
        options: { printer: 'L5290 Series(Network)', scale: 'noscale', silent: true, copies: 2, paperKind: 262 },
      },
    ]);
  });

  it('leaves the paper to the printer when the job names none', async () => {
    const { windows, printed, listings } = driver();
    await windows.print({ file: 'job.pdf', printerName: 'L5290 Series(Network)', paper: null, copies: 1 });
    expect(printed[0]?.options).toEqual({
      printer: 'L5290 Series(Network)',
      scale: 'noscale',
      silent: true,
      copies: 1,
    });
    expect(listings()).toBe(0);
  });

  it('reads the printers first when a job arrives before the first listing', async () => {
    const { windows, printed, listings } = driver();
    await windows.print({ file: 'job.pdf', printerName: 'L5290 Series(Network)', paper: A4, copies: 1 });
    expect(listings()).toBe(1);
    expect(printed[0]?.options.paperKind).toBe(9);
  });

  it('⚠ refuses a paper Windows no longer lists, rather than print on whatever is loaded', async () => {
    const { windows, printed } = driver();
    await expect(
      windows.print({ file: 'job.pdf', printerName: 'L5290 Series(Network)', paper: { ...A4, name: 'A3' }, copies: 1 }),
    ).rejects.toThrow(/does not list the paper "A3"/);
    expect(printed).toEqual([]);
  });
});

describe('a paper type and a quality for one job', () => {
  /** A driver whose ticket script answers `settled`, or throws when it is an Error. Records every step, in order. */
  function withSettings(settled: unknown = {}, printFails = false) {
    const steps: string[] = [];
    const notes: string[] = [];
    const windows = createWindowsDriver([], {
      run: async (script, variables) => {
        if (script !== WINDOWS_TICKET_SCRIPT) return JSON.stringify(LISTING);
        const mode = variables.KW_PRINT_MODE;
        steps.push(`${mode} ${variables.KW_PRINT_PRINTER}: ${variables.KW_PRINT_MEDIA}|${variables.KW_PRINT_QUALITY}`);
        if (mode === 'restore') return 'restored';
        if (settled instanceof Error) throw settled;
        return JSON.stringify(settled);
      },
      print: async () => {
        steps.push('print');
        if (printFails) throw new Error('The printer is on fire');
      },
      onNote: (message) => notes.push(message),
    });
    return { windows, steps, notes };
  }
  const job = { file: 'C:\\temp\\job\\job.pdf', printerName: 'L5290 Series(Network)', paper: null, copies: 1 };
  const GLOSSY = 'psk:PhotographicHighGloss';

  it('sets them on the queue, prints, and puts the queue back', async () => {
    const { windows, steps, notes } = withSettings({ mediaType: GLOSSY, quality: 'ns0000:HighQuality' });
    await windows.print({ ...job, mediaType: GLOSSY, quality: 'ns0000:HighQuality' });
    expect(steps).toEqual([
      `apply L5290 Series(Network): ${GLOSSY}|ns0000:HighQuality`,
      'print',
      `restore L5290 Series(Network): ${GLOSSY}|ns0000:HighQuality`,
    ]);
    expect(notes).toEqual([]);
  });

  it('touches nothing for a job that chose neither', async () => {
    const { windows, steps } = withSettings();
    await windows.print({ ...job, mediaType: null });
    expect(steps).toEqual(['print']);
  });

  it('⚠ puts the queue back when the print fails too', async () => {
    const { windows, steps } = withSettings({ mediaType: GLOSSY }, true);
    await expect(windows.print({ ...job, mediaType: GLOSSY })).rejects.toThrow(/on fire/);
    expect(steps.map((step) => step.split(' ')[0])).toEqual(['apply', 'print', 'restore']);
  });

  it('⚠ does not print when the settings could not be set: glossy printed as plain is a ruined sheet', async () => {
    const { windows, steps } = withSettings(new Error('Windows could not be asked — This printer does not offer it'));
    await expect(windows.print({ ...job, mediaType: GLOSSY })).rejects.toThrow(
      /settings could not be set — This printer does not offer it/,
    );
    expect(steps.map((step) => step.split(' ')[0])).toEqual(['apply']);
  });

  it('says so when the driver settled on something else than was asked', async () => {
    const { windows, notes } = withSettings({ mediaType: 'psk:Plain', quality: 'ns0000:Standard' });
    await windows.print({ ...job, mediaType: 'psk:Plain', quality: 'ns0000:HighQuality' });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/ns0000:Standard, not ns0000:HighQuality/);
  });
});
