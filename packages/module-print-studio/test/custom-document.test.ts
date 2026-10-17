import {
  checkDocumentSetup,
  defaultDocumentSetup,
  documentColumnWidth,
  documentFileName,
  documentName,
  documentSheet,
  editorPixelsToPoints,
  fitImageToPage,
  fromEditorPixels,
  isDocumentFileName,
  nextFontSize,
  pointsToEditorPixels,
  prepareDocumentFile,
  STUDIO_DOCUMENT_COLUMN_GAP_DEFAULT,
  STUDIO_DOCUMENT_FORMAT,
  STUDIO_DOCUMENT_UNTITLED,
  STUDIO_DOCUMENT_VERSION,
  type StudioDocumentFile,
  toEditorPixels,
} from '../src/domain/custom-document.js';
import { findStudioPaper } from '../src/domain/papers.js';
import { inches, mm } from '../src/domain/units.js';

function a4() {
  const paper = findStudioPaper('a4');
  if (!paper) throw new Error('A4 is a built-in paper.');
  return { key: paper.key, label: paper.label, width: paper.width, height: paper.height };
}

function savedFile(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const file: StudioDocumentFile = {
    format: STUDIO_DOCUMENT_FORMAT,
    version: STUDIO_DOCUMENT_VERSION,
    name: 'Notice',
    setup: defaultDocumentSetup(a4()),
    content: { main: [{ value: 'Closed on Monday' }] },
  };
  return { ...file, ...patch };
}

describe('the editor’s pixels', () => {
  it('makes A4 the 794 × 1123 page the editor draws by default', () => {
    expect(toEditorPixels(mm(210))).toBe(794);
    expect(toEditorPixels(mm(297))).toBe(1123);
    expect(toEditorPixels(inches(1))).toBe(96);
  });

  it('reads a margin dragged on the ruler back to units that draw as the same pixel', () => {
    expect(fromEditorPixels(96)).toBe(inches(1));
    for (const pixels of [0, 37, 75, 96, 113, 250, 377]) {
      expect(toEditorPixels(fromEditorPixels(pixels))).toBe(pixels);
    }
  });

  it('shows font sizes in points, as Google Docs does, and the editor gets pixels', () => {
    expect(pointsToEditorPixels(12)).toBe(16);
    expect(pointsToEditorPixels(11)).toBeCloseTo(14.667, 3);
    // Back to the same number, so the size box never reads 10.99.
    expect(editorPixelsToPoints(pointsToEditorPixels(11))).toBe(11);
    expect(editorPixelsToPoints(16)).toBe(12);
  });
});

describe('page settings', () => {
  it('starts on the paper given, upright, with an inch all round and no background', () => {
    const setup = defaultDocumentSetup(a4());
    expect(setup.orientation).toBe('portrait');
    expect(setup.margins).toEqual({ top: inches(1), right: inches(1), bottom: inches(1), left: inches(1) });
    expect(setup.background).toBeNull();
    expect(checkDocumentSetup(setup)).toBeNull();
  });

  it('turns the sheet for landscape', () => {
    expect(documentSheet({ paper: a4(), orientation: 'landscape' })).toEqual({ width: mm(297), height: mm(210) });
  });

  it('refuses margins that leave no room for the text, checked on the sheet as turned', () => {
    const margins = { top: mm(10), right: mm(95), bottom: mm(10), left: mm(95) };
    // 210 − 190 = 20 mm across upright: just enough.
    expect(checkDocumentSetup({ paper: a4(), orientation: 'portrait', margins })).toBeNull();
    const tall = { top: mm(95), right: mm(10), bottom: mm(100), left: mm(10) };
    expect(checkDocumentSetup({ paper: a4(), orientation: 'portrait', margins: tall })).toBeNull();
    // The same margins in landscape leave 210 − 195 = 15 mm down.
    expect(checkDocumentSetup({ paper: a4(), orientation: 'landscape', margins: tall })).toBe('no_room_for_text');
  });

  it('refuses a margin past 100 mm, under 0, or not a whole unit', () => {
    const ok = { top: mm(10), right: mm(10), bottom: mm(10), left: mm(10) };
    for (const top of [mm(101), -1, 1.5]) {
      expect(checkDocumentSetup({ paper: a4(), orientation: 'portrait', margins: { ...ok, top } })).toBe(
        'margin_out_of_range',
      );
    }
  });
});

