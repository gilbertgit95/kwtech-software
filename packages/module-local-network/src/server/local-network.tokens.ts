/** The resolved options (`local-network.options.ts`). Bound only while the switch is on. */
export const LOCAL_NETWORK_OPTIONS = 'kwtech:local-network-options';

/**
 * How the service opens a file, as `(path) => Promise<string>`. ⚠ Unbound, it
 * is `node:fs/promises` `readFile` (utf8). A seam for the test that proves the
 * private keys beside `root.crt` are never opened, not a port the app binds.
 */
export const LOCAL_NETWORK_READ_FILE = 'kwtech:local-network-read-file';
