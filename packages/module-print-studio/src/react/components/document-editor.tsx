'use client';

import type { IEditorData, IEditorOption, IElement, IRangeStyle } from '@hufe921/canvas-editor';
import {
  ConfirmDialog,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Highlighter,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Plus,
  Redo2,
  RemoveFormatting,
  Ruler,
  Save,
  SeparatorHorizontal,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  checkDocumentSetup,
  defaultDocumentSetup,
  documentColumnWidth,
  documentName,
  documentSheet,
  editorPixelsToPoints,
  fitImageToPage,
  fromEditorPixels,
  nextFontSize,
  pointsToEditorPixels,
  STUDIO_DEFAULT_FONT,
  STUDIO_DEFAULT_FONT_POINTS,
  STUDIO_DOCUMENT_COLUMN_COUNTS,
  STUDIO_DOCUMENT_COLUMN_GAP_MAX,
  STUDIO_DOCUMENT_FORMAT,
  STUDIO_DOCUMENT_NAME_MAX,
  STUDIO_DOCUMENT_PRINT_DPI,
  STUDIO_DOCUMENT_SETUP_MESSAGES,
  STUDIO_DOCUMENT_UNTITLED,
  STUDIO_DOCUMENT_VERSION,
  STUDIO_EDITOR_DPI,
  STUDIO_FONT_SIZE_MAX,
  STUDIO_FONT_SIZE_MIN,
  STUDIO_FONT_SIZES,
  STUDIO_FONTS,
  STUDIO_LINE_SPACINGS,
  type StudioDocumentColumns,
  type StudioDocumentContent,
  type StudioDocumentFile,
  type StudioDocumentSetup,
  toEditorPixels,
} from '../../domain/custom-document.js';
import type { StudioMargins } from '../../domain/layout.js';
import { mm, toMm } from '../../domain/units.js';
import {
  downloadDocumentFile,
  imageSize,
  makeCustomDocumentPdf,
  readImageAsDataUrl,
} from '../render/custom-document.js';
import { makeDocumentResult, type StudioDocument } from '../render/document.js';
import type { StudioResult } from '../render/result.js';
import type { StudioAppState } from '../studio-state.js';
import { paperName, plural } from '../view/summary.js';
import { resultFileName } from '../view/work.js';
import { buttonClass, Field, INPUT_CLASS } from './controls.js';
import { Alert, StudioSplit } from './layout.js';
import { OutputBar } from './output-bar.js';
import { defaultPaper, PaperPicker } from './paper-fields.js';

/** A sheet with nothing taken off it: a written page is printed exactly the paper's size. */
const NO_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** The editor library, loaded when a document is first written — it is large, and most prints never need it. */
type CanvasEditorLib = typeof import('@hufe921/canvas-editor');
type CanvasEditor = InstanceType<CanvasEditorLib['Editor']>;
type EditorCommand = CanvasEditor['command'];
/** What `executeUpdateOptions` takes: the library's `IUpdateOption`, copied, since its entry point does not export it. */
type UpdatableOptions = Omit<
  IEditorOption,
  | 'mode'
  | 'width'
  | 'height'
  | 'scale'
  | 'pageGap'
  | 'pageMode'
  | 'paperDirection'
  | 'historyMaxRecordCount'
  | 'scrollContainerSelector'
>;

/** Pictures the editor can draw. HEIC is not among them: a browser cannot show it without converting it first. */
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** The text styles offered, Google Docs' names for them. */
const TEXT_STYLES = [
  { key: 'normal', label: 'Normal text' },
  { key: 'first', label: 'Heading 1' },
  { key: 'second', label: 'Heading 2' },
  { key: 'third', label: 'Heading 3' },
  { key: 'fourth', label: 'Heading 4' },
] as const;

/**
 * Writing a document on a chosen paper (the operator, 2026-10-11: "a bit
 * similar to google docs"), then printing it as the document screen prints a
 * PDF.
 *
 * The editor is `@hufe921/canvas-editor` (MIT): it draws real pages on
 * canvases, so the paper, the margins and where each page breaks are what the
 * print will be. This component is its toolbar and its page settings.
 *
 * - ⚠ THE DOCUMENT IS KEPT ONLY AS A FILE, saved to this computer with "Save"
 *   (`.kwdoc`) and opened again from the PDF side's first screen. Nothing is
 *   uploaded or stored, as everywhere in the studio.
 * - ⚠ PRINT, PRINTERS AND DOWNLOAD ARE HERE, and act at once (the operator,
 *   2026-10-11: "it will not change view"): the PDF side's own output bar,
 *   whose result is the pages drawn at 300 dpi, each on a sheet of the
 *   document's paper at exactly its size. Pages per sheet and a page range are
 *   left to the browser's print dialog: a second way to print, on another
 *   screen, was a step that confused more than it gave (the operator,
 *   2026-10-11).
 * - The editor is the library's own, imperative object, made ONCE when this
 *   mounts and told about every change after (`execute*`). Remaking it on a
 *   change would lose the text being typed.
 */
