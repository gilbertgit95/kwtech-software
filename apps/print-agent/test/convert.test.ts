import { marginsFromArea, type RawWindowsPrinter, toPaper, toReport, toStatus } from '../src/printers/convert.js';

/** What `windows-script.ts` printed for the proof computer's L5290, A4 (2026-10-07). */
const A4_RAW = {
  name: 'A4 210 x 297 mm',
  widthTenthsMm: 2100,
  heightTenthsMm: 2970,
  widthHundredthsIn: 827,
  heightHundredthsIn: 1169,
  area: { x: 11.666667, y: 11.666667, width: 803.3333, height: 1145.83337 },
};

describe('a paper', () => {
  it('takes the driver’s exact size in tenths of a millimetre', () => {
    expect(toPaper(A4_RAW)).toMatchObject({ name: 'A4 210 x 297 mm', width: 21000, height: 29700 });
  });

  it('⚠ falls back to .NET’s hundredths of an inch, which is 0.06 mm out on A4 — the reason for the exact read', () => {
    const { widthTenthsMm: _w, heightTenthsMm: _h, ...rounded } = A4_RAW;
    expect(toPaper(rounded)).toMatchObject({ width: 21006, height: 29693 });
    expect(toPaper({ ...A4_RAW, widthTenthsMm: null, heightTenthsMm: 0 })).toMatchObject({
      width: 21006,
      height: 29693,
    });
  });

  it('works out the unprintable strip at each edge from the printable rectangle', () => {
    expect(toPaper(A4_RAW)?.margins).toEqual({ top: 296, right: 299, bottom: 299, left: 296 });
  });

  it('⚠ says null, not zero, when the driver’s rectangle is not one', () => {
    expect(marginsFromArea(null, 21000, 29700)).toBeNull();
    expect(marginsFromArea({ x: 0, y: 0, width: 0, height: 0 }, 21000, 29700)).toBeNull();
    expect(marginsFromArea({ x: -1, y: 0, width: 800, height: 1100 }, 21000, 29700)).toBeNull();
    // A rectangle that starts beyond the paper's own edge leaves nothing to print on.
    expect(marginsFromArea({ x: 900, y: 0, width: 10, height: 1100 }, 21000, 29700)).toBeNull();
  });

  it('clamps a rectangle a hair larger than the paper rather than refusing it', () => {
    // Microsoft Print to PDF: 826.8333 × 1169.33337 on a paper .NET calls 827 × 1169.
    expect(marginsFromArea({ x: 0, y: 0, width: 826.8333, height: 1169.33337 }, 21000, 29700)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('is not one without a name or a size — “User-Defined” has neither width nor height', () => {
    expect(toPaper({ name: 'User-Defined', widthHundredthsIn: 0, heightHundredthsIn: 0 })).toBeNull();
    expect(toPaper({ ...A4_RAW, name: '  ' })).toBeNull();
    expect(toPaper({})).toBeNull();
  });
});

describe('a status', () => {
  it('is one of four words, and low ink still prints', () => {
    expect(toStatus('Normal')).toBe('ready');
    expect(toStatus('TonerLow')).toBe('ready');
    expect(toStatus('Offline')).toBe('offline');
    expect(toStatus('PaperJam')).toBe('error');
    expect(toStatus('SomethingNew')).toBe('unknown');
    expect(toStatus(3)).toBe('unknown');
  });
});

const raw = (overrides: Partial<RawWindowsPrinter> = {}): RawWindowsPrinter => ({
  name: 'L5290 Series(Network)',
  driver: 'EPSON L5290 Series',
  isDefault: true,
  status: 'Normal',
  papers: [A4_RAW, { name: 'User-Defined', widthHundredthsIn: 0, heightHundredthsIn: 0 }, A4_RAW],
  settings: null,
  ...overrides,
});

describe('a report', () => {
  it('lists each printer with its usable papers, once each', () => {
    const { printers, skipped } = toReport([raw()]);
    expect(skipped).toEqual([]);
    expect(printers).toHaveLength(1);
    expect(printers[0]).toMatchObject({ name: 'L5290 Series(Network)', isDefault: true, status: 'ready' });
    expect(printers[0]?.papers.map((paper) => paper.name)).toEqual(['A4 210 x 297 mm']);
  });

  it('leaves the excluded printers out without a word', () => {
    const { printers, skipped } = toReport([raw(), raw({ name: 'Fax' })], ['Fax']);
    expect(printers.map((printer) => printer.name)).toEqual(['L5290 Series(Network)']);
    expect(skipped).toEqual([]);
  });

  it('⚠ leaves out ONE printer the server would refuse, and names it, rather than lose the whole report', () => {
    const { printers, skipped } = toReport([
      raw(),
      raw({ name: 'x'.repeat(300) }),
      raw({ name: 'L121', papers: 'nonsense' }),
    ]);
    expect(printers.map((printer) => printer.name)).toEqual(['L5290 Series(Network)', 'L121']);
    expect(printers[1]?.papers).toEqual([]);
    expect(skipped).toEqual(['x'.repeat(300)]);
  });

  it('keeps a printer whose driver could not be asked, with no papers', () => {
    expect(toReport([raw({ papers: [] })]).printers[0]?.papers).toEqual([]);
  });
});

describe('what a driver offers besides papers', () => {
  it('⚠ leaves out the user-defined slot even when it has a size: it is whatever was last typed into the driver', () => {
    const slot = { name: 'User-Defined', kind: 256, widthTenthsMm: 2100, heightTenthsMm: 2970, area: null };
    const { printers, kinds } = toReport([raw({ papers: [slot, A4_RAW] })]);
    expect(printers[0]?.papers.map((paper) => paper.name)).toEqual(['A4 210 x 297 mm']);
    expect([...kinds.values()]).not.toContain(256);
  });

  it('reports the paper types and qualities, and none for a driver that could not be asked', () => {
    const settings = {
      mediaTypes: [{ id: 'psk:Plain', label: 'Plain paper' }],
      mediaType: 'psk:Plain',
      qualities: [{ id: 'ns0000:Standard', label: 'Standard' }],
      quality: 'ns0000:Standard',
    };
    expect(toReport([raw({ settings })]).printers[0]?.settings).toEqual(settings);
    expect(toReport([raw({ settings: null })]).printers[0]?.settings).toEqual({
      mediaTypes: [],
      mediaType: null,
      qualities: [],
      quality: null,
    });
  });
});
