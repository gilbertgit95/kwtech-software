/**
 * EVERY GRAPHQL DOCUMENT A CLIENT SENDS TO BILLING, in the pure root so the
 * pages (phases 6 and 7) import them and `apps/web-server/test/module-operations.test.ts`
 * validates each against the served schema. A document that drifted from the
 * schema fails that test, not a customer's Billing page.
 */

const LINE = 'kind amount days';

const BILL = `id number status total currency issuedAt planLabel fromPlanLabel lines { ${LINE} } cancelledAt cancelledReason
  issuerName issuerDetails issuedOn periodStart periodEnd`;

const REQUEST = `
  id organizationId kind state planKey fromPlanKey requestedById requestedAt
  detailsVersion coveredOn holdDays holdReason
  decidedById decidedAt decisionReason selfApproved approverIsMember
  periodStart periodEnd accessUntil voidedById voidedAt voidReason
  bill { ${BILL} }
  bills { ${BILL} }
  receipts {
    id number amount currency method kind reference issuedAt voidedAt voidReason
    title notice billNumber planLabel paidOn periodStart periodEnd issuerName issuerDetails issuedOn
  }
  payments { version method amount paidOn reference sender note enteredById enteredAt }
  events { id at step reason actorId data }
`;

const FLAGS = 'referenceUsedOn amount amountDifference missingDetails holdInForce selfRequest viewerIsMember';

const SETTINGS = `currency timeZone graceDays issuerName issuerDetails paymentAccounts { method label details } locked`;

