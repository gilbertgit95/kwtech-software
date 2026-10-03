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
const ITEM = `id kind name code description price cost categoryId archivedAt variants { ${VARIANT} }`;
const CUSTOMER = 'id name phone email facebookUrl note archivedAt';
const SETTINGS = 'timeZone keymap version';
const DISCOUNT = 'kind value reason givenById givenAt';
const LINE = `id itemId variantId name kind variantName code categoryName unitPrice unitCost quantity note discount { ${DISCOUNT} } discountAmount gross total net refundedQuantity`;
const ORDER = `id status version number label customerId customerName customerContact lines { ${LINE} } gross lineDiscounts subtotal discount { ${DISCOUNT} } orderDiscount total paymentMethod received change tip paymentReference changeOwed changeSettlement changeSettledAt refunds { id amount method reason refundedById refundedAt } refunded refundState createdById createdAt finalisedAt finalisedById releasedUnpaid paidAt paidById cancelledAt cancelReason voidedAt voidReason`;
const ORDER_SUMMARY =
  'id status version number label customerName itemCount total changeOwed refunded createdAt finalisedAt finalisedById paidAt cancelReason';
const COUNT = 'count amount';
const SUMMARY = `orders gross discounts refunds netSales averageOrder tips cash ewallet card cashExpected profit costCoverage unpaidReleased { ${COUNT} } unpaidCollected { ${COUNT} } changeOwedOutstanding { ${COUNT} } cancelled { ${COUNT} }`;
const BREAKDOWN = 'key label quantity net cost profit';
const OWED = 'orderId number customerName amount since';
const ORDER_VARS = '$orderId: String!, $version: Int!';
const ORDER_ARGS = 'orderId: $orderId, version: $version';
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

  savePosSettings: `mutation SavePosSettings(${SCOPE_VARS}, $keymap: String) {
    savePosSettings(${SCOPE_ARGS}, keymap: $keymap) { ${SETTINGS} }
  }`,

  // ── orders: reading ───────────────────────────────────────────────────────

  /** One tab of the Orders section: today, pending, unpaid, change_owed, cancelled or all. `customerId`: one customer's. */
  posOrders: `query PosOrders(${SCOPE_VARS}, $tab: String!, $search: String, $customerId: String) {
    posOrders(${SCOPE_ARGS}, tab: $tab, search: $search, customerId: $customerId) { ${ORDER_SUMMARY} }
  }`,

  posOrder: `query PosOrder(${SCOPE_VARS}, $orderId: String!) {
    posOrder(${SCOPE_ARGS}, orderId: $orderId) { ${ORDER} }
  }`,

  // ── orders: selling ───────────────────────────────────────────────────────

  createPosOrder: `mutation CreatePosOrder(${SCOPE_VARS}, $label: String) {
    createPosOrder(${SCOPE_ARGS}, label: $label) { ${ORDER} }
  }`,

  addPosOrderLine: `mutation AddPosOrderLine(${SCOPE_VARS}, ${ORDER_VARS}, $itemId: String!, $variantId: String, $quantity: Int!) {
    addPosOrderLine(${SCOPE_ARGS}, ${ORDER_ARGS}, itemId: $itemId, variantId: $variantId, quantity: $quantity) { ${ORDER} }
  }`,

  updatePosOrderLine: `mutation UpdatePosOrderLine(${SCOPE_VARS}, ${ORDER_VARS}, $lineId: String!, $quantity: Int, $note: String) {
    updatePosOrderLine(${SCOPE_ARGS}, ${ORDER_ARGS}, lineId: $lineId, quantity: $quantity, note: $note) { ${ORDER} }
  }`,

  removePosOrderLine: `mutation RemovePosOrderLine(${SCOPE_VARS}, ${ORDER_VARS}, $lineId: String!) {
    removePosOrderLine(${SCOPE_ARGS}, ${ORDER_ARGS}, lineId: $lineId) { ${ORDER} }
  }`,

  refreshPosOrderLine: `mutation RefreshPosOrderLine(${SCOPE_VARS}, ${ORDER_VARS}, $lineId: String!) {
    refreshPosOrderLine(${SCOPE_ARGS}, ${ORDER_ARGS}, lineId: $lineId) { ${ORDER} }
  }`,

  setPosOrderCustomer: `mutation SetPosOrderCustomer(${SCOPE_VARS}, ${ORDER_VARS}, $customerId: String, $name: String, $contact: String) {
    setPosOrderCustomer(${SCOPE_ARGS}, ${ORDER_ARGS}, customerId: $customerId, name: $name, contact: $contact) { ${ORDER} }
  }`,

  setPosOrderLabel: `mutation SetPosOrderLabel(${SCOPE_VARS}, ${ORDER_VARS}, $label: String) {
    setPosOrderLabel(${SCOPE_ARGS}, ${ORDER_ARGS}, label: $label) { ${ORDER} }
  }`,

  holdPosOrder: `mutation HoldPosOrder(${SCOPE_VARS}, ${ORDER_VARS}, $label: String) {
    holdPosOrder(${SCOPE_ARGS}, ${ORDER_ARGS}, label: $label) { ${ORDER} }
  }`,

  payPosOrder: `mutation PayPosOrder(${SCOPE_VARS}, ${ORDER_VARS}, $input: PayPosOrderInput!) {
    payPosOrder(${SCOPE_ARGS}, ${ORDER_ARGS}, input: $input) { ${ORDER} }
  }`,

  payLaterPosOrder: `mutation PayLaterPosOrder(${SCOPE_VARS}, ${ORDER_VARS}) {
    payLaterPosOrder(${SCOPE_ARGS}, ${ORDER_ARGS}) { ${ORDER} }
  }`,

  cancelPosOrder: `mutation CancelPosOrder(${SCOPE_VARS}, ${ORDER_VARS}, $reason: String) {
    cancelPosOrder(${SCOPE_ARGS}, ${ORDER_ARGS}, reason: $reason) { ${ORDER} }
  }`,

  settlePosChangeOwed: `mutation SettlePosChangeOwed(${SCOPE_VARS}, ${ORDER_VARS}, $settlement: String!) {
    settlePosChangeOwed(${SCOPE_ARGS}, ${ORDER_ARGS}, settlement: $settlement) { ${ORDER} }
  }`,

  // ── discounts ─────────────────────────────────────────────────────────────

  setPosLineDiscount: `mutation SetPosLineDiscount(${SCOPE_VARS}, ${ORDER_VARS}, $lineId: String!, $discount: PosDiscountInput) {
    setPosLineDiscount(${SCOPE_ARGS}, ${ORDER_ARGS}, lineId: $lineId, discount: $discount) { ${ORDER} }
  }`,

  setPosOrderDiscount: `mutation SetPosOrderDiscount(${SCOPE_VARS}, ${ORDER_VARS}, $discount: PosDiscountInput) {
    setPosOrderDiscount(${SCOPE_ARGS}, ${ORDER_ARGS}, discount: $discount) { ${ORDER} }
  }`,

  // ── refunds and voids ─────────────────────────────────────────────────────

  refundPosOrder: `mutation RefundPosOrder(${SCOPE_VARS}, $orderId: String!, $input: RefundPosOrderInput!) {
    refundPosOrder(${SCOPE_ARGS}, orderId: $orderId, input: $input) { ${ORDER} }
  }`,

  voidPosOrder: `mutation VoidPosOrder(${SCOPE_VARS}, ${ORDER_VARS}, $reason: String!) {
    voidPosOrder(${SCOPE_ARGS}, ${ORDER_ARGS}, reason: $reason) { ${ORDER} }
  }`,

  // ── reports ───────────────────────────────────────────────────────────────

  posReport: `query PosReport(${SCOPE_VARS}, $fromDay: String!, $toDay: String!) {
    posReport(${SCOPE_ARGS}, fromDay: $fromDay, toDay: $toDay) {
      fromDay toDay timeZone summary { ${SUMMARY} } previous { ${SUMMARY} } previousFromDay previousToDay granularity
      series { key orders sales refunds } previousSeries { key orders sales refunds }
      byItem { ${BREAKDOWN} } byCategory { ${BREAKDOWN} } byStaff { ${BREAKDOWN} }
      byHour { hour orders sales } unpaid { ${OWED} } changeOwed { ${OWED} } truncated
    }
  }`,

  // ── live ──────────────────────────────────────────────────────────────────

  posEvents: `subscription PosEvents(${SCOPE_VARS}) {
    posEvents(${SCOPE_ARGS}) { kind orderId actorId }
  }`,
} as const;
