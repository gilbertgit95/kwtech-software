import { createFileUploadRouteHandlers } from '@kwtech/module-file-manager/next';

/**
 * Where the browser sends an uploaded file's bytes (the Files app, issue #138).
 *
 * The Files app asks `startFileUpload` (GraphQL) for a one-time ticket, then
 * sends the file here with it. The handler behind this — which passes the body
 * on as a stream and forwards nothing but that ticket — lives in
 * `@kwtech/module-file-manager/next`. This file is the cost of Next
 * discovering route handlers from the filesystem, as `api/print/...` is.
 *
 * ⚠ NO SESSION HERE, and `src/proxy.ts` is kept off `/api/files`: the ticket
 * is the authorisation, and a proxy reading the request would cut a large file
 * short.
 */
export const { PUT } = createFileUploadRouteHandlers();
