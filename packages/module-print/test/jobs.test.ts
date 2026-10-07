import {
  cleanJobMessage,
  isJobTicketShaped,
  jobFailureText,
  PRINT_JOB_COPIES_MAX,
  PRINT_JOB_MAX_BYTES,
  prepareJobOptions,
  printJobContentPath,
  startsLikePdf,
} from '../src/domain/jobs.js';
import { RULER_FROM_LEFT, RULER_FROM_TOP, rulerLineLength, rulerPagePdf } from '../src/domain/ruler.js';

const A4 = { name: 'A4', width: 21000, height: 29700, margins: null };
const PHOTO = { name: '4R (4 x 6 in)', width: 10160, height: 15240, margins: null };
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('a request to print', () => {
  it('names one of the printer’s own papers, or none', () => {
    expect(prepareJobOptions({ paperName: 'A4', copies: 2, size: 1000 }, [A4, PHOTO])).toEqual({
      paper: A4,
      copies: 2,
      size: 1000,
      mediaType: null,
      quality: null,
    });
    expect(prepareJobOptions({ paperName: null, copies: 1, size: 1 }, [A4])).toEqual({
      paper: null,
      copies: 1,
      size: 1,
      mediaType: null,
      quality: null,
    });
  });

  it('⚠ refuses a paper the printer did not report: it would print on whatever is loaded', () => {
    expect(prepareJobOptions({ paperName: 'A3', copies: 1, size: 1000 }, [A4])).toEqual({ refused: 'invalid_job' });
    expect(prepareJobOptions({ paperName: 7, copies: 1, size: 1000 }, [A4])).toEqual({ refused: 'invalid_job' });
  });

  it('refuses copies that are not a small whole number', () => {
    for (const copies of [0, -1, 1.5, PRINT_JOB_COPIES_MAX + 1, '2', null]) {
      expect(prepareJobOptions({ paperName: null, copies, size: 1000 }, [A4])).toEqual({ refused: 'invalid_job' });
    }
  });

  it('⚠ refuses a file over the cap before a byte of it moves, and says so apart', () => {
    expect(prepareJobOptions({ paperName: null, copies: 1, size: PRINT_JOB_MAX_BYTES }, [A4])).toMatchObject({
      size: PRINT_JOB_MAX_BYTES,
    });
    expect(prepareJobOptions({ paperName: null, copies: 1, size: PRINT_JOB_MAX_BYTES + 1 }, [A4])).toEqual({
      refused: 'job_too_large',
    });
    expect(prepareJobOptions({ paperName: null, copies: 1, size: 0 }, [A4])).toEqual({ refused: 'invalid_job' });
  });
});

describe('a job’s file', () => {
  it('⚠ must start as a PDF does', () => {
    expect(startsLikePdf(Buffer.from('%PDF-1.4\n'))).toBe(true);
    expect(startsLikePdf(Buffer.from('%PDF'))).toBe(false);
    expect(startsLikePdf(Buffer.from('MZ\x90\x00\x03'))).toBe(false);
    expect(startsLikePdf(Buffer.from(' %PDF-1.4'))).toBe(false);
  });

  it('is sent to and fetched from one path, with the id escaped', () => {
    expect(printJobContentPath('abc')).toBe('/print/jobs/abc/content');
    expect(printJobContentPath('../x')).toBe('/print/jobs/..%2Fx/content');
  });
});

describe('a ticket', () => {
  it('is 32 bytes as base64url, and nothing else is one', () => {
    expect(isJobTicketShaped('a'.repeat(43))).toBe(true);
    expect(isJobTicketShaped('a'.repeat(42))).toBe(false);
    expect(isJobTicketShaped(`${'a'.repeat(42)}+`)).toBe(false);
    expect(isJobTicketShaped(undefined)).toBe(false);
  });
});

describe('what a computer says went wrong', () => {
  it('is shown as one line, cut, and null when it said nothing', () => {
    expect(cleanJobMessage('  The printer\n is  offline ')).toBe('The printer is offline');
    expect(cleanJobMessage('x'.repeat(1000))).toHaveLength(300);
    expect(cleanJobMessage('   ')).toBeNull();
    expect(cleanJobMessage(42)).toBeNull();
  });

  it('has a sentence for every failure', () => {
    for (const failure of [
      'agent_did_not_fetch',
      'nothing_sent',
      'not_a_pdf',
      'wrong_size',
      'interrupted',
      'printer_refused',
      'timed_out',
    ] as const) {
      expect(jobFailureText(failure).length).toBeGreaterThan(10);
    }
  });
});

