/**
 * The upload and download handshakes, shared by the API's routes and the web
 * app's (`/next`) — module-backup's and module-print's shape.
 *
 * A file is not a GraphQL value: through GraphQL it would cross as text, a
 * third larger and whole in the server's memory. So the guarded mutation
 * DECIDES (may this person upload this, download that) and hands out a
 * one-time ticket, and a plain HTTP route only spends it, as a stream.
 */

/** The header the upload's ticket travels in. */
export const FILE_UPLOAD_TICKET_HEADER = 'x-file-upload-ticket';
/** The header the download's ticket travels in. */
export const FILE_DOWNLOAD_TICKET_HEADER = 'x-file-download-ticket';

/** The web app's routes the browser uses. */
export const FILE_UPLOAD_PATH = '/api/files/upload';
export const FILE_DOWNLOAD_PATH = '/api/files/download';

/** The API's routes, under its own prefix (`/api/v1`). */
export const FILE_API_UPLOAD_PATH = '/files/upload';
export const FILE_API_DOWNLOAD_PATH = '/files/download';

/** The browser's download address for one ticket. */
export function fileDownloadHref(ticket: string): string {
  return `${FILE_DOWNLOAD_PATH}?ticket=${encodeURIComponent(ticket)}`;
}

/** 32 random bytes as base64url: 43 characters of `[A-Za-z0-9_-]`. Anything else is not worth a request. */
export function isFileTicketShaped(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

/**
 * The `content-disposition` of a download: always an ATTACHMENT, never shown
 * in the page's origin, with the name twice — plain ASCII for old clients and
 * RFC 5987 UTF-8 for the rest.
 *
 * ⚠ The ASCII half drops quotes, backslashes and anything outside printable
 * ASCII, so no name can end the header's quoted string or add a header.
 */
export function fileContentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/gu, '_').trim() || 'file';
  const encoded = encodeURIComponent(name).replace(/['()*]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** A storage key: 16 random bytes as hex, the only name a file has on disk. A store refuses anything else. */
export function isFileStorageKey(value: string): boolean {
  return /^[a-f0-9]{32}$/u.test(value);
}
