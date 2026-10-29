/**
 * The GraphQL documents this module's client sends, for the operations added
 * since the rule that every document lives in `src/operations.ts` (validated by
 * `apps/web-server/test/module-operations.test.ts`).
 *
 * **Legacy — do not copy:** the older documents are still written inline in
 * `react/auth-client.ts` and the settings pages, where nothing validates them.
 * They move here when that code is next worked on, not as a side effect.
 */
const DISPLAY = 'textSize spacing source';

export const AUTH_OPERATIONS = {
  /**
   * `$layout`: `desktop` (omitted) or `mobile` — the full site's sizes and the
   * phone layout's are kept apart. `$device`: this device's own sizes when it
   * has them, else the account's.
   */
  myDisplay: `query MyDisplay($layout: String, $device: String) {
    myDisplay(layout: $layout, device: $device) { ${DISPLAY} }
  }`,
  updateMyDisplay: `mutation UpdateMyDisplay($input: UpdateDisplayInput!) {
    updateMyDisplay(input: $input) { ${DISPLAY} }
  }`,
  forgetMyDeviceDisplay: `mutation ForgetMyDeviceDisplay($layout: String!, $device: String!) {
    forgetMyDeviceDisplay(layout: $layout, device: $device) { ${DISPLAY} }
  }`,
} as const;
