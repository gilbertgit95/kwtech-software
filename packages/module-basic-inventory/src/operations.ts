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

const ITEM = 'id kind name code unit unitCost lowStockAt categoryId archivedAt onHand level value usedBy';
const CATEGORY = 'id name sortOrder archivedAt';
const USE = 'id refKind refId refItemId refLabel stockItemId quantityPerUnit';
const OVERVIEW = `items { ${ITEM} } categories { ${CATEGORY} } uses { ${USE} } totalValue unvalued hasSource`;
const MOVE =
  'id stockItemId kind quantity unitCost reason note supplier reference sourceKey wasteRefLabel takeId createdById createdByName createdAt';
const TAKE = `id status categoryIds note createdById createdByName createdAt closedAt lines { stockItemId counted onHand difference }`;
const SOURCE_ITEM = 'itemId variantId itemName variantName kind code archived label';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const STOCK_OPERATIONS = {
  // ── reading ───────────────────────────────────────────────────────────────

  /** Every item with on hand and value, the categories, and every materials-list line. */
  stockItems: `query StockItems(${SCOPE_VARS}, $includeArchived: Boolean) {
    stockItems(${SCOPE_ARGS}, includeArchived: $includeArchived) { ${OVERVIEW} }
  }`,

  stockItem: `query StockItem(${SCOPE_VARS}, $stockItemId: String!) {
    stockItem(${SCOPE_ARGS}, stockItemId: $stockItemId) { ${ITEM} }
  }`,

  /** One item's history, newest first; pass `nextCursor` back for older. */
  stockMoves: `query StockMoves(${SCOPE_VARS}, $stockItemId: String!, $cursor: String) {
    stockMoves(${SCOPE_ARGS}, stockItemId: $stockItemId, cursor: $cursor) { moves { ${MOVE} } nextCursor }
  }`,

  /** The point of sale's items and variants, to pick what a list hangs on. */
  stockSourceItems: `query StockSourceItems(${SCOPE_VARS}) {
    stockSourceItems(${SCOPE_ARGS}) { ${SOURCE_ITEM} }
  }`,

  stockTakes: `query StockTakes(${SCOPE_VARS}) {
    stockTakes(${SCOPE_ARGS}) { ${TAKE} }
  }`,

  stockTake: `query StockTake(${SCOPE_VARS}, $takeId: String!) {
    stockTake(${SCOPE_ARGS}, takeId: $takeId) { ${TAKE} }
  }`,

  // ── receiving, adjusting, waste ───────────────────────────────────────────

  receiveStock: `mutation ReceiveStock(${SCOPE_VARS}, $input: ReceiveStockInput!) {
    receiveStock(${SCOPE_ARGS}, input: $input) { ${MOVE} }
  }`,

  adjustStock: `mutation AdjustStock(${SCOPE_VARS}, $input: AdjustStockInput!) {
    adjustStock(${SCOPE_ARGS}, input: $input) { ${MOVE} }
  }`,

  recordStockWaste: `mutation RecordStockWaste(${SCOPE_VARS}, $input: RecordStockWasteInput!) {
    recordStockWaste(${SCOPE_ARGS}, input: $input) { ${MOVE} }
  }`,

  // ── items, categories, lists ──────────────────────────────────────────────

  saveStockItem: `mutation SaveStockItem(${SCOPE_VARS}, $input: SaveStockItemInput!) {
    saveStockItem(${SCOPE_ARGS}, input: $input) { ${ITEM} }
  }`,

  setStockItemArchived: `mutation SetStockItemArchived(${SCOPE_VARS}, $stockItemId: String!, $archived: Boolean!) {
    setStockItemArchived(${SCOPE_ARGS}, stockItemId: $stockItemId, archived: $archived) { ${ITEM} }
  }`,

  saveStockCategory: `mutation SaveStockCategory(${SCOPE_VARS}, $name: String!, $categoryId: String, $sortOrder: Int) {
    saveStockCategory(${SCOPE_ARGS}, name: $name, categoryId: $categoryId, sortOrder: $sortOrder) { ${CATEGORY} }
  }`,

  setStockCategoryArchived: `mutation SetStockCategoryArchived(${SCOPE_VARS}, $categoryId: String!, $archived: Boolean!) {
    setStockCategoryArchived(${SCOPE_ARGS}, categoryId: $categoryId, archived: $archived) { ${CATEGORY} }
  }`,

  setStockUses: `mutation SetStockUses(${SCOPE_VARS}, $refKind: String!, $refId: String!, $refItemId: String!, $lines: [StockUseLineInput!]!) {
    setStockUses(${SCOPE_ARGS}, refKind: $refKind, refId: $refId, refItemId: $refItemId, lines: $lines) { ${USE} }
  }`,

  createStockFromSource: `mutation CreateStockFromSource(${SCOPE_VARS}, $picks: [StockSourcePickInput!]!) {
    createStockFromSource(${SCOPE_ARGS}, picks: $picks) { ${OVERVIEW} }
  }`,

  // ── stock takes ───────────────────────────────────────────────────────────

  startStockTake: `mutation StartStockTake(${SCOPE_VARS}, $categoryIds: [String!]!, $note: String) {
    startStockTake(${SCOPE_ARGS}, categoryIds: $categoryIds, note: $note) { ${TAKE} }
  }`,

  saveStockTakeCounts: `mutation SaveStockTakeCounts(${SCOPE_VARS}, $takeId: String!, $counts: [StockTakeCountInput!]!) {
    saveStockTakeCounts(${SCOPE_ARGS}, takeId: $takeId, counts: $counts) { ${TAKE} }
  }`,

  confirmStockTake: `mutation ConfirmStockTake(${SCOPE_VARS}, $takeId: String!) {
    confirmStockTake(${SCOPE_ARGS}, takeId: $takeId) { ${TAKE} }
  }`,

  abandonStockTake: `mutation AbandonStockTake(${SCOPE_VARS}, $takeId: String!) {
    abandonStockTake(${SCOPE_ARGS}, takeId: $takeId) { ${TAKE} }
  }`,

  // ── live ──────────────────────────────────────────────────────────────────

  stockEvents: `subscription StockEvents(${SCOPE_VARS}) {
    stockEvents(${SCOPE_ARGS}) { kind actorId }
  }`,
} as const;