export function DocumentEditor({
  state,
  initial,
  modeSwitch,
  onClose,
}: {
  state: StudioAppState;
  /** The document to open, or null for a new, empty one. */
  initial: StudioDocumentFile | null;
  /** The photos-or-document switch, at the top of the settings like the other screens'. */
  modeSwitch: ReactNode;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CanvasEditor | null>(null);
  const libRef = useRef<CanvasEditorLib | null>(null);
  // The editor's scroll box, found by the library with a CSS selector — so an id with no colons, which useId has.
  const scrollId = `studio-editor-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
  const imageInputId = useId();
  const backgroundInputId = useId();

  const [name, setName] = useState(initial?.name ?? STUDIO_DOCUMENT_UNTITLED);
  const [setup, setSetup] = useState<StudioDocumentSetup>(
    () => initial?.setup ?? defaultDocumentSetup(defaultPaper('a4')),
  );
  const [style, setStyle] = useState<IRangeStyle | null>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Something changed since the document was opened or last saved: Close asks first. */
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [copies, setCopies] = useState(1);
  /** How many pages the document runs to now, as the editor last said. */
  const [pageCount, setPageCount] = useState(1);
  /**
   * The PDF last made, reused by the next Print or Download while nothing has changed — the output bar's rule.
   * ⚠ Dropped by every change (`changed`): a print must never be of the document as it was.
   */
  const [result, setResult] = useState<StudioResult | null>(null);
  /**
   * The rulers along the page's top and left edge, as in Google Docs: on to begin with, and held in memory only
   * (the studio writes nothing to browser storage). A way of looking, so never saved in the document.
   */
  const [showRuler, setShowRuler] = useState(true);
  // Read by the editor's callbacks, which are made once and would otherwise see the first render's values.
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const rulerRef = useRef(showRuler);
  rulerRef.current = showRuler;

  // The editor is made once, from the settings as they are then; later changes are sent to it by the effect below.
  const startRef = useRef({ setup, content: initial?.content ?? null });

  useEffect(() => {
    let cancelled = false;
    let made: CanvasEditor | null = null;
    import('@hufe921/canvas-editor')
      .then((lib) => {
        if (cancelled || !host.current) return;
        libRef.current = lib;
        const start = startRef.current;
        made = new lib.Editor(
          host.current,
          editorData(start.content),
          editorOptions(lib, start.setup, rulerRef.current, scrollId),
        );
        /*
         * ⚠ A STYLE WITH NO `type` IS THE LIBRARY'S RESET, NOT THE CURSOR'S, and is ignored. On a mousedown anywhere
         * outside its pages (a toolbar list, the size menu, the page settings) or when the window loses focus, it
         * sends its DEFAULTS (`recoveryRangeStyle`) while the cursor and the selection stay where they were. The
         * toolbar then showed line spacing 1, the default font and size, no list, no heading: picking 1 again on
         * a paragraph at 1.5 was no change to the list, so nothing was sent (the operator, 2026-10-17), "+" on a
         * 30 pt title stepped from 11 pt, and the list button added a list instead of taking it off. The style
         * at a real cursor always has a type (it falls back to "text"), so this drops the reset only.
         */
        made.listener.rangeStyleChange = (next: IRangeStyle) => {
          if (next.type !== null) setStyle(next);
        };
        made.listener.pageScaleChange = (next: number) => setScale(next);
        made.listener.contentChange = () => {
          setDirty(true);
          setResult(null);
        };
        made.listener.pageSizeChange = (count: number) => setPageCount(Math.max(1, count));
        // ⚠ That fires on a CHANGE only, and the first layout came before it was set: a saved document of three
        // pages would read "1 page". So the pages already drawn are counted once, here.
        setPageCount(Math.max(1, host.current.querySelectorAll('.ce-page-container > canvas').length));
        editorRef.current = made;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError('The editor could not be loaded. Reload the page and try again.');
      });
    /*
     * ⚠ A MARGIN DRAGGED ON THE RULER IS THE EDITOR'S CHANGE, not ours: the library moves its own margins and
     * says nothing. So when a press ends anywhere, its margins are read back into the settings, or the boxes in
     * the column would show the old ones and the next change of paper would put them back. After the library's
     * own mouseup handler (a turn later), and only when they differ, so typing costs nothing.
     */
    function readMarginsBack() {
      window.setTimeout(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const [top, right, bottom, left] = editor.command.getPaperMargin();
        if (marginPixels(setupRef.current.margins).join() === [top, right, bottom, left].join()) return;
        const margins = {
          top: fromEditorPixels(top),
          right: fromEditorPixels(right),
          bottom: fromEditorPixels(bottom),
          left: fromEditorPixels(left),
        };
        setSetup((current) => ({ ...current, margins }));
        setDirty(true);
        setResult(null);
      }, 0);
    }
    document.addEventListener('mouseup', readMarginsBack);
    return () => {
      cancelled = true;
      document.removeEventListener('mouseup', readMarginsBack);
      made?.destroy();
      editorRef.current = null;
    };
  }, [scrollId]);

  // The page settings, sent to the editor whenever they change. Sending them again unchanged costs one redraw.
  useEffect(() => {
    const editor = editorRef.current;
    const lib = libRef.current;
    if (!ready || !editor || !lib || checkDocumentSetup(setup) !== null) return;
    const sheet = documentSheet(setup);
    /*
     * ⚠ EVERY OPTION, NEVER ONLY THE ONE THAT CHANGED: the library's `updateOptions` rebuilds its options from
     * its OWN defaults plus what it is given, so `{ background }` alone put back its Chinese default font, 12 pt,
     * its margins and its Chinese menus. Seen on 2026-10-11. The page size and margins go after it, by their
     * own commands, which also lay the pages out again.
     */
    editor.command.executeUpdateOptions(updatableOptions(lib, setup, rulerRef.current));
    editor.command.executePaperSize(toEditorPixels(sheet.width), toEditorPixels(sheet.height));
    editor.command.executeSetPaperMargin(marginPixels(setup.margins));
  }, [ready, setup]);

  // Shown or hidden by the library's own command, which keeps the option it reads in step.
  useEffect(() => {
    if (ready) editorRef.current?.command.executeToggleRuler(showRuler);
  }, [ready, showRuler]);

  /** Run a command on the editor, when there is one. Every toolbar button goes through here. */
  function run(apply: (command: EditorCommand, lib: CanvasEditorLib) => void) {
    const editor = editorRef.current;
    const lib = libRef.current;
    if (!editor || !lib) return;
    apply(editor.command, lib);
    focusEditor();
  }

  /**
   * Give the keyboard back to the document, where the cursor and the selection still are.
   *
   * ⚠ AFTER EVERY TOOLBAR CHOICE (the operator, 2026-10-11: "I already set a font but when I change the size it
   * changes back to Arial"). A font list, a size box or a menu keeps the focus when it is used, so the next step
   * was a click back into the page — and that click MOVES the cursor, which throws away the selection and the
   * style picked for the next words, and the boxes then show the style where the click landed. Focusing the
   * library's own text box moves nothing.
   */
  function focusEditor() {
    host.current?.querySelector<HTMLTextAreaElement>('.ce-inputarea')?.focus();
  }

  function changeSetup(patch: Partial<StudioDocumentSetup>) {
    setSetup((current) => ({ ...current, ...patch }));
    setDirty(true);
    setResult(null);
  }

  // ⚠ A reload or a closed tab loses what was written since the last save: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** The document as it stands, as it would be saved. */
  function currentFile(): StudioDocumentFile | null {
    const editor = editorRef.current;
    if (!editor) return null;
    // ⚠ The editor's data, kept as it gave it: the studio never reads inside it (see `StudioDocumentFile`).
    const content: StudioDocumentContent = editor.command.getValue().data;
    return {
      format: STUDIO_DOCUMENT_FORMAT,
      version: STUDIO_DOCUMENT_VERSION,
      name: documentName(name),
      setup,
      content,
    };
  }

  function save() {
    const file = currentFile();
    if (!file) return;
    downloadDocumentFile(file);
    setDirty(false);
  }

  /** The document's pages, drawn at 300 dpi into a PDF of its own paper. Throws a sentence. */
  async function drawPdf(file: StudioDocumentFile): Promise<StudioDocument> {
    const editor = editorRef.current;
    const lib = libRef.current;
    if (!editor || !lib) throw new Error('The editor is not ready yet.');
    const shownScale = editor.command.getOptions().scale ?? 1;
    try {
      /*
       * ⚠ AT 100%, as the library's own print does: the pages are drawn at the zoom on screen times the pixel
       * ratio, so at 150% they would come out half as large again as the paper.
       */
      if (shownScale !== 1) editor.command.executePageScale(1);
      const pages = await editor.command.getImage({
        pixelRatio: STUDIO_DOCUMENT_PRINT_DPI / STUDIO_EDITOR_DPI,
        mode: lib.EditorMode.PRINT,
      });
      return await makeCustomDocumentPdf(pages, documentSheet(file.setup), file.name);
    } finally {
      if (shownScale !== 1) editor.command.executePageScale(shownScale);
    }
  }

  /**
   * The output bar's result: every page on a sheet of the document's own paper, at exactly its size.
   *
   * ⚠ NO MARGIN AROUND IT, unlike a chosen PDF (5 mm): the page was written to be that paper, so a margin would
   * shrink or cut it. Copies are the document screen's (`makeDocumentResult`).
   */
  async function make(): Promise<StudioResult> {
    const file = currentFile();
    if (!file) throw new Error('The editor is not ready yet.');
    const document = await drawPdf(file);
    const made = await makeDocumentResult({
      document,
      spec: { paper: file.setup.paper, orientation: file.setup.orientation, margins: NO_MARGINS },
      pages: document.pages.map((_page, index) => index),
      perSheet: 1,
      fit: 'actual',
      gap: 0,
      copies,
    });
    setResult(made);
    return made;
  }

  async function insertImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const value = await readImageAsDataUrl(file);
      const size = fitImageToPage(await imageSize(value), textRoom(setup));
      run((command) => command.executeImage({ value, width: size.width, height: size.height }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add that picture.');
    }
  }

  async function chooseBackground(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      changeSetup({ background: await readImageAsDataUrl(file) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not use that picture.');
    }
  }

  const setupProblem = checkDocumentSetup(setup);
  const points = style ? editorPixelsToPoints(style.size) : STUDIO_DEFAULT_FONT_POINTS;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Alert message={error} onDismiss={() => setError(null)} />
      <StudioSplit
        side={
          <>
            {modeSwitch}
            <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Document</h3>
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => (dirty ? setConfirmClose(true) : onClose())}
                >
                  <X aria-hidden="true" className="size-3.5" />
                  Close
                </button>
              </div>
              <Field label="Name">
                {(id) => (
                  <input
                    id={id}
                    className={cn(INPUT_CLASS, 'h-9')}
                    value={name}
                    maxLength={STUDIO_DOCUMENT_NAME_MAX}
                    onChange={(event) => {
                      setName(event.target.value);
                      setDirty(true);
                    }}
                  />
                )}
              </Field>
              <button type="button" className={buttonClass('secondary', 'sm')} disabled={!ready} onClick={save}>
                <Save aria-hidden="true" className="size-3.5" />
                Save to this computer
              </button>
              <p className="text-xs text-muted-foreground">
                {dirty
                  ? 'Not saved yet. Save keeps it as a file you can open and edit again.'
                  : 'Saved to this computer.'}
              </p>
            </section>

            <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
              <h3 className="text-sm font-semibold">Page</h3>
              <PaperPicker
                paper={setup.paper}
                orientation={setup.orientation}
                onPaper={(paper) => changeSetup({ paper })}
                onOrientation={(orientation) => changeSetup({ orientation })}
              />
              <MarginFields margins={setup.margins} onMargins={(margins) => changeSetup({ margins })} />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={setup.pageNumbers}
                  onChange={(event) => changeSetup({ pageNumbers: event.target.checked })}
                />
                Page numbers at the foot of each page
              </label>
              <ColumnFields columns={setup.columns} onColumns={(columns) => changeSetup({ columns })} />
              {setupProblem ? (
                <p role="alert" className="text-xs text-destructive">
                  {STUDIO_DOCUMENT_SETUP_MESSAGES[setupProblem]}
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
              <h3 className="text-sm font-semibold">Background picture</h3>
              {setup.background ? (
                <>
                  <img
                    src={setup.background}
                    alt="The page background"
                    className="h-24 w-full rounded-lg object-cover"
                  />
                  <Field label="Fit">
                    {(id) => (
                      <select
                        id={id}
                        className={cn(INPUT_CLASS, 'h-9')}
                        value={setup.backgroundFit}
                        onChange={(event) =>
                          changeSetup({ backgroundFit: event.target.value === 'contain' ? 'contain' : 'cover' })
                        }
                      >
                        <option value="cover">Cover the whole page</option>
                        <option value="contain">Fit inside the page</option>
                      </select>
                    )}
                  </Field>
                  <button
                    type="button"
                    className={buttonClass('secondary', 'sm')}
                    onClick={() => changeSetup({ background: null })}
                  >
                    Remove the background
                  </button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A picture behind the text on every page: a letterhead, a border, a certificate frame.
                </p>
              )}
              <label htmlFor={backgroundInputId} className={cn(buttonClass('secondary', 'sm'), 'cursor-pointer')}>
                <ImagePlus aria-hidden="true" className="size-3.5" />
                {setup.background ? 'Change the picture' : 'Choose a picture'}
              </label>
              <input
                id={backgroundInputId}
                type="file"
                accept={IMAGE_ACCEPT}
                className="sr-only"
                onChange={(event) => {
                  void chooseBackground(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </section>
          </>
        }
        output={
          <OutputBar
            state={state}
            summary={`${plural(pageCount, 'page')} of ${paperName(setup, 'mm')}`}
            copies={copies}
            onCopies={(next) => {
              setCopies(next);
              setResult(null);
            }}
            canMake={ready && setupProblem === null}
            result={result}
            make={make}
            fileName={resultFileName(documentName(name))}
            entry={(made) => {
              const sheet = documentSheet(setup);
              return {
                kind: 'pages',
                layoutId: null,
                layoutName: null,
                paperLabel: paperName(setup, 'mm'),
                paperWidth: sheet.width,
                paperHeight: sheet.height,
                pages: made.pages,
                copies: made.copies,
                // The document's name, as a chosen PDF's file name is recorded.
                fileNames: [documentName(name)],
              };
            }}
            // ⚠ No "Start over" here: Close is the way out, and it asks about what was not SAVED, which matters
            // more than what was not downloaded.
            hasWork={false}
            onStartOver={onClose}
            onError={setError}
          />
        }
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-muted/30">
          <Toolbar
            style={style}
            points={points}
            scale={scale}
            ruler={showRuler}
            onRuler={() => setShowRuler((current) => !current)}
            disabled={!ready}
            run={run}
            onDone={focusEditor}
            imageInputId={imageInputId}
          />
          <input
            id={imageInputId}
            type="file"
            accept={IMAGE_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              void insertImage(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {/* The pages scroll here; the library finds this box by its id to know which pages are in view. */}
          <div id={scrollId} className="min-h-0 flex-1 overflow-auto p-4">
            {/* ⚠ The library owns everything inside: React renders nothing in this element. */}
            <div ref={host} className="mx-auto w-max" />
            <style>{TEXT_CURSOR_CSS}</style>
            {ready ? null : <p className="text-center text-sm text-muted-foreground">Opening the editor…</p>}
          </div>
        </div>
      </StudioSplit>
      <ConfirmDialog
        open={confirmClose}
        title="Close without saving?"
        description="The changes since you last saved will be lost. Save first to keep them as a file on this computer."
        confirmLabel="Close without saving"
        alternative={{
          label: 'Save and close',
          onSelect: () => {
            save();
            setConfirmClose(false);
            onClose();
          },
        }}
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}

/**
 * How many columns the text runs in, the space between them and a line down
 * it. The gap and the line are shown only for two or three columns: with one
 * there is nothing for them to do.
 */
function ColumnFields({
  columns,
  onColumns,
}: {
  columns: StudioDocumentColumns;
  onColumns: (columns: StudioDocumentColumns) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">Columns</legend>
      {/* The studio's segmented choice, as the border controls' (`aria-pressed`). */}
      <div className="inline-flex self-start rounded-lg border border-border bg-background p-0.5">
        {STUDIO_DOCUMENT_COLUMN_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={columns.count === count}
            aria-label={count === 1 ? 'One column' : `${count} columns`}
            className={cn(
              'h-7 w-9 rounded-md text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              columns.count === count ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
            onClick={() => onColumns({ ...columns, count })}
          >
            {count}
          </button>
        ))}
      </div>
      {columns.count > 1 ? (
        <>
          <Field label="Gap between columns (mm)">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={toMm(STUDIO_DOCUMENT_COLUMN_GAP_MAX)}
                step={0.5}
                className={cn(INPUT_CLASS, 'h-9')}
                value={toMm(columns.gap)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  // An emptied box is left alone, not read as 0: the person is about to type a number.
                  if (event.target.value === '' || !Number.isFinite(value)) return;
                  onColumns({ ...columns, gap: mm(Math.round(value * 100) / 100) });
                }}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={columns.separator}
              onChange={(event) => onColumns({ ...columns, separator: event.target.checked })}
            />
            A line between the columns
          </label>
        </>
      ) : null}
    </fieldset>
  );
}

/** The four margins, in millimetres, as a person types them. */
function MarginFields({ margins, onMargins }: { margins: StudioMargins; onMargins: (margins: StudioMargins) => void }) {
  const sides = [
    { key: 'top', label: 'Top' },
    { key: 'bottom', label: 'Bottom' },
    { key: 'left', label: 'Left' },
    { key: 'right', label: 'Right' },
  ] as const;
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">Margins (mm)</legend>
      {sides.map((side) => (
        <Field key={side.key} label={side.label}>
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              max={100}
              step={0.5}
              className={cn(INPUT_CLASS, 'h-9')}
              value={toMm(margins[side.key])}
              onChange={(event) => {
                const value = Number(event.target.value);
                // An emptied box is left alone, not read as 0: the person is about to type a number.
                if (event.target.value === '' || !Number.isFinite(value)) return;
                onMargins({ ...margins, [side.key]: mm(Math.round(value * 100) / 100) });
              }}
            />
          )}
        </Field>
      ))}
    </fieldset>
  );
}

/**
 * The toolbar, laid out as Google Docs': undo, style, font, size, the text
 * buttons, colours, alignment, spacing, lists, inserts, zoom.
 *
 * ⚠ BUTTONS DO NOT TAKE THE FOCUS (`onMouseDown` prevented): a press on Bold
 * must leave the cursor in the text, or the next key typed goes nowhere.
 */
function Toolbar({
  style,
  points,
  scale,
  ruler,
  onRuler,
  disabled,
  run,
  onDone,
  imageInputId,
}: {
  style: IRangeStyle | null;
  /** The font size at the cursor, in points. */
  points: number;
  scale: number;
  /** The rulers are showing. */
  ruler: boolean;
  onRuler: () => void;
  disabled: boolean;
  run: (apply: (command: EditorCommand, lib: CanvasEditorLib) => void) => void;
  /** Give the keyboard back to the document without changing anything. */
  onDone: () => void;
  imageInputId: string;
}) {
  const font = style?.font ?? STUDIO_DEFAULT_FONT;
  const fonts: readonly string[] = STUDIO_FONTS.some((one) => one === font) ? STUDIO_FONTS : [font, ...STUDIO_FONTS];
  const level = style?.level ?? 'normal';
  const rowMargin = style?.rowMargin ?? 1;
  const spacings: readonly number[] = STUDIO_LINE_SPACINGS.some((one) => one === rowMargin)
    ? STUDIO_LINE_SPACINGS
    : [...STUDIO_LINE_SPACINGS, rowMargin].sort((a, b) => a - b);

  return (
    <div
      // The library's mark for its own controls: a press here is not a click away, so the cursor stays drawn.
      {...EDITOR_COMPONENT}
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-card px-2 py-1.5"
    >
      <ToolButton
        icon={Undo2}
        label="Undo"
        disabled={disabled || !style?.undo}
        onPress={() => run((c) => c.executeUndo())}
      />
      <ToolButton
        icon={Redo2}
        label="Redo"
        disabled={disabled || !style?.redo}
        onPress={() => run((c) => c.executeRedo())}
      />
      <Divider />
      <select
        aria-label="Text style"
        className={TOOL_SELECT_CLASS}
        disabled={disabled}
        value={level}
        onChange={(event) => {
          const key = event.target.value;
          run((c, lib) => c.executeTitle(key === 'normal' ? null : titleLevel(lib, key)));
        }}
      >
        {TEXT_STYLES.map((one) => (
          <option key={one.key} value={one.key}>
            {one.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Font"
        className={cn(TOOL_SELECT_CLASS, 'w-36')}
        disabled={disabled}
        value={font}
        onChange={(event) => {
          const next = event.target.value;
          run((c) => c.executeFont(next));
        }}
      >
        {fonts.map((one) => (
          <option key={one} value={one} style={{ fontFamily: one }}>
            {one}
          </option>
        ))}
      </select>
      <Divider />
      <ToolButton
        icon={Minus}
        label="Smaller text"
        disabled={disabled}
        onPress={() => run((c) => stepFontSize(c, points, -1))}
      />
      <FontSizeBox
        points={points}
        disabled={disabled}
        onSize={(next) => run((c) => c.executeSize(pointsToEditorPixels(next)))}
        onDone={onDone}
      />
      <ToolButton
        icon={Plus}
        label="Larger text"
        disabled={disabled}
        onPress={() => run((c) => stepFontSize(c, points, 1))}
      />
      <Divider />
      <ToolButton
        icon={Bold}
        label="Bold"
        pressed={style?.bold ?? false}
        disabled={disabled}
        onPress={() => run((c) => c.executeBold())}
      />
      <ToolButton
        icon={Italic}
        label="Italic"
        pressed={style?.italic ?? false}
        disabled={disabled}
        onPress={() => run((c) => c.executeItalic())}
      />
      <ToolButton
        icon={Underline}
        label="Underline"
        pressed={style?.underline ?? false}
        disabled={disabled}
        onPress={() => run((c) => c.executeUnderline())}
      />
      <ToolButton
        icon={Strikethrough}
        label="Strikethrough"
        pressed={style?.strikeout ?? false}
        disabled={disabled}
        onPress={() => run((c) => c.executeStrikeout())}
      />
      <ColorButton
        icon={Baseline}
        label="Text colour"
        value={style?.color ?? '#000000'}
        disabled={disabled}
        onColor={(color) => run((c) => c.executeColor(color))}
      />
      <ColorButton
        icon={Highlighter}
        label="Highlight colour"
        value={style?.highlight ?? '#ffff00'}
        disabled={disabled}
        onColor={(color) => run((c) => c.executeHighlight(color))}
      />
      <ToolButton
        icon={RemoveFormatting}
        label="Clear formatting"
        disabled={disabled}
        onPress={() => run((c) => c.executeFormat())}
      />
      <Divider />
      {(
        [
          { flex: 'left', icon: AlignLeft, label: 'Align left' },
          { flex: 'center', icon: AlignCenter, label: 'Centre' },
          { flex: 'right', icon: AlignRight, label: 'Align right' },
          { flex: 'justify', icon: AlignJustify, label: 'Justify' },
        ] as const
      ).map((one) => (
        <ToolButton
          key={one.flex}
          icon={one.icon}
          label={one.label}
          pressed={(style?.rowFlex ?? 'left') === one.flex}
          disabled={disabled}
          onPress={() => run((c, lib) => c.executeRowFlex(rowFlex(lib, one.flex)))}
        />
      ))}
      <select
        aria-label="Line spacing"
        title="Line spacing"
        className={cn(TOOL_SELECT_CLASS, 'w-16')}
        disabled={disabled}
        value={rowMargin}
        onChange={(event) => {
          const next = Number(event.target.value);
          run((c) => c.executeRowMargin(next));
        }}
      >
        {spacings.map((one) => (
          <option key={one} value={one}>
            {one}
          </option>
        ))}
      </select>
      <ToolButton
        icon={List}
        label="Bulleted list"
        pressed={style?.listType === 'ul'}
        disabled={disabled}
        onPress={() =>
          run((c, lib) =>
            style?.listType === 'ul' ? c.executeList(null) : c.executeList(lib.ListType.UL, lib.ListStyle.DISC),
          )
        }
      />
      <ToolButton
        icon={ListOrdered}
        label="Numbered list"
        pressed={style?.listType === 'ol'}
        disabled={disabled}
        onPress={() =>
          run((c, lib) =>
            style?.listType === 'ol' ? c.executeList(null) : c.executeList(lib.ListType.OL, lib.ListStyle.DECIMAL),
          )
        }
      />
      <Divider />
      {/* A label for the hidden file box: a press opens the file chooser without a script. */}
      <label
        htmlFor={imageInputId}
        title="Insert a picture"
        className={cn(TOOL_BUTTON_CLASS, 'cursor-pointer', disabled && 'pointer-events-none opacity-50')}
      >
        <ImagePlus aria-hidden="true" className="size-4" />
        <span className="sr-only">Insert a picture</span>
      </label>
      <ToolButton
        icon={Table}
        label="Insert a table (3 × 3)"
        disabled={disabled}
        onPress={() => run((c) => c.executeInsertTable(3, 3))}
      />
      <ToolButton
        icon={SeparatorHorizontal}
        label="Page break"
        disabled={disabled}
        onPress={() => run((c) => c.executePageBreak())}
      />
      <Divider />
      <ToolButton
        icon={ZoomOut}
        label="Zoom out"
        disabled={disabled}
        onPress={() => run((c) => c.executePageScaleMinus())}
      />
      <button
        type="button"
        title="Back to 100%"
        className={cn(TOOL_BUTTON_CLASS, 'w-auto px-1.5 text-xs tabular-nums')}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => run((c) => c.executePageScaleRecovery())}
      >
        {Math.round(scale * 100)}%
      </button>
      <ToolButton
        icon={ZoomIn}
        label="Zoom in"
        disabled={disabled}
        onPress={() => run((c) => c.executePageScaleAdd())}
      />
      <ToolButton icon={Ruler} label="Show the rulers" pressed={ruler} disabled={disabled} onPress={onRuler} />
    </div>
  );
}

/**
 * The attribute the editor reads, on a mousedown outside its pages, to tell its own controls from a click away
 * (`editor-component`, any value). Without it every press on the toolbar hid the cursor.
 */
const EDITOR_COMPONENT = { 'editor-component': 'menu' } as const;

/**
 * The mouse pointer over the pages: a black I-beam outlined in white, 24 px, its hot spot in the middle.
 *
 * ⚠ THE SYSTEM'S TEXT CURSOR CAN BE WHITE (the operator, 2026-10-17: "hard to see the cursor because it is
 * white"): Windows draws it in the colours of its pointer scheme, not against what is under it, and on white
 * paper it disappears. The black and white are the paper's, not the app's, so no theme token: the page is white
 * in a dark theme too, and the white edge keeps it visible over a dark background picture.
 */
const TEXT_CURSOR_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round'>" +
  "<path d='M8.5 3.5h7M8.5 20.5h7M12 3.5v17' stroke='white' stroke-width='4'/>" +
  "<path d='M8.5 3.5h7M8.5 20.5h7M12 3.5v17' stroke='black' stroke-width='1.75'/>" +
  '</svg>';
/**
 * Only while the library's own cursor on a page is `text`: it sets the pages' cursor INLINE and swaps it for
 * its other jobs (resizing a table's columns, a picture's handles, the format painter's "copy"), so `!important`
 * on every canvas would hide those. `text` after the picture is the fallback should it not load.
 */
const TEXT_CURSOR_CSS = `.ce-page-container canvas[style*="cursor: text"] { cursor: url("data:image/svg+xml,${encodeURIComponent(TEXT_CURSOR_SVG)}") 12 12, text !important; }`;

const TOOL_BUTTON_CLASS =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/15 aria-pressed:text-primary';
const TOOL_SELECT_CLASS =
  'h-8 rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function ToolButton({
  icon: Icon,
  label,
  pressed,
  disabled,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  /** For a style that is on or off at the cursor. Omitted for an action. */
  pressed?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={TOOL_BUTTON_CLASS}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}

/** A colour, chosen with the browser's own picker, under an icon underlined in the colour now in use. */
function ColorButton({
  icon: Icon,
  label,
  value,
  disabled,
  onColor,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  disabled: boolean;
  onColor: (color: string) => void;
}) {
  return (
    <label
      title={label}
      className={cn(
        TOOL_BUTTON_CLASS,
        'relative cursor-pointer flex-col gap-0',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {/* The colour itself, which no theme token can be: it is the document's, not the app's. */}
      <span aria-hidden="true" className="h-1 w-4 rounded-sm" style={{ backgroundColor: value }} />
      <span className="sr-only">{label}</span>
      <input
        type="color"
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        value={toHexColor(value)}
        disabled={disabled}
        onChange={(event) => onColor(event.target.value)}
      />
    </label>
  );
}

/**
 * The font size in points: typed, or picked from the list beside it.
 *
 * - ⚠ A TYPED SIZE IS SENT ON ENTER, never on each key (typing "18" would make
 *   the text 1 pt on the way) and never when the box is left: leaving it is
 *   usually a click on the page, which moves the cursor BEFORE the box loses
 *   the focus, so the size went to where the click landed and not to the
 *   selected words (seen 2026-10-11). Leaving without Enter puts the box back.
 * - ⚠ THE LIST IS A MENU OF ITS OWN, not a `<datalist>`: the browser filters a
 *   datalist by what is in the box, so with "11" in it the list showed only
 *   11, and read as a limit. Every size in it can be picked whatever is typed.
 */
function FontSizeBox({
  points,
  disabled,
  onSize,
  onDone,
}: {
  points: number;
  disabled: boolean;
  onSize: (points: number) => void;
  /** Give the keyboard back to the document. */
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const value = Number(draft);
    setDraft(null);
    if (!Number.isFinite(value) || value < STUDIO_FONT_SIZE_MIN || value > STUDIO_FONT_SIZE_MAX) return;
    onSize(Math.round(value * 2) / 2);
  }

  return (
    <div className="flex h-8 items-stretch overflow-hidden rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
      <input
        aria-label="Font size"
        inputMode="decimal"
        title={`Type a size from ${STUDIO_FONT_SIZE_MIN} to ${STUDIO_FONT_SIZE_MAX} and press Enter`}
        className="w-10 bg-transparent text-center text-sm tabular-nums focus-visible:outline-none disabled:opacity-50"
        disabled={disabled}
        value={draft ?? String(points)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            setDraft(null);
            onDone();
          }
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Font sizes"
            className="flex w-5 items-center justify-center border-l border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            disabled={disabled}
          >
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          // Portalled to <body>, outside the toolbar, so it needs the library's mark of its own.
          {...EDITOR_COMPONENT}
          align="start"
          className="max-h-72 min-w-16 overflow-y-auto"
          // Back to the document, not to this button: see `focusEditor`.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onDone();
          }}
        >
          {STUDIO_FONT_SIZES.map((size) => (
            <DropdownMenuItem
              key={size}
              className={cn('justify-center tabular-nums', size === points && 'font-semibold text-primary')}
              onSelect={() => onSize(size)}
            >
              {size}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The element types whose size + and − change: the library's own "text-like" list, as far as this toolbar makes them. */
const SIZED_TYPES: ReadonlySet<string> = new Set(['text', 'hyperlink', 'subscript', 'superscript', 'date']);

/**
 * + or −.
 *
 * ⚠ A SELECTION OF MIXED SIZES GROWS EACH PIECE FROM ITS OWN SIZE (the library's
 * `sizeAdd` / `sizeMinus`, 2 px a press). Setting one size for all of it, the
 * size at the selection's end plus one, made a 30 pt title next to 11 pt text
 * SHRINK to 12 on "+". One size (or only a cursor) steps through the list
 * (`nextFontSize`), so a press shows on large letters too.
 */
function stepFontSize(command: EditorCommand, points: number, direction: 1 | -1) {
  const pixels = pointsToEditorPixels(STUDIO_DEFAULT_FONT_POINTS);
  // A copy of the selection, read only. Typed here: the library's declaration of it does not reach this package.
  const selection: readonly IElement[] = command.getRangeContext()?.selectionElementList ?? [];
  const sizes = new Set(
    selection
      .filter((element) => !element.type || SIZED_TYPES.has(element.type))
      .map((element) => element.size ?? pixels),
  );
  if (sizes.size > 1) {
    if (direction === 1) command.executeSizeAdd();
    else command.executeSizeMinus();
    return;
  }
  command.executeSize(pointsToEditorPixels(nextFontSize(points, direction)));
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />;
}

/** The editor's options for a document starting on these page settings. */
function editorOptions(
  lib: CanvasEditorLib,
  setup: StudioDocumentSetup,
  ruler: boolean,
  scrollId: string,
): IEditorOption {
  const sheet = documentSheet(setup);
  return {
    ...updatableOptions(lib, setup, ruler),
    width: toEditorPixels(sheet.width),
    height: toEditorPixels(sheet.height),
    pageMode: lib.PageMode.PAGING,
    pageGap: 24,
    scrollContainerSelector: `#${scrollId}`,
  };
}

