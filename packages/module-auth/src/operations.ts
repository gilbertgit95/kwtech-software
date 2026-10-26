/**
 * The GraphQL documents this module's client sends, for the operations added
 * since the rule that every document lives in `src/operations.ts` (validated by
 * `apps/web-server/test/module-operations.test.ts`).
 *
 * **Legacy — do not copy:** the older documents are still written inline in
 * `react/auth-client.ts` and the settings pages, where nothing validates them.
 * They move here when that code is next worked on, not as a side effect.
 */
const DISPLAY = 'textSize spacing';

export const AUTH_OPERATIONS = {
  myDisplay: `query MyDisplay { myDisplay { ${DISPLAY} } }`,
  updateMyDisplay: `mutation UpdateMyDisplay($input: UpdateDisplayInput!) {
    updateMyDisplay(input: $input) { ${DISPLAY} }
  }`,
} as const;
