'use client';

/**
 * Drawing a PDF's pages, for the preview on the document screen (the operator,
 * 2026-10-05: "show the pdf content on the preview").
 *
 * ⚠ FOR LOOKING ONLY. The result is still made by copying the document's pages
 * untouched (`document.ts`, `pdf-lib`) — text stays text, and nothing drawn
 * here is ever printed. This file exists so a person can see WHICH pages they
 * are about to print, and how they sit on the sheet.
 *
 * ⚠ THE FILE STAYS IN THE BROWSER, like everything else. `pdfjs-dist` is
 * handed the bytes already in memory; it fetches nothing and uploads nothing.
 *
 * `pdfjs-dist` is large, so it is loaded only when a PDF is opened.
 */
export interface StudioPdfPreview {
  pageCount: number;
  /**
   * Draw one page onto a canvas, `width` pixels across. The canvas is sized
   * here. Resolves when drawn; rejects with a sentence when the page cannot be.
   * A later call for the same canvas cancels an earlier one still drawing.
   */
  drawPage(pageIndex: number, canvas: HTMLCanvasElement, width: number): Promise<void>;
  /** Let go of the document. After this, `drawPage` must not be called. */
  close(): void;
}

/** What one drawing in progress can be asked: to stop, and to say when it has. */
interface RenderTask {
  promise: Promise<unknown>;
  cancel(): void;
}

/**
 * Open a PDF for drawing.
 *
 * ## ⚠ ON THE MAIN THREAD, WITH NO WORKER FILE
 *
 * `pdfjs-dist` normally runs its parser in a web worker loaded from a URL
 * (`workerSrc`). Giving it one means either a file the APP must serve — which
 * this module may not assume — or `import.meta.url`, which this package's
 * build does not have. So the worker's code is imported like any module and
 * handed to the library through the hook it provides for exactly this
 * (`globalThis.pdfjsWorker`): it then runs in the page, with no second file.
 *
 * The cost is that a huge page parses on the main thread and can stall the
 * screen for a moment. For a preview, of pages drawn one or a few at a time,
 * that is the right trade against a deployment step somebody would forget.
 *
 * ⚠ GIVEN A COPY of the bytes: the library takes ownership of the buffer it is
 * handed and empties it, and the same bytes are needed afterwards to make the
 * result.
 */
export async function openPdfPreview(bytes: Uint8Array): Promise<StudioPdfPreview> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs')]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;

  const document = await pdfjs.getDocument({
    data: bytes.slice(),
    // No network: nothing here fetches fonts or character maps from anywhere.
    disableAutoFetch: true,
    disableStream: true,
    // A form field or a script inside a PDF is not something a preview runs.
    enableXfa: false,
    isEvalSupported: false,
  }).promise;

  /**
   * ⚠ ONE DRAWING ON A CANVAS AT A TIME, IN ORDER. The library refuses a second
   * `render()` on a canvas that is still being drawn on — and two calls can
   * arrive together (a setting changed twice, or the screen mounted twice in
   * development). So each call waits for the one before it on the same canvas
   * to stop, and only the LATEST call actually draws: an older one that has
   * been overtaken does nothing.
   */
  const turns = new WeakMap<HTMLCanvasElement, { latest: number; task: RenderTask | null; done: Promise<void> }>();
  let closed = false;

  async function draw(pageIndex: number, canvas: HTMLCanvasElement, width: number, isLatest: () => boolean) {
    if (closed || !isLatest()) return;
    const page = await document.getPage(pageIndex + 1);
    if (closed || !isLatest()) return;
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / natural.width });
    canvas.width = Math.max(Math.round(viewport.width), 1);
    canvas.height = Math.max(Math.round(viewport.height), 1);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not draw the page.');
    const task: RenderTask = page.render({ canvasContext: context, viewport });
    const turn = turns.get(canvas);
    if (turn) turn.task = task;
    try {
      await task.promise;
    } catch (caught) {
      // Cancelled for a newer drawing: not a failure, and nothing to say.
      if (isCancelled(caught)) return;
      throw new Error('This page could not be shown. It will still print as it is.');
    } finally {
      if (turn && turn.task === task) turn.task = null;
    }
  }

  return {
    pageCount: document.numPages,
    drawPage(pageIndex, canvas, width) {
      const before = turns.get(canvas);
      const mine = (before?.latest ?? 0) + 1;
      // Whatever is being drawn there is stale now: stop it rather than wait for it to finish.
      before?.task?.cancel();
      const waited = before ? before.done.catch(() => undefined) : Promise.resolve();
      const done = waited.then(() => draw(pageIndex, canvas, width, () => turns.get(canvas)?.latest === mine));
      turns.set(canvas, { latest: mine, task: null, done });
      return done;
    },
    close() {
      closed = true;
      void document.loadingTask.destroy();
    },
  };
}

function isCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'RenderingCancelledException'
  );
}