/**
 * The options that may be changed after the editor is made: ALL of the ones
 * this component sets but the page's size and layout (see the effect that
 * sends them, for why all of them).
 */
function updatableOptions(lib: CanvasEditorLib, setup: StudioDocumentSetup, ruler: boolean): UpdatableOptions {
  return {
    locale: 'en',
    defaultFont: STUDIO_DEFAULT_FONT,
    defaultSize: pointsToEditorPixels(STUDIO_DEFAULT_FONT_POINTS),
    minSize: pointsToEditorPixels(STUDIO_FONT_SIZE_MIN),
    maxSize: pointsToEditorPixels(STUDIO_FONT_SIZE_MAX),
    margins: marginPixels(setup.margins),
    background: backgroundOption(lib, setup),
    // ⚠ The library numbers every page unless told not to; Google Docs does not.
    pageNumber: { disabled: !setup.pageNumbers, font: STUDIO_DEFAULT_FONT },
    // In mm, with the margins' markers to drag. Here too, or an update of the other options would hide it.
    ruler: { disabled: !ruler },
    /*
     * Here and not by `executeSetColumns`, which sets the same option: an update of the others would otherwise
     * put back the library's one column. The library lays the text down the first column, then the next.
     */
    column: {
      count: setup.columns.count,
      gap: toEditorPixels(setup.columns.gap),
      separator: setup.columns.separator,
    },
  };
}

