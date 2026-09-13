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

const TICKET = 'id lineId label number cycle status windowId windowName calledAt recallCount';
const LINE = 'id name prefix startNumber endNumber padTo sortOrder archived';
const WINDOW = 'id name sortOrder archived lineIds';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const QUEUE_OPERATIONS = {
  queueConsole: `query QueueConsole(${SCOPE_VARS}) {
    queueConsole(${SCOPE_ARGS}) {
      settings { enabled showStaffNames }
      session { id startedAt startedById continuedNumbering codeLocked }
      lines { ${LINE} }
      windows { ${WINDOW} }
      seats { windowId userId displayName canServe nickname }
      myUserId
      myWindowId
      myNickname
      serving { ${TICKET} }
      recent { ${TICKET} }
    }
  }`,

  /** ⚠ Bound to `queue:start`: the code, and the link and QR built from it. */
  queueDisplayCode: `query QueueDisplayCode(${SCOPE_VARS}) {
    queueDisplayCode(${SCOPE_ARGS}) { code activeDisplays maxDisplays failedCodeAttempts locked displayPath }
  }`,

  queueStaffCandidates: `query QueueStaffCandidates(${SCOPE_VARS}) {
    queueStaffCandidates(${SCOPE_ARGS}) { userId displayName }
  }`,

  /**
   * The console's stream. `sync` arrives first on every (re)subscribe and the
   * console re-reads on it; every other event is also answered with a re-read,
   * so the screen never computes queue state of its own.
   */
  queueEvents: `subscription QueueEvents(${SCOPE_VARS}) {
    queueEvents(${SCOPE_ARGS}) { kind change ticket { ${TICKET} } }
  }`,

  startQueue: `mutation StartQueue(${SCOPE_VARS}, $continueNumbering: Boolean) {
    startQueue(${SCOPE_ARGS}, continueNumbering: $continueNumbering) { id }
  }`,

  stopQueue: `mutation StopQueue(${SCOPE_VARS}) { stopQueue(${SCOPE_ARGS}) }`,

  setQueueShowStaffNames: `mutation SetQueueShowStaffNames(${SCOPE_VARS}, $show: Boolean!) {
    setQueueShowStaffNames(${SCOPE_ARGS}, show: $show) { enabled showStaffNames }
  }`,

  callNextQueueTicket: `mutation CallNextQueueTicket(${SCOPE_VARS}, $lineId: String!, $clientRequestId: String) {
    callNextQueueTicket(${SCOPE_ARGS}, lineId: $lineId, clientRequestId: $clientRequestId) { ${TICKET} }
  }`,

  callQueueNumber: `mutation CallQueueNumber(${SCOPE_VARS}, $lineId: String!, $number: Int!) {
    callQueueNumber(${SCOPE_ARGS}, lineId: $lineId, number: $number) { ${TICKET} }
  }`,

  recallQueueTicket: `mutation RecallQueueTicket(${SCOPE_VARS}, $ticketId: String!) {
    recallQueueTicket(${SCOPE_ARGS}, ticketId: $ticketId) { ${TICKET} }
  }`,

  completeQueueTicket: `mutation CompleteQueueTicket(${SCOPE_VARS}, $ticketId: String!) {
    completeQueueTicket(${SCOPE_ARGS}, ticketId: $ticketId) { ${TICKET} }
  }`,

  markQueueTicketNoShow: `mutation MarkQueueTicketNoShow(${SCOPE_VARS}, $ticketId: String!) {
    markQueueTicketNoShow(${SCOPE_ARGS}, ticketId: $ticketId) { ${TICKET} }
  }`,

  assignQueueWindow: `mutation AssignQueueWindow(${SCOPE_VARS}, $windowId: String!, $userId: String!, $confirmReplace: Boolean) {
    assignQueueWindow(${SCOPE_ARGS}, windowId: $windowId, userId: $userId, confirmReplace: $confirmReplace) { windowId userId }
  }`,

  freeQueueWindow: `mutation FreeQueueWindow(${SCOPE_VARS}, $windowId: String!) {
    freeQueueWindow(${SCOPE_ARGS}, windowId: $windowId)
  }`,

  releaseMyQueueSeat: `mutation ReleaseMyQueueSeat(${SCOPE_VARS}) { releaseMyQueueSeat(${SCOPE_ARGS}) }`,

  createQueueWindow: `mutation CreateQueueWindow(${SCOPE_VARS}, $name: String!) {
    createQueueWindow(${SCOPE_ARGS}, name: $name) { ${WINDOW} }
  }`,

  updateQueueWindow: `mutation UpdateQueueWindow(${SCOPE_VARS}, $windowId: String!, $name: String, $sortOrder: Int) {
    updateQueueWindow(${SCOPE_ARGS}, windowId: $windowId, name: $name, sortOrder: $sortOrder) { ${WINDOW} }
  }`,

  setQueueWindowLines: `mutation SetQueueWindowLines(${SCOPE_VARS}, $windowId: String!, $lineIds: [String!]!) {
    setQueueWindowLines(${SCOPE_ARGS}, windowId: $windowId, lineIds: $lineIds) { ${WINDOW} }
  }`,

  setQueueWindowArchived: `mutation SetQueueWindowArchived(${SCOPE_VARS}, $windowId: String!, $archived: Boolean!) {
    setQueueWindowArchived(${SCOPE_ARGS}, windowId: $windowId, archived: $archived) { ${WINDOW} }
  }`,

  createQueueLine: `mutation CreateQueueLine(${SCOPE_VARS}, $name: String!, $prefix: String!, $startNumber: Int, $endNumber: Int, $padTo: Int) {
    createQueueLine(${SCOPE_ARGS}, name: $name, prefix: $prefix, startNumber: $startNumber, endNumber: $endNumber, padTo: $padTo) { ${LINE} }
  }`,

  updateQueueLine: `mutation UpdateQueueLine(${SCOPE_VARS}, $lineId: String!, $name: String, $startNumber: Int, $endNumber: Int, $padTo: Int, $sortOrder: Int) {
    updateQueueLine(${SCOPE_ARGS}, lineId: $lineId, name: $name, startNumber: $startNumber, endNumber: $endNumber, padTo: $padTo, sortOrder: $sortOrder) { ${LINE} }
  }`,

  setQueueLineArchived: `mutation SetQueueLineArchived(${SCOPE_VARS}, $lineId: String!, $archived: Boolean!) {
    setQueueLineArchived(${SCOPE_ARGS}, lineId: $lineId, archived: $archived) { ${LINE} }
  }`,

  setQueueLineNextNumber: `mutation SetQueueLineNextNumber(${SCOPE_VARS}, $lineId: String!, $next: Int!) {
    setQueueLineNextNumber(${SCOPE_ARGS}, lineId: $lineId, next: $next)
  }`,

  setMyQueueNickname: `mutation SetMyQueueNickname(${SCOPE_VARS}, $nickname: String!) {
    setMyQueueNickname(${SCOPE_ARGS}, nickname: $nickname)
  }`,

  clearMyQueueNickname: `mutation ClearMyQueueNickname(${SCOPE_VARS}) { clearMyQueueNickname(${SCOPE_ARGS}) }`,

  clearQueueNickname: `mutation ClearQueueNickname(${SCOPE_VARS}, $userId: String!) {
    clearQueueNickname(${SCOPE_ARGS}, userId: $userId)
  }`,

  /** The public page's exchange (step 8). Listed now so the schema check covers it. */
  openQueueDisplay: `mutation OpenQueueDisplay($organizationKey: String!, $workspaceKey: String!, $code: String!) {
    openQueueDisplay(organizationKey: $organizationKey, workspaceKey: $workspaceKey, code: $code) { pass workspaceName }
  }`,

  /** The board, on a socket admitted by a display pass (step 8). */
  queueDisplay: `subscription QueueDisplay {
    queueDisplay {
      kind
      board {
        showStaffNames
        lines { id prefix name }
        serving { ticketId lineId label windowId windowName calledAt recallCount nickname }
        recent { ticketId lineId label windowId windowName calledAt recallCount nickname }
      }
      announce { ticketId lineId label windowId windowName calledAt recallCount nickname }
    }
  }`,
} as const;
