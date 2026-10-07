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

const SPEC = `spec {
      version
      paper { key label width height }
      orientation
      margins { top right bottom left }
      cells { x y width height label }
      guides
      border { style width color }
      sizing
    }`;
const LAYOUT = `id name visibility tag version mine ownerId ownerName updatedAt createdAt ${SPEC}`;
const CALIBRATION = 'id name scaleX scaleY offsetX offsetY updatedAt';
const LOG =
  'id action kind userId userName mine layoutId layoutName paperLabel paperWidth paperHeight pages copies fileNames createdAt';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const STUDIO_OPERATIONS = {
  /** Your own layouts and the ones shared with the workspace, yours first. */
  studioLayouts: `query StudioLayouts(${SCOPE_VARS}) {
    studioLayouts(${SCOPE_ARGS}) { ${LAYOUT} }
  }`,

  /** Null for a layout that does not exist and for one that is not shared with you alike. */
  studioLayout: `query StudioLayout(${SCOPE_VARS}, $layoutId: String!) {
    studioLayout(${SCOPE_ARGS}, layoutId: $layoutId) { ${LAYOUT} }
  }`,

  /** Your own calibration profiles here. Nobody else's. */
  studioCalibrations: `query StudioCalibrations(${SCOPE_VARS}) {
    studioCalibrations(${SCOPE_ARGS}) { ${CALIBRATION} }
  }`,

  /** Print history, newest first. `everyone` needs `studio:manage_all`; without it you see your own. */
  studioLog: `query StudioLog(${SCOPE_VARS}, $everyone: Boolean, $cursor: String, $limit: Int) {
    studioLog(${SCOPE_ARGS}, everyone: $everyone, cursor: $cursor, limit: $limit) {
      entries { ${LOG} }
      nextCursor
      everyone
    }
  }`,

  /** The workspace's settings. `keymap` is a `StudioKeymap` as JSON text. Every screen reads it. */
  studioSettings: `query StudioSettings(${SCOPE_VARS}) {
    studioSettings(${SCOPE_ARGS}) { keymap version }
  }`,

  /** Omit `keymap` to put every key back to its default. */
  saveStudioSettings: `mutation SaveStudioSettings(${SCOPE_VARS}, $keymap: String) {
    saveStudioSettings(${SCOPE_ARGS}, keymap: $keymap) { keymap version }
  }`,

  createStudioLayout: `mutation CreateStudioLayout(${SCOPE_VARS}, $input: CreateStudioLayoutInput!) {
    createStudioLayout(${SCOPE_ARGS}, input: $input) { ${LAYOUT} }
  }`,

  /** ⚠ Send only what changed, and the version it was changed from. */
  updateStudioLayout: `mutation UpdateStudioLayout(${SCOPE_VARS}, $layoutId: String!, $expectedVersion: Int!, $input: UpdateStudioLayoutInput!) {
    updateStudioLayout(${SCOPE_ARGS}, layoutId: $layoutId, expectedVersion: $expectedVersion, input: $input) { ${LAYOUT} }
  }`,

  setStudioLayoutVisibility: `mutation SetStudioLayoutVisibility(${SCOPE_VARS}, $layoutId: String!, $visibility: String!) {
    setStudioLayoutVisibility(${SCOPE_ARGS}, layoutId: $layoutId, visibility: $visibility) { ${LAYOUT} }
  }`,

  /** A private copy of a layout you can see, owned by you. */
  duplicateStudioLayout: `mutation DuplicateStudioLayout(${SCOPE_VARS}, $layoutId: String!, $name: String) {
    duplicateStudioLayout(${SCOPE_ARGS}, layoutId: $layoutId, name: $name) { ${LAYOUT} }
  }`,

  deleteStudioLayout: `mutation DeleteStudioLayout(${SCOPE_VARS}, $layoutId: String!) {
    deleteStudioLayout(${SCOPE_ARGS}, layoutId: $layoutId)
  }`,

  /** Omit `id` in the input to create a profile; give it to change one of your own. */
  saveStudioCalibration: `mutation SaveStudioCalibration(${SCOPE_VARS}, $input: StudioCalibrationInput!) {
    saveStudioCalibration(${SCOPE_ARGS}, input: $input) { ${CALIBRATION} }
  }`,

  deleteStudioCalibration: `mutation DeleteStudioCalibration(${SCOPE_VARS}, $calibrationId: String!) {
    deleteStudioCalibration(${SCOPE_ARGS}, calibrationId: $calibrationId)
  }`,

  /** Called by the studio when a result is downloaded or sent to the browser's print dialog. */
  recordStudioPrint: `mutation RecordStudioPrint(${SCOPE_VARS}, $input: StudioPrintInput!) {
    recordStudioPrint(${SCOPE_ARGS}, input: $input)
  }`,
} as const;
