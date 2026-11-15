/**
 * Every GraphQL document the files app sends, in one place, so
 * `apps/web-server/test/module-operations.test.ts` validates each against the
 * served schema — a renamed field fails the build, not a person's upload.
 */

const FILE_PERSON = 'userId displayName';

/** One file, as the list shows it. */
const FILE_ENTRY = `id name contentType sizeBytes ownerId ownerName mine visibility sharedWith { ${FILE_PERSON} } createdAt`;

const FILE_SETTINGS = 'retentionHours cleanupTime maxFileBytes storageBytes usedBytes';

export const FILE_OPERATIONS = {
  files: `query Files($organizationId: String!, $workspaceId: String!) {
    files(organizationId: $organizationId, workspaceId: $workspaceId) { ${FILE_ENTRY} }
  }`,
  fileSettings: `query FileSettings($organizationId: String!, $workspaceId: String!) {
    fileSettings(organizationId: $organizationId, workspaceId: $workspaceId) { ${FILE_SETTINGS} }
  }`,
  fileShareableMembers: `query FileShareableMembers($organizationId: String!, $workspaceId: String!) {
    fileShareableMembers(organizationId: $organizationId, workspaceId: $workspaceId) { ${FILE_PERSON} }
  }`,
  startFileUpload: `mutation StartFileUpload($organizationId: String!, $workspaceId: String!, $input: StartFileUploadInput!) {
    startFileUpload(organizationId: $organizationId, workspaceId: $workspaceId, input: $input) { ticket expiresAt }
  }`,
  setFileSharing: `mutation SetFileSharing($organizationId: String!, $workspaceId: String!, $fileId: String!, $visibility: String!, $sharedWith: [String!]!) {
    setFileSharing(organizationId: $organizationId, workspaceId: $workspaceId, fileId: $fileId, visibility: $visibility, sharedWith: $sharedWith) { ${FILE_ENTRY} }
  }`,
  deleteFile: `mutation DeleteFile($organizationId: String!, $workspaceId: String!, $fileId: String!) {
    deleteFile(organizationId: $organizationId, workspaceId: $workspaceId, fileId: $fileId)
  }`,
  issueFileDownload: `mutation IssueFileDownload($organizationId: String!, $workspaceId: String!, $fileId: String!) {
    issueFileDownload(organizationId: $organizationId, workspaceId: $workspaceId, fileId: $fileId)
  }`,
  setFileSettings: `mutation SetFileSettings($organizationId: String!, $workspaceId: String!, $retentionHours: Int!) {
    setFileSettings(organizationId: $organizationId, workspaceId: $workspaceId, retentionHours: $retentionHours) { ${FILE_SETTINGS} }
  }`,
  fileEvents: `subscription FileEvents($organizationId: String!, $workspaceId: String!) {
    fileEvents(organizationId: $organizationId, workspaceId: $workspaceId) { kind fileId actorId }
  }`,
} as const;
