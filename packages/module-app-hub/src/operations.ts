/**
 * Every GraphQL document this module sends, as data.
 *
 * A document is the ONE part of a typed client that nothing typechecks, so the
 * host validates each of these against the schema it serves —
 * `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them never resolves React to read a string.
 *
 * A layout travels as a JSON STRING. The schema has no JSON scalar, and the
 * server re-validates every field anyway (`validateLayout`), so a typed input
 * object would be a second description of the same shape to keep in step.
 */

const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const APP_HUB_OPERATIONS = {
  appHubLayouts: `query AppHubLayouts(${SCOPE_VARS}) {
    appHubLayouts(${SCOPE_ARGS}) { mine workspace }
  }`,

  saveMyAppHubLayout: `mutation SaveMyAppHubLayout(${SCOPE_VARS}, $layout: String!) {
    saveMyAppHubLayout(${SCOPE_ARGS}, layout: $layout)
  }`,

  resetMyAppHubLayout: `mutation ResetMyAppHubLayout(${SCOPE_VARS}) {
    resetMyAppHubLayout(${SCOPE_ARGS})
  }`,

  /** ⚠ Bound to `app_hub:layout_manage`. */
  saveWorkspaceAppHubLayout: `mutation SaveWorkspaceAppHubLayout(${SCOPE_VARS}, $layout: String!) {
    saveWorkspaceAppHubLayout(${SCOPE_ARGS}, layout: $layout)
  }`,

  /** ⚠ Bound to `app_hub:layout_manage`. */
  resetWorkspaceAppHubLayout: `mutation ResetWorkspaceAppHubLayout(${SCOPE_VARS}) {
    resetWorkspaceAppHubLayout(${SCOPE_ARGS})
  }`,
} as const;
