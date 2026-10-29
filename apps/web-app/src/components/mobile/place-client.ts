'use client';

import type { MobilePlace } from '@/components/mobile/mobile-top-bar';

const GRAPHQL_PATH = '/api/auth/graphql';

/**
 * The workspaces of ONE organization the viewer may enter, for the switcher
 * sheet after somebody taps an organization (issue #22).
 *
 * Asked only then, never on every page: the page already carries the current
 * organization's list, and loading every organization's on each render would
 * be a request per organization for a sheet that is mostly never opened.
 *
 * `myWorkspaces` answers about the caller only and returns an empty list for
 * an organization they have no standing in, so the id selects a question and
 * asserts nothing. The same query `getNavContext` reads on the server.
 */
export async function fetchMobileWorkspaces(organizationId: string): Promise<MobilePlace[]> {
  const response = await fetch(GRAPHQL_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      query: `query MobileWorkspaces($organizationId: String!) {
        myWorkspaces(organizationId: $organizationId) { id name roleLabel }
      }`,
      variables: { organizationId },
    }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Cannot reach the server.');

  const body = (await response.json()) as {
    data?: { myWorkspaces: { id: string; name: string; roleLabel: string | null }[] | null };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'Could not load the workspaces.');
  return (body.data?.myWorkspaces ?? []).map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    detail: workspace.roleLabel,
  }));
}
