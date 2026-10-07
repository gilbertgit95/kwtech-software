import { createPrintRelayRouteHandlers } from '@kwtech/module-print/next';

/**
 * Where the browser hands a print job's file to the server.
 *
 * The file belongs to no page of this app: the Printers page (and, later, the
 * print studio) opens a job through GraphQL, is given a one-time ticket, and
 * sends the file here with it. The handler behind this — which passes the
 * body on as a stream and forwards nothing but that ticket — lives in
 * `@kwtech/module-print/next`. This file is the cost of Next discovering
 * route handlers from the filesystem, as `api/auth/[...action]` is.
 *
 * It reads `API_URL` from the environment at each request, as the auth
 * handler does, and answers 503 when it is not set rather than guess.
 *
 * ⚠ NO SESSION HERE, and `src/proxy.ts` is kept off this path: the ticket is
 * the authorisation, and a proxy reading the request would cut a large file
 * short.
 */
export const { PUT } = createPrintRelayRouteHandlers();
