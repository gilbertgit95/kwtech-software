import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * The agent's settings, checked once. A bad value stops the start with one
 * line, before anything connects.
 *
 * ⚠ NO SECRET IS READ FROM HERE. The agent's one secret is issued by the
 * server at pairing and kept in the state folder (`../state.ts`); a setting
 * would be copied between computers and into backups.
 */

/** Empty is absent: a template line left blank must not become an empty value. */
const optionalText = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

/** Printers Windows adds itself that put nothing on paper. Reported nowhere unless the setting says otherwise. */
export const DEFAULT_EXCLUDED_PRINTERS: readonly string[] = [
  'Microsoft Print to PDF',
  'Microsoft XPS Document Writer',
  'Fax',
  'OneNote (Desktop)',
  'OneNote for Windows 10',
  'Send To OneNote 16',
  'Send To OneNote 2016',
];

const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Whether a URL may carry the agent's secret.
 *
 * ⚠ TLS EVERYWHERE BUT THIS COMPUTER. The secret is a standing credential
 * sent on every connection; over `http://` or `ws://` to another machine,
 * anybody on the network between reads it. Refusing to start is the only
 * place this can be enforced: a warning is a line in a log nobody reads.
 */
export function isSafeServerUrl(value: string, secure: 'https:' | 'wss:', plain: 'http:' | 'ws:'): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === secure) return true;
  return url.protocol === plain && LOCAL_HOSTS.includes(url.hostname);
}

/**
 * Whether the two URLs name one server: the same host and the same port.
 *
 * ⚠ THE SECRET IS ISSUED THROUGH `API_URL` AND PRESENTED TO `WS_URL`. If the
 * two could differ, a mistyped or pasted `WS_URL` would hand this computer's
 * credential to whatever answers there, and `stateMatchesServer` (`../state.ts`),
 * which compares `API_URL`, would never notice. One server serves both, so
 * they are required to agree and the start is refused when they do not.
 */
export function isSameServer(apiUrl: string, wsUrl: string): boolean {
  try {
    const api = new URL(apiUrl);
    const ws = new URL(wsUrl);
    // `port` is empty for a scheme's own default, so https://x and wss://x agree, as do http://x:8080 and ws://x:8080.
    return api.hostname === ws.hostname && api.port === ws.port;
  } catch {
    return false;
  }
}

const schema = z.object({
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  API_URL: z.string().refine((value) => isSafeServerUrl(value, 'https:', 'http:'), {
    message: 'must be an https:// URL (http:// only for localhost)',
  }),
  WS_URL: z.string().refine((value) => isSafeServerUrl(value, 'wss:', 'ws:'), {
    message: 'must be a wss:// URL (ws:// only for localhost)',
  }),
  PRINT_AGENT_STATE_DIR: optionalText,
  PRINT_AGENT_EXCLUDE_PRINTERS: optionalText,
  PRINT_AGENT_DRIVER: optionalText.pipe(z.enum(['windows', 'fake']).optional()),
  PRINT_AGENT_SUMATRA_PATH: optionalText,
});

export interface AgentEnv {
  appEnv: 'local' | 'staging' | 'production';
  apiUrl: string;
  wsUrl: string;
  stateDir: string;
  /** Exact printer names never reported. */
  excludedPrinters: readonly string[];
  driver: 'windows' | 'fake';
  /** Another SumatraPDF than the one the printing library carries. Undefined: the carried one. */
  sumatraPath: string | undefined;
}

/** `a, b ,c` as names. `none` is the written way to exclude nothing. */
export function parseExcludedPrinters(value: string | undefined): readonly string[] {
  if (value === undefined) return DEFAULT_EXCLUDED_PRINTERS;
  if (value.toLowerCase() === 'none') return [];
  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export function defaultStateDir(platform: NodeJS.Platform, variables: NodeJS.ProcessEnv): string {
  const appData = variables.APPDATA;
  if (platform === 'win32' && appData) return join(appData, 'kwtech-print-agent');
  return join(homedir(), '.config', 'kwtech-print-agent');
}

/**
 * The settings from these variables, or a thrown error naming each bad one.
 * Takes the variables and the platform in, so a test never touches the real ones.
 */
export function parseEnv(variables: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): AgentEnv {
  const parsed = schema.safeParse(variables);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`The print agent's settings are not valid — ${problems}. See .env.example.`);
  }
  const values = parsed.data;
  if (!isSameServer(values.API_URL, values.WS_URL)) {
    throw new Error(
      "The print agent's settings are not valid — WS_URL: must be on the same host and port as API_URL, because the secret API_URL issued is sent there. See .env.example.",
    );
  }
  return {
    appEnv: values.APP_ENV,
    apiUrl: values.API_URL.replace(/\/+$/, ''),
    wsUrl: values.WS_URL,
    stateDir: values.PRINT_AGENT_STATE_DIR ?? defaultStateDir(platform, variables),
    excludedPrinters: parseExcludedPrinters(values.PRINT_AGENT_EXCLUDE_PRINTERS),
    // ⚠ Anywhere but Windows there is no spooler this agent can ask, so it says so by being fake rather than failing.
    driver: values.PRINT_AGENT_DRIVER ?? (platform === 'win32' ? 'windows' : 'fake'),
    sumatraPath: values.PRINT_AGENT_SUMATRA_PATH,
  };
}

/**
 * Where the settings file is looked for: the folder the agent is run in, then
 * the folder the program itself is in.
 *
 * ⚠ THE SECOND IS FOR A COMPUTER THAT STARTS THE AGENT BY ITSELF. A startup
 * task or a service runs it from a system folder, where there is no `.env`,
 * and the agent would stop saying API_URL is missing with nobody watching.
 */
export function settingsDirectories(
  cwd: string = process.cwd(),
  program: string | undefined = process.argv[1],
): string[] {
  const directories = [cwd];
  if (program && dirname(program) !== cwd) directories.push(dirname(program));
  return directories;
}

/**
 * Read `.env.local`, else `.env`, from the first folder that has one, then
 * check the result. Variables already set win over the file's, as they do in
 * the two apps, so a service manager can set one without editing a file.
 */
export function loadEnv(directories: readonly string[] = settingsDirectories()): AgentEnv {
  for (const file of directories.flatMap((directory) => [join(directory, '.env.local'), join(directory, '.env')])) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      break;
    }
  }
  return parseEnv(process.env);
}