describe('a picture placed in the document', () => {
  it('keeps a small picture at its own size', () => {
    expect(fitImageToPage({ width: 200, height: 100 }, { width: 600, height: 900 })).toEqual({
      width: 200,
      height: 100,
    });
  });

  it('shrinks a phone photo to the room inside the margins, its shape kept', () => {
    expect(fitImageToPage({ width: 4000, height: 3000 }, { width: 600, height: 900 })).toEqual({
      width: 600,
      height: 450,
    });
    expect(fitImageToPage({ width: 3000, height: 6000 }, { width: 600, height: 900 })).toEqual({
      width: 450,
      height: 900,
    });
  });
});

describe('the saved file', () => {
  it('reads back what was saved', () => {
    const read = prepareDocumentFile(JSON.parse(JSON.stringify(savedFile())));
    expect(read).toEqual(savedFile());
  });

  it('refuses a file that is not one, and one from a newer version', () => {
    expect(prepareDocumentFile(null)).toEqual({ refused: 'not_a_document' });
    expect(prepareDocumentFile({ main: [] })).toEqual({ refused: 'not_a_document' });
    expect(prepareDocumentFile(savedFile({ version: STUDIO_DOCUMENT_VERSION + 1 }))).toEqual({
      refused: 'newer_version',
    });
    expect(prepareDocumentFile(savedFile({ content: { main: 'text' } }))).toEqual({ refused: 'damaged' });
  });

  it('takes a built-in paper’s size from the studio, not from the file', () => {
    const setup = { ...defaultDocumentSetup(a4()), paper: { key: 'a4', label: 'A4', width: 1, height: 2 } };
    const read = prepareDocumentFile(savedFile({ setup }));
    expect('refused' in read ? null : read.setup.paper).toEqual(a4());
  });

  it('refuses margins edited by hand to leave no room for the text', () => {
    const setup = { ...defaultDocumentSetup(a4()), margins: { top: 0, right: mm(100), bottom: 0, left: mm(100) } };
    expect(prepareDocumentFile(savedFile({ setup }))).toEqual({ refused: 'damaged' });
  });

  it('keeps a background held in the file, and drops one that is a web address', () => {
    const held = 'data:image/png;base64,iVBORw0KGgo=';
    const kept = prepareDocumentFile(savedFile({ setup: { ...defaultDocumentSetup(a4()), background: held } }));
    expect('refused' in kept ? null : kept.setup.background).toBe(held);
    const remote = { ...defaultDocumentSetup(a4()), background: 'https://example.com/track.png' };
    const dropped = prepareDocumentFile(savedFile({ setup: remote }));
    expect('refused' in dropped ? 'refused' : dropped.setup.background).toBeNull();
  });

  it('names a document, and its file, safely', () => {
    expect(documentName('   ')).toBe(STUDIO_DOCUMENT_UNTITLED);
    expect(documentName('  Notice ')).toBe('Notice');
    expect(documentFileName('Price list: May/June')).toBe('Price list May June.kwdoc');
    expect(isDocumentFileName('Notice.KWDOC')).toBe(true);
    expect(isDocumentFileName('Notice.pdf')).toBe(false);
  });
});

describe('page numbers', () => {
  it('are off for a new document, and read back as saved', () => {
    expect(defaultDocumentSetup(a4()).pageNumbers).toBe(false);
    const numbered = prepareDocumentFile(savedFile({ setup: { ...defaultDocumentSetup(a4()), pageNumbers: true } }));
    expect('refused' in numbered ? null : numbered.setup.pageNumbers).toBe(true);
    const missing = prepareDocumentFile(savedFile({ setup: { ...defaultDocumentSetup(a4()), pageNumbers: 'yes' } }));
    expect('refused' in missing ? null : missing.setup.pageNumbers).toBe(false);
  });
});

