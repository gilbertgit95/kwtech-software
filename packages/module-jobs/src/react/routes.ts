/**
 * Where the admin page lives. A constant in its own file so the route and any
 * link to it agree without a cycle through `module.tsx`.
 *
 * ⚠ UNDER `/admin`, with no organization or workspace in the path: the page is
 * APP level, and the catch-all asks its key at app level because of it.
 */
export const JOBS_ADMIN_HREF = '/admin/processes';
