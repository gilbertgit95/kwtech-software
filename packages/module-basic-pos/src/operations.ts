/**
 * Every GraphQL document this module sends, as data.
 *
 * A document is the ONE part of a typed client that nothing typechecks: a
 * renamed field or a moved argument is a runtime refusal on a screen. Lifted out
 * here, the host hands every one of them to `graphql`'s own validator against
 * the schema it serves — `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them never resolves React to read a string.
 */

const CATEGORY = 'id name sortOrder archivedAt';
const VARIANT = 'id itemId name code price cost sortOrder archivedAt';
const ITEM = `id kind name code price cost categoryId archivedAt variants { ${VARIANT} }`;
const CUSTOMER = 'id name contact note archivedAt';
const SETTINGS = 'timeZone keymap version';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const POS_OPERATIONS = {
  // ── the catalogue ─────────────────────────────────────────────────────────

  /** What a till loads once and searches in the browser. Costs only for those who may see them. */
  posCatalogue: `query PosCatalogue(${SCOPE_VARS}, $includeArchived: Boolean) {
    posCatalogue(${SCOPE_ARGS}, includeArchived: $includeArchived) {
      categories { ${CATEGORY} } items { ${ITEM} } costsVisible
    }
  }`,

  savePosItem: `mutation SavePosItem(${SCOPE_VARS}, $input: SavePosItemInput!) {
    savePosItem(${SCOPE_ARGS}, input: $input) { ${ITEM} }
  }`,

  setPosItemArchived: `mutation SetPosItemArchived(${SCOPE_VARS}, $itemId: String!, $archived: Boolean!) {
    setPosItemArchived(${SCOPE_ARGS}, itemId: $itemId, archived: $archived) { ${ITEM} }
  }`,

  savePosCategory: `mutation SavePosCategory(${SCOPE_VARS}, $name: String!, $categoryId: String, $sortOrder: Int) {
    savePosCategory(${SCOPE_ARGS}, name: $name, categoryId: $categoryId, sortOrder: $sortOrder) { ${CATEGORY} }
  }`,

  setPosCategoryArchived: `mutation SetPosCategoryArchived(${SCOPE_VARS}, $categoryId: String!, $archived: Boolean!) {
    setPosCategoryArchived(${SCOPE_ARGS}, categoryId: $categoryId, archived: $archived) { ${CATEGORY} }
  }`,

  // ── customers ─────────────────────────────────────────────────────────────

  posCustomers: `query PosCustomers(${SCOPE_VARS}, $search: String, $includeArchived: Boolean) {
    posCustomers(${SCOPE_ARGS}, search: $search, includeArchived: $includeArchived) { ${CUSTOMER} }
  }`,

  posCustomer: `query PosCustomer(${SCOPE_VARS}, $customerId: String!) {
    posCustomer(${SCOPE_ARGS}, customerId: $customerId) { ${CUSTOMER} }
  }`,

  savePosCustomer: `mutation SavePosCustomer(${SCOPE_VARS}, $input: SavePosCustomerInput!) {
    savePosCustomer(${SCOPE_ARGS}, input: $input) { ${CUSTOMER} }
  }`,

  setPosCustomerArchived: `mutation SetPosCustomerArchived(${SCOPE_VARS}, $customerId: String!, $archived: Boolean!) {
    setPosCustomerArchived(${SCOPE_ARGS}, customerId: $customerId, archived: $archived) { ${CUSTOMER} }
  }`,

  // ── settings ──────────────────────────────────────────────────────────────

  posSettings: `query PosSettings(${SCOPE_VARS}) {
    posSettings(${SCOPE_ARGS}) { ${SETTINGS} }
  }`,

  savePosSettings: `mutation SavePosSettings(${SCOPE_VARS}, $timeZone: String!, $keymap: String) {
    savePosSettings(${SCOPE_ARGS}, timeZone: $timeZone, keymap: $keymap) { ${SETTINGS} }
  }`,

  // ── live ──────────────────────────────────────────────────────────────────

  posEvents: `subscription PosEvents(${SCOPE_VARS}) {
    posEvents(${SCOPE_ARGS}) { kind orderId actorId }
  }`,
} as const;