describe('columns', () => {
  it('starts as one column, with half an inch ready for a gap', () => {
    expect(defaultDocumentSetup(a4()).columns).toEqual({ count: 1, gap: inches(0.5), separator: false });
  });

  it('splits the width inside the margins between the columns, less the gaps', () => {
    const setup = {
      ...defaultDocumentSetup(a4()),
      margins: { top: mm(20), right: mm(20), bottom: mm(20), left: mm(20) },
    };
    expect(documentColumnWidth(setup)).toBe(mm(170));
    // 170 − 10 = 160 mm, in two.
    expect(documentColumnWidth({ ...setup, columns: { count: 2, gap: mm(10), separator: true } })).toBe(mm(80));
    expect(checkDocumentSetup({ ...setup, columns: { count: 3, gap: mm(10), separator: false } })).toBeNull();
  });

  it('refuses columns narrower than the text’s minimum, and a gap out of range', () => {
    const narrow = {
      ...defaultDocumentSetup(a4()),
      margins: { top: mm(10), right: mm(80), bottom: mm(10), left: mm(80) },
    };
    // 50 mm inside: one column fits, two of 20 mm with a 10 mm gap fit, three do not.
    expect(checkDocumentSetup(narrow)).toBeNull();
    expect(checkDocumentSetup({ ...narrow, columns: { count: 2, gap: mm(10), separator: false } })).toBeNull();
    expect(checkDocumentSetup({ ...narrow, columns: { count: 3, gap: mm(10), separator: false } })).toBe(
      'columns_too_narrow',
    );
    const wide = defaultDocumentSetup(a4());
    for (const gap of [mm(51), -1, 0.5]) {
      expect(checkDocumentSetup({ ...wide, columns: { count: 2, gap, separator: false } })).toBe(
        'column_gap_out_of_range',
      );
    }
    // With one column the gap is not used, so it is not checked.
    expect(checkDocumentSetup({ ...wide, columns: { count: 1, gap: mm(51), separator: false } })).toBeNull();
  });

  it('reads back as saved, and a file saved before columns opens as one', () => {
    const columns = { count: 2, gap: mm(8), separator: true };
    const read = prepareDocumentFile(savedFile({ setup: { ...defaultDocumentSetup(a4()), columns } }));
    expect('refused' in read ? null : read.setup.columns).toEqual(columns);

    const { columns: _dropped, ...older } = defaultDocumentSetup(a4());
    const opened = prepareDocumentFile(savedFile({ setup: older }));
    expect('refused' in opened ? null : opened.setup.columns).toEqual({
      count: 1,
      gap: STUDIO_DOCUMENT_COLUMN_GAP_DEFAULT,
      separator: false,
    });
  });

  it('reads a count it does not offer as one column, and refuses a saved gap out of range', () => {
    const odd = prepareDocumentFile(
      savedFile({ setup: { ...defaultDocumentSetup(a4()), columns: { count: 7, gap: mm(5), separator: 'yes' } } }),
    );
    expect('refused' in odd ? null : odd.setup.columns).toEqual({ count: 1, gap: mm(5), separator: false });
    const far = { ...defaultDocumentSetup(a4()), columns: { count: 2, gap: mm(80), separator: false } };
    expect(prepareDocumentFile(savedFile({ setup: far }))).toEqual({ refused: 'damaged' });
  });
});

describe('+ and − on the font size', () => {
  it('go to the next size in the list, so a press shows on large letters too', () => {
    expect(nextFontSize(11, 1)).toBe(12);
    expect(nextFontSize(12, 1)).toBe(14);
    expect(nextFontSize(72, 1)).toBe(96);
    expect(nextFontSize(96, -1)).toBe(72);
    expect(nextFontSize(200, 1)).toBe(300);
  });

  it('go from a typed size to the nearer one in that direction', () => {
    expect(nextFontSize(13, 1)).toBe(14);
    expect(nextFontSize(13, -1)).toBe(12);
    expect(nextFontSize(250, -1)).toBe(200);
  });

  it('step by 1 below the list, and stay at either end', () => {
    expect(nextFontSize(8, -1)).toBe(7);
    expect(nextFontSize(2, -1)).toBe(1);
    expect(nextFontSize(1, -1)).toBe(1);
    expect(nextFontSize(5.5, -1)).toBe(5);
    expect(nextFontSize(5, 1)).toBe(8);
    expect(nextFontSize(400, 1)).toBe(400);
  });
});