describe('the ruler page', () => {
  it('is a PDF whose page is exactly the paper', () => {
    const file = text(rulerPagePdf(A4));
    expect(startsLikePdf(rulerPagePdf(A4))).toBe(true);
    // 210 × 297 mm in points.
    expect(file).toContain('/MediaBox [0 0 595.276 841.89]');
    expect(file.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('⚠ draws 100 mm lines from a corner 20 mm in and 30 mm down', () => {
    const file = text(rulerPagePdf(A4));
    expect(RULER_FROM_LEFT).toBe(2000);
    expect(RULER_FROM_TOP).toBe(3000);
    // 20 mm = 56.693 pt from the left; 297 − 30 mm = 756.85 pt up; 100 mm = 283.465 pt long.
    expect(file).toContain('56.693 756.85 m 340.157 756.85 l S');
    expect(file).toContain('56.693 756.85 m 56.693 473.386 l S');
    expect(file).toContain('Each line is 100 mm long');
  });

  it('⚠ uses a shorter line on a small paper, and says which', () => {
    expect(rulerLineLength(A4)).toBe(10000);
    expect(rulerLineLength(PHOTO)).toBe(5000);
    expect(rulerLineLength({ width: 5000, height: 5000 })).toBe(2000);
    expect(text(rulerPagePdf(PHOTO))).toContain('Each line is 50 mm long');
  });

  it('⚠ has a cross-reference table that points at its objects', () => {
    const file = text(rulerPagePdf(A4));
    const start = Number(/startxref\n(\d+)/.exec(file)?.[1]);
    expect(file.slice(start, start + 4)).toBe('xref');
    const offsets = [...file.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => {
      expect(file.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
    const length = Number(/\/Length (\d+)/.exec(file)?.[1]);
    const body = /stream\n([\s\S]*?)\nendstream/.exec(file)?.[1] ?? '';
    expect(body.length).toBe(length);
  });

  it('keeps a paper’s name from breaking the file', () => {
    const file = text(rulerPagePdf({ name: 'Légal (8.5 × 14) \\ test', width: 21590, height: 35560 }));
    expect(file).toContain('Paper: Lgal \\(8.5  14\\) \\\\ test');
  });
});

describe('a paper type and a quality for one print', () => {
  const SETTINGS = {
    mediaTypes: [
      { id: 'psk:Plain', label: 'Plain paper' },
      { id: 'psk:PhotographicHighGloss', label: 'Epson Premium Glossy' },
    ],
    qualities: [{ id: 'ns0000:HighQuality', label: 'High' }],
  };
  const ask = (extra: Record<string, unknown>) =>
    prepareJobOptions({ paperName: 'A4', copies: 1, size: 10, ...extra }, [A4], SETTINGS);

  it('takes the ones the printer reported, by id', () => {
    expect(ask({ mediaType: 'psk:PhotographicHighGloss', quality: 'ns0000:HighQuality' })).toMatchObject({
      mediaType: 'psk:PhotographicHighGloss',
      quality: 'ns0000:HighQuality',
    });
  });

  it('leaves the printer as it is set for one that is not chosen', () => {
    expect(ask({ mediaType: 'psk:Plain' })).toMatchObject({ mediaType: 'psk:Plain', quality: null });
    expect(ask({})).toMatchObject({ mediaType: null, quality: null });
  });

  it('⚠ refuses one the printer never reported: only the driver’s own words reach its ticket', () => {
    expect(ask({ mediaType: 'psk:Canvas' })).toEqual({ refused: 'invalid_job' });
    expect(ask({ quality: "x'/><psf:Feature" })).toEqual({ refused: 'invalid_job' });
    expect(ask({ quality: 7 })).toEqual({ refused: 'invalid_job' });
    // A printer that offers none takes none.
    expect(prepareJobOptions({ paperName: 'A4', copies: 1, size: 10, mediaType: 'psk:Plain' }, [A4])).toEqual({
      refused: 'invalid_job',
    });
  });
});
