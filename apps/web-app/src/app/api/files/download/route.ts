import { createFileDownloadRouteHandlers } from '@kwtech/module-file-manager/next';

/**
 * Where the browser downloads a file (the Files app, issue #138), with the
 * one-time ticket `issueFileDownload` gave it in `?ticket=`. Passed on from
 * the API as a stream, always as an attachment.
 *
 * ⚠ NO SESSION HERE: the ticket is the authorisation. `src/proxy.ts` is kept
 * off `/api/files`.
 */
export const { GET } = createFileDownloadRouteHandlers();
