/**
 * `pdfjs-dist` ships its worker as a module with no types of its own. The
 * studio imports it for one export, to run the library on the main thread —
 * see `pdf-preview.ts`.
 */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