export const PLATFORM_BILLING_OPERATIONS = {
  // ── the organization (organization scope) ──
  overview: /* GraphQL */ `
    query PlatformBillingOverview($organizationId: String!) {
      platformBillingOverview(organizationId: $organizationId) {
        organizationId organizationName today timeZone currency creditBalance
        standing { kind days planKey planLabel planArchived cancelled trial periodStart periodEnd accessUntil graceDays holdDays prepaid }
        pending { ${REQUEST} }
        plans { key label monthly isPublic archived current }
        paymentAccounts { method label details }
      }
    }
  `,
  preview: /* GraphQL */ `
    query PlatformBillingPreview($organizationId: String!, $kind: String!, $planKey: String) {
      platformBillingPreview(organizationId: $organizationId, kind: $kind, planKey: $planKey) {
        kind planKey allowed refusal message nextStep
        quote { lines { ${LINE} } total creditUsed creditAdded direction billAtSubmission periodStart periodEnd }
        overruns { limit have allowed remove }
      }
    }
  `,
  history: /* GraphQL */ `
    query PlatformBillingHistory(
      $organizationId: String!, $cursor: String, $limit: Int, $year: Int, $state: String, $hideClosed: Boolean
    ) {
      platformBillingHistory(
        organizationId: $organizationId, cursor: $cursor, limit: $limit, year: $year, state: $state, hideClosed: $hideClosed
      ) {
        items { ${REQUEST} }
        nextCursor
        totals { requests paidInYear }
      }
    }
  `,
  statement: /* GraphQL */ `
    query PlatformBillingStatement($organizationId: String!, $from: String!, $to: String!) {
      platformBillingStatement(organizationId: $organizationId, from: $from, to: $to) {
        from to currency openingCredit closingCredit billed paid
        entries { id at day kind number detail note billed paid credit creditBalance }
      }
    }
  `,
  request: /* GraphQL */ `
    query PlatformBillingRequest($organizationId: String!, $requestId: String!) {
      platformBillingRequest(organizationId: $organizationId, requestId: $requestId) { ${REQUEST} }
    }
  `,
  requestPlan: /* GraphQL */ `
    mutation RequestPlatformBillingPlan($organizationId: String!, $kind: String!, $planKey: String!) {
      requestPlatformBillingPlan(organizationId: $organizationId, kind: $kind, planKey: $planKey) { ${REQUEST} }
    }
  `,
  renew: /* GraphQL */ `
    mutation RenewPlatformBilling($organizationId: String!) {
      renewPlatformBilling(organizationId: $organizationId) { ${REQUEST} }
    }
  `,
  cancel: /* GraphQL */ `
    mutation CancelPlatformBilling($organizationId: String!) {
      cancelPlatformBilling(organizationId: $organizationId) { ${REQUEST} }
    }
  `,
  enterPayment: /* GraphQL */ `
    mutation EnterPlatformBillingPayment($organizationId: String!, $requestId: String!, $payment: PlatformBillingPaymentInput!) {
      enterPlatformBillingPayment(organizationId: $organizationId, requestId: $requestId, payment: $payment) { ${REQUEST} }
    }
  `,
  withdraw: /* GraphQL */ `
    mutation WithdrawPlatformBillingRequest($organizationId: String!, $requestId: String!, $reason: String) {
      withdrawPlatformBillingRequest(organizationId: $organizationId, requestId: $requestId, reason: $reason) { ${REQUEST} }
    }
  `,

  // ── the platform (app level) ──
  queue: /* GraphQL */ `
    query PlatformBillingQueue($cursor: String, $limit: Int) {
      platformBillingQueue(cursor: $cursor, limit: $limit) {
        items { request { ${REQUEST} } organizationName flags { ${FLAGS} } }
        nextCursor
      }
    }
  `,
  decided: /* GraphQL */ `
    query PlatformBillingDecided($cursor: String, $limit: Int) {
      platformBillingDecided(cursor: $cursor, limit: $limit) {
        items { request { ${REQUEST} } organizationName flags { ${FLAGS} } }
        nextCursor
      }
    }
  `,
  planList: /* GraphQL */ `
    query PlatformBillingPlanList {
      platformBillingPlanList { key label isPublic archived monthly }
    }
  `,
  review: /* GraphQL */ `
    query PlatformBillingReview($requestId: String!) {
      platformBillingReview(requestId: $requestId) { request { ${REQUEST} } organizationName flags { ${FLAGS} } }
    }
  `,
  settings: /* GraphQL */ `
    query PlatformBillingSettings {
      platformBillingSettings { ${SETTINGS} }
    }
  `,
  prices: /* GraphQL */ `
    query PlatformBillingPrices {
      platformBillingPrices { planKey monthly effectiveFrom }
    }
  `,
  approve: /* GraphQL */ `
    mutation ApprovePlatformBillingRequest($requestId: String!, $approval: PlatformBillingApprovalInput!) {
      approvePlatformBillingRequest(requestId: $requestId, approval: $approval) { ${REQUEST} }
    }
  `,
  reject: /* GraphQL */ `
    mutation RejectPlatformBillingRequest($requestId: String!, $reason: String!) {
      rejectPlatformBillingRequest(requestId: $requestId, reason: $reason) { ${REQUEST} }
    }
  `,
  closeAsCredit: /* GraphQL */ `
    mutation ClosePlatformBillingRequestAsCredit($requestId: String!, $payment: PlatformBillingApprovalInput!, $reason: String) {
      closePlatformBillingRequestAsCredit(requestId: $requestId, payment: $payment, reason: $reason) { ${REQUEST} }
    }
  `,
  void: /* GraphQL */ `
    mutation VoidPlatformBillingRequest($requestId: String!, $reason: String!) {
      voidPlatformBillingRequest(requestId: $requestId, reason: $reason) { ${REQUEST} }
    }
  `,
  setSettings: /* GraphQL */ `
    mutation SetPlatformBillingSettings($settings: PlatformBillingSettingsInput!) {
      setPlatformBillingSettings(settings: $settings) { ${SETTINGS} }
    }
  `,
  setPrice: /* GraphQL */ `
    mutation SetPlatformBillingPrice($planKey: String!, $monthly: Int!, $effectiveFrom: String!) {
      setPlatformBillingPrice(planKey: $planKey, monthly: $monthly, effectiveFrom: $effectiveFrom) { planKey monthly effectiveFrom }
    }
  `,
} as const;
