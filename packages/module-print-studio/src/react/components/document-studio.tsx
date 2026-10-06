'use client';

import { cn } from '@kwtech/web-ui/react';
import { FileText, FileUp, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { printableArea, type StudioLayoutPaper, type StudioOrientation, sheetSize } from '../../domain/layout.js';
import {
  groupIntoSheets,
  parsePageRange,
  placeInSlot,
  STUDIO_PAGE_FITS,
  STUDIO_PAGES_PER_SHEET,
  type StudioPageFit,
  type StudioPagesPerSheet,
  sheetSlots,
} from '../../domain/page-layout.js';
import { mm } from '../../domain/units.js';
import { loadDocument, makeDocumentResult, type StudioDocument } from '../render/document.js';
import { openPdfPreview, type StudioPdfPreview } from '../render/pdf-preview.js';
import type { StudioResult } from '../render/result.js';
import type { StudioAppState } from '../studio-state.js';
import { paperName, plural } from '../view/summary.js';
import { resultFileName } from '../view/work.js';
import { buttonClass, Field, INPUT_CLASS } from './controls.js';
import { Alert, EmptyState, StudioSplit } from './layout.js';
import { OutputBar } from './output-bar.js';
import { Pager } from './pager.js';
import { defaultPaper, PaperPicker } from './paper-fields.js';
import { RulerMenu, useRulerUnit } from './sheet-rulers.js';
import { fitWidth, SheetFrame } from './sheet-view.js';

const FIT_LABELS: Record<StudioPageFit, string> = {
  fit: 'Fit the whole page',
  fill: 'Fill the paper (edges may be cut)',
  actual: 'Actual size',
};

/** The margin a document is printed inside: 5 mm, what an ordinary office printer cannot reach. */
const DOCUMENT_MARGIN = mm(5);
/** Between two pages that share a sheet. */
const DOCUMENT_GAP = mm(4);

/**
 * Printing a document as whole pages (PRINT-STUDIO-PLAN §3, "Whole-page mode").
 *
 * A PDF never goes into a layout's cells — layouts are for photos (decision 5).
 * It is placed on a paper page by page: one, two or four to a sheet.
 *
 * ⚠ THE PDF STAYS IN THE BROWSER, like a photo. Its pages are copied into the
 * result as they are, so text stays sharp.
 *
 * The preview DRAWS the pages (`pdf-preview.ts`), sheet by sheet, so the person
 * sees which pages they are printing and how they sit on the paper. That
 * drawing is for looking only — the result copies the pages themselves. A page
 * that cannot be drawn shows as its number in a box, and still prints.
 */
export function DocumentStudio({
  state,
  modeSwitch,
}: {
  state: StudioAppState;
  /** The photos-or-document switch, drawn at the top of the settings so it takes no row above the sheet. */
  modeSwitch: ReactNode;
}) {
  const inputId = useId();
  const [document, setDocument] = useState<StudioDocument | null>(null);
  const [paper, setPaper] = useState<StudioLayoutPaper>(() => defaultPaper('a4'));
  const [orientation, setOrientation] = useState<StudioOrientation>('portrait');
  const [perSheet, setPerSheet] = useState<StudioPagesPerSheet>(1);
  const [fit, setFit] = useState<StudioPageFit>('fit');
  const [range, setRange] = useState('');
  const [copies, setCopies] = useState(1);
  const [result, setResult] = useState<StudioResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The document as something that can be DRAWN, for the preview. Null when it could not be, or none is open. */
  const [preview, setPreview] = useState<StudioPdfPreview | null>(null);
  /** Which sheet of the result is being looked at, from 0. */
  const [sheetIndex, setSheetIndex] = useState(0);
  const [viewZoom, setViewZoom] = useState(1);
  const [rulerUnit, setRulerUnit] = useRulerUnit();

  // The drawing library holds the whole document: let go of it when another replaces it, and when the screen goes.
  useEffect(() => () => preview?.close(), [preview]);

  const spec = useMemo(
    () => ({
      paper,
      orientation,
      margins: { top: DOCUMENT_MARGIN, right: DOCUMENT_MARGIN, bottom: DOCUMENT_MARGIN, left: DOCUMENT_MARGIN },
    }),
    [paper, orientation],
  );
  const sheet = sheetSize(spec);
  const area = printableArea(spec);
  const pages = document ? parsePageRange(range, document.pages.length) : null;
  const sheets = pages ? groupIntoSheets(pages, perSheet) : [];
  const slots = sheetSlots(area, perSheet, DOCUMENT_GAP);

  /** Any change to what will be printed drops a result made from the old settings. */
  function change(apply: () => void) {
    apply();
    setResult(null);
  }

  async function open(file: File | undefined) {
    if (!file) return;
    setBusy('Opening…');
    setError(null);
    try {
      const opened = await loadDocument(file);
      setDocument(opened);
      setRange('');
      setResult(null);
      setSheetIndex(0);
      // The pages' pictures are a courtesy: without them the screen still shows where each page lands.
      setPreview(await openPdfPreview(opened.bytes).catch(() => null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open that file.');
    } finally {
      setBusy(null);
    }
  }

  async function make(): Promise<StudioResult> {
    if (!document || !pages) throw new Error('Choose a PDF first.');
    const made = await makeDocumentResult({ document, spec, pages, perSheet, fit, gap: DOCUMENT_GAP, copies });
    setResult(made);
    return made;
  }

  function clearEverything() {
    setDocument(null);
    setPreview(null);
    setResult(null);
    setRange('');
    setError(null);
  }

  const picker = (
    <>
      <label htmlFor={inputId} className={cn(buttonClass('primary'), 'cursor-pointer')}>
        <FileUp aria-hidden="true" className="size-4" />
        {busy === 'Opening…' ? 'Opening…' : 'Choose a PDF'}
      </label>
      <input
        id={inputId}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(event) => {
          void open(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </>
  );

  if (!document) {
    return (
      <div className="flex flex-col gap-3">
        <div className="self-start">{modeSwitch}</div>
        <Alert message={error} onDismiss={() => setError(null)} />
        <EmptyState icon={FileText} title="Print a document" action={picker}>
          Choose a PDF to print as whole pages. It stays on this computer: nothing is uploaded or saved. A Word document
          needs saving as a PDF first.
        </EmptyState>
      </div>
    );
  }

  // A page range made shorter can leave the screen on a sheet that is no longer there.
  const shown = Math.min(sheetIndex, Math.max(sheets.length - 1, 0));
  const onSheet = sheets[shown] ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Alert message={error} onDismiss={() => setError(null)} />
      <StudioSplit
        side={
          <>
            {modeSwitch}
            <section className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card p-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold" title={document.name}>
                  {document.name}
                </h3>
                <p className="text-xs text-muted-foreground">{plural(document.pages.length, 'page')}</p>
              </div>
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={clearEverything}>
                <X aria-hidden="true" className="size-3.5" />
                Close
              </button>
            </section>

            <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
              <PaperPicker
                paper={paper}
                orientation={orientation}
                onPaper={(next) => change(() => setPaper(next))}
                onOrientation={(next) => change(() => setOrientation(next))}
              />
              <Field label="Pages on each sheet">
                {(id) => (
                  <select
                    id={id}
                    className={cn(INPUT_CLASS, 'h-9')}
                    value={perSheet}
                    onChange={(event) =>
                      change(() =>
                        setPerSheet(STUDIO_PAGES_PER_SHEET.find((one) => one === Number(event.target.value)) ?? 1),
                      )
                    }
                  >
                    {STUDIO_PAGES_PER_SHEET.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Size on the paper">
                {(id) => (
                  <select
                    id={id}
                    className={cn(INPUT_CLASS, 'h-9')}
                    value={fit}
                    onChange={(event) =>
                      change(() => setFit(STUDIO_PAGE_FITS.find((one) => one === event.target.value) ?? 'fit'))
                    }
                  >
                    {STUDIO_PAGE_FITS.map((option) => (
                      <option key={option} value={option}>
                        {FIT_LABELS[option]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                label="Which pages"
                hint="Leave empty for all of them, or type pages and ranges: 1-3, 5, 8-"
                error={pages === null ? 'That is not a list of pages. Try 1-3, 5.' : null}
              >
                {(id, describedBy) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={pages === null ? true : undefined}
                    className={cn(INPUT_CLASS, 'h-9')}
                    value={range}
                    placeholder="All pages"
                    onChange={(event) => change(() => setRange(event.target.value))}
                  />
                )}
              </Field>
            </section>
          </>
        }
        output={
          <OutputBar
            state={state}
            summary={
              pages === null
                ? 'Fix the page list to continue.'
                : `${plural(pages.length, 'page')} on ${plural(sheets.length, 'sheet')} of ${paperName(spec, 'mm')}`
            }
            copies={copies}
            onCopies={(next) => change(() => setCopies(next))}
            canMake={pages !== null && pages.length > 0}
            result={result}
            make={make}
            fileName={resultFileName(document.name.replace(/\.pdf$/iu, ''))}
            entry={(made) => ({
              kind: 'pages',
              layoutId: null,
              layoutName: null,
              paperLabel: paperName(spec, 'mm'),
              paperWidth: sheet.width,
              paperHeight: sheet.height,
              pages: made.pages,
              copies: made.copies,
              fileNames: [document.name],
            })}
            hasWork
            onStartOver={clearEverything}
            onError={setError}
          />
        }
      >
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-muted/30">
          <SheetFrame
            zoom={viewZoom}
            onZoom={setViewZoom}
            tools={<RulerMenu unit={rulerUnit} onUnit={setRulerUnit} />}
            rulers={{ unit: rulerUnit, sheet }}
            dock={
              sheets.length > 1 ? (
                <Pager count={sheets.length} current={shown} noun="Sheet" onChange={setSheetIndex} />
              ) : undefined
            }
          >
            {/* The sheet, to scale, with each page drawn where it will print. Paper is white in every theme. */}
            <div
              role="img"
              aria-label={`Sheet ${shown + 1} of ${sheets.length}: ${plural(onSheet.length, 'page')} on ${paperName(spec, 'mm')}`}
              data-studio-paper
              className="relative shadow-md ring-1 ring-border"
              style={{
                width: fitWidth(sheet, viewZoom),
                aspectRatio: `${sheet.width} / ${sheet.height}`,
                backgroundColor: '#ffffff',
              }}
            >
              {slots.map((slot, at) => {
                const pageIndex = onSheet[at];
                const size = pageIndex === undefined ? undefined : document.pages[pageIndex];
                if (pageIndex === undefined || !size) return null;
                const placed = placeInSlot(size, slot, fit);
                return (
                  // ⚠ `overflow-hidden`: "fill" and "actual size" place a page larger than its slot, and the slot cuts it —
                  // as the result does.
                  <div
                    key={`${slot.x}:${slot.y}`}
                    className="absolute overflow-hidden"
                    style={{
                      left: `${((area.x + slot.x) / sheet.width) * 100}%`,
                      top: `${((area.y + slot.y) / sheet.height) * 100}%`,
                      width: `${(slot.width / sheet.width) * 100}%`,
                      height: `${(slot.height / sheet.height) * 100}%`,
                    }}
                  >
                    <div
                      className="absolute"
                      style={{
                        left: `${(placed.x / slot.width) * 100}%`,
                        top: `${(placed.y / slot.height) * 100}%`,
                        width: `${(placed.width / slot.width) * 100}%`,
                        height: `${(placed.height / slot.height) * 100}%`,
                      }}
                    >
                      <PageView
                        preview={preview}
                        pageIndex={pageIndex}
                        // Looked at closer, or alone on its sheet, a page is drawn finer.
                        pixels={Math.round((perSheet === 1 ? 1000 : 700) * Math.min(viewZoom, 2.5))}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </SheetFrame>
        </div>
      </StudioSplit>
    </div>
  );
}

/**
 * One page of the document, drawn — or, when it cannot be, its number in a
 * box the page's shape, which is what the screen showed before pages could be
 * drawn at all.
 */
function PageView({
  preview,
  pageIndex,
  pixels,
}: {
  preview: StudioPdfPreview | null;
  pageIndex: number;
  /** How many pixels across to draw it. */
  pixels: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = canvas.current;
    setFailed(false);
    if (!preview || !element) return;
    let cancelled = false;
    preview.drawPage(pageIndex, element, pixels).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [preview, pageIndex, pixels]);

  const drawn = preview !== null && !failed;
  return (
    <>
      {/*
       * ⚠ THE CANVAS STAYS MOUNTED even while the number shows in its place: a page that failed once is
       * tried again when anything about it changes, and there has to be a canvas to try on.
       */}
      <canvas ref={canvas} className={drawn ? 'block size-full' : 'hidden'} />
      {drawn ? null : (
        // On the white sheet: literal colours, as the paper's are.
        <div
          className="flex size-full items-center justify-center border text-2xl font-semibold"
          style={{ borderColor: '#2563eb', color: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.08)' }}
        >
          {pageIndex + 1}
        </div>
      )}
    </>
  );
}