/**
 * The saved content, as the editor takes it, or an empty page.
 *
 * ⚠ A CAST, deliberately: the studio keeps the editor's data without reading
 * it (`StudioDocumentContent`), and the editor is what makes sense of it —
 * it skips what it does not know.
 */
function editorData(content: StudioDocumentContent | null): IEditorData {
  return (content ?? { main: [] }) as IEditorData;
}

/** The margins in the editor's order — top, right, bottom, left — and pixels. */
function marginPixels(margins: StudioMargins): [number, number, number, number] {
  return [
    toEditorPixels(margins.top),
    toEditorPixels(margins.right),
    toEditorPixels(margins.bottom),
    toEditorPixels(margins.left),
  ];
}

/** The page's background: white paper, with the picture over it when there is one. */
function backgroundOption(lib: CanvasEditorLib, setup: StudioDocumentSetup): NonNullable<IEditorOption['background']> {
  return {
    color: '#FFFFFF',
    image: setup.background ?? '',
    size: setup.backgroundFit === 'contain' ? lib.BackgroundSize.CONTAIN : lib.BackgroundSize.COVER,
    repeat: lib.BackgroundRepeat.NO_REPEAT,
  };
}

/**
 * The room for a picture, in editor pixels: one column across (the editor would squeeze a wider one into the
 * column anyway, but only after placing it), the page inside the margins down.
 */
function textRoom(setup: StudioDocumentSetup): { width: number; height: number } {
  const sheet = documentSheet(setup);
  return {
    width: toEditorPixels(documentColumnWidth(setup)),
    height: toEditorPixels(sheet.height - setup.margins.top - setup.margins.bottom),
  };
}

function titleLevel(lib: CanvasEditorLib, key: string) {
  const levels = Object.values(lib.TitleLevel);
  return levels.find((one) => one === key) ?? null;
}

function rowFlex(lib: CanvasEditorLib, flex: 'left' | 'center' | 'right' | 'justify') {
  switch (flex) {
    case 'left':
      return lib.RowFlex.LEFT;
    case 'center':
      return lib.RowFlex.CENTER;
    case 'right':
      return lib.RowFlex.RIGHT;
    case 'justify':
      return lib.RowFlex.JUSTIFY;
  }
}

/** A colour as `<input type="color">` takes it: `#rrggbb`. The editor may hold any CSS colour; others show as black. */
function toHexColor(value: string): string {
  if (/^#[0-9a-f]{6}$/iu.test(value)) return value.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return '#000000';
}
