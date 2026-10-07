/**
 * Every GraphQL document this module's clients send, as data — the web app's
 * AND the print agent's.
 *
 * A document is the ONE part of a typed client that nothing typechecks: a
 * renamed field or a moved argument is a runtime refusal on a screen, or on a
 * computer in a shop. Lifted out here, the host hands every one of them to
 * `graphql`'s own validator against the schema it serves —
 * `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them, and an agent with no React, read only strings.
 */

const PAPER = 'name width height margins { top right bottom left }';
const OPTION = 'id label';
const PRINTER = `id name driver isDefault status gone papers { ${PAPER} } mediaTypes { ${OPTION} } mediaType qualities { ${OPTION} } quality`;
const AGENT = `id name hostName agentVersion online lastSeenAt pairedAt printers { ${PRINTER} }`;
const JOB = 'id status failure message';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const PRINT_OPERATIONS = {
  // ── a person, signed in ────────────────────────────────────────────────────

  /** The workspace's paired computers, by name, each with its printers. Revoked ones are left out. */
  printAgents: `query PrintAgents(${SCOPE_VARS}) {
    printAgents(${SCOPE_ARGS}) { ${AGENT} }
  }`,

  /** A one-time code for one computer. ⚠ The code is in THIS answer and nowhere else, ever. */
  createPrintPairingCode: `mutation CreatePrintPairingCode(${SCOPE_VARS}, $name: String!) {
    createPrintPairingCode(${SCOPE_ARGS}, name: $name) { code expiresAt }
  }`,

  revokePrintAgent: `mutation RevokePrintAgent(${SCOPE_VARS}, $agentId: String!) {
    revokePrintAgent(${SCOPE_ARGS}, agentId: $agentId)
  }`,

  /**
   * Open a job for one printer. ⚠ The answer's ticket is what lets THIS browser
   * send the file, once, to `printJobContentPath(jobId)`; it is nowhere else.
   */
  startPrintJob: `mutation StartPrintJob(${SCOPE_VARS}, $printerId: String!, $paperName: String, $copies: Int!, $size: Int!, $mediaType: String, $quality: String) {
    startPrintJob(${SCOPE_ARGS}, printerId: $printerId, paperName: $paperName, copies: $copies, size: $size, mediaType: $mediaType, quality: $quality) { jobId ticket }
  }`,

  /** How a job is going. Null once it is forgotten, or for somebody else's. */
  printJob: `query PrintJob(${SCOPE_VARS}, $jobId: String!) {
    printJob(${SCOPE_ARGS}, jobId: $jobId) { ${JOB} }
  }`,

  // ── a computer, with no session ────────────────────────────────────────────

  /** Over HTTP. Null for EVERY failure: wrong, used, expired, or the workspace is full. */
  pairPrintAgent: `mutation PairPrintAgent($code: String!, $hostName: String, $agentVersion: String) {
    pairPrintAgent(code: $code, hostName: $hostName, agentVersion: $agentVersion) { secret agentId name }
  }`,

  /** Over the socket the secret opened. Says "still here"; false means revoked, and final. */
  printAgentHeartbeat: `mutation PrintAgentHeartbeat {
    printAgentHeartbeat
  }`,

  /** Over the socket. Everything the computer has installed, each time it starts or the list changes. */
  reportPrintAgentPrinters: `mutation ReportPrintAgentPrinters($printers: [PrintReportedPrinterInput!]!) {
    reportPrintAgentPrinters(printers: $printers)
  }`,

  /** Over the socket. The jobs for this computer, as each is opened; ones already waiting come first. */
  printAgentJobs: `subscription PrintAgentJobs {
    printAgentJobs { jobId printerName paper { ${PAPER} } copies size mediaType quality }
  }`,

  /** Over the socket. How the printing of one job went. */
  reportPrintAgentJob: `mutation ReportPrintAgentJob($jobId: String!, $printed: Boolean!, $message: String) {
    reportPrintAgentJob(jobId: $jobId, printed: $printed, message: $message)
  }`,
} as const;
