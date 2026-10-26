/**
 * Every GraphQL document the Backups page sends. Validated against the app's
 * schema by `apps/web-server/test/module-operations.test.ts`.
 */
const FILE = 'name kind sizeBytes createdAt';
const STATE = `activity maintenance database keep timeZone files { ${FILE} }`;

export const BACKUP_OPERATIONS = {
  backups: `query Backups { backups { ${STATE} } }`,
  createBackup: `mutation CreateBackup { createBackup { ${FILE} } }`,
  deleteBackup: 'mutation DeleteBackup($name: String!) { deleteBackup(name: $name) }',
  issueBackupDownload: 'mutation IssueBackupDownload($name: String!) { issueBackupDownload(name: $name) }',
  restoreBackup: `mutation RestoreBackup($name: String!, $confirmation: String!, $password: String!) {
    restoreBackup(name: $name, confirmation: $confirmation, password: $password)
  }`,
} as const;
