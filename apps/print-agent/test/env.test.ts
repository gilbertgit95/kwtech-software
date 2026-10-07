import {
  DEFAULT_EXCLUDED_PRINTERS,
  isSafeServerUrl,
  isSameServer,
  parseEnv,
  parseExcludedPrinters,
  settingsDirectories,
} from '../src/config/env.js';

const LOCAL = { API_URL: 'http://localhost:8080/api/v1/', WS_URL: 'ws://localhost:8080/api/v1/graphql' };

describe('the agent’s settings', () => {
  it('need only the two URLs, and fill in the rest', () => {
    const env = parseEnv({ ...LOCAL, APPDATA: 'C:\\Users\\shop\\AppData\\Roaming' }, 'win32');
    expect(env).toMatchObject({
      appEnv: 'local',
      apiUrl: 'http://localhost:8080/api/v1',
      wsUrl: LOCAL.WS_URL,
      driver: 'windows',
      excludedPrinters: DEFAULT_EXCLUDED_PRINTERS,
    });
    expect(env.stateDir).toContain('kwtech-print-agent');
    expect(env.stateDir.startsWith('C:\\Users\\shop\\AppData\\Roaming')).toBe(true);
  });

  it('⚠ are fake printers anywhere but Windows — there is no spooler to ask', () => {
    expect(parseEnv(LOCAL, 'linux').driver).toBe('fake');
    expect(parseEnv({ ...LOCAL, PRINT_AGENT_DRIVER: 'fake' }, 'win32').driver).toBe('fake');
  });

  it('treat a blank line in the file as absent', () => {
    const env = parseEnv(
      { ...LOCAL, PRINT_AGENT_STATE_DIR: '  ', PRINT_AGENT_EXCLUDE_PRINTERS: '', PRINT_AGENT_DRIVER: '' },
      'linux',
    );
    expect(env.excludedPrinters).toBe(DEFAULT_EXCLUDED_PRINTERS);
    expect(env.driver).toBe('fake');
  });

  it('name every bad value in one line', () => {
    expect(() => parseEnv({ API_URL: 'nope', WS_URL: 'ws://example.com/graphql' }, 'linux')).toThrow(
      /API_URL.*WS_URL|WS_URL.*API_URL/s,
    );
    expect(() => parseEnv({}, 'linux')).toThrow(/API_URL/);
    expect(() => parseEnv({ ...LOCAL, PRINT_AGENT_DRIVER: 'cups' }, 'linux')).toThrow(/PRINT_AGENT_DRIVER/);
  });
});

describe('a server URL', () => {
  it('⚠ may be plain only on this computer: the secret crosses it on every connection', () => {
    expect(isSafeServerUrl('https://api.example.com/api/v1', 'https:', 'http:')).toBe(true);
    expect(isSafeServerUrl('http://localhost:8080/api/v1', 'https:', 'http:')).toBe(true);
    expect(isSafeServerUrl('http://127.0.0.1:8080', 'https:', 'http:')).toBe(true);
    expect(isSafeServerUrl('http://192.168.1.10:8080/api/v1', 'https:', 'http:')).toBe(false);
    expect(isSafeServerUrl('http://api.example.com', 'https:', 'http:')).toBe(false);
    expect(isSafeServerUrl('http://localhost.evil.example', 'https:', 'http:')).toBe(false);
    expect(isSafeServerUrl('ws://example.com/graphql', 'wss:', 'ws:')).toBe(false);
    expect(isSafeServerUrl('wss://example.com/graphql', 'wss:', 'ws:')).toBe(true);
    expect(isSafeServerUrl('ftp://localhost', 'https:', 'http:')).toBe(false);
  });
});

describe('the two URLs', () => {
  it('⚠ must name one server: the secret one issues is sent to the other', () => {
    expect(isSameServer('http://localhost:8080/api/v1', 'ws://localhost:8080/api/v1/graphql')).toBe(true);
    expect(isSameServer('https://api.example.com/api/v1', 'wss://api.example.com/api/v1/graphql')).toBe(true);
    expect(isSameServer('https://api.example.com/api/v1', 'wss://api.examp1e.com/api/v1/graphql')).toBe(false);
    expect(isSameServer('http://localhost:8080/api/v1', 'ws://localhost:8081/graphql')).toBe(false);
    expect(isSameServer('https://api.example.com', 'wss://api.example.com:8443/graphql')).toBe(false);
    expect(isSameServer('nope', 'wss://api.example.com/graphql')).toBe(false);
  });

  it('⚠ stop the start when they disagree, naming WS_URL', () => {
    expect(() =>
      parseEnv({ API_URL: 'https://api.example.com/api/v1', WS_URL: 'wss://elsewhere.example/graphql' }, 'linux'),
    ).toThrow(/WS_URL.*same host and port/);
  });
});

describe('the settings file', () => {
  it('is looked for where the agent is run, then beside the program — a startup task runs it from a system folder', () => {
    expect(settingsDirectories('/shop', '/opt/agent/print-agent.mjs')).toEqual(['/shop', '/opt/agent']);
    expect(settingsDirectories('/opt/agent', '/opt/agent/print-agent.mjs')).toEqual(['/opt/agent']);
  });
});

describe('the excluded printers', () => {
  it('default to the ones Windows adds itself, and “none” reports everything', () => {
    expect(parseExcludedPrinters(undefined)).toContain('Microsoft Print to PDF');
    expect(parseExcludedPrinters('none')).toEqual([]);
    expect(parseExcludedPrinters(' Fax , EPSON L5290 Series (Fax),, ')).toEqual(['Fax', 'EPSON L5290 Series (Fax)']);
  });
});
