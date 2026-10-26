/**
 * `pnpm https:setup` — turns on HTTPS for the shop's network on THIS machine,
 * doing every step a script can (README.md, "HTTPS on the local network"):
 *
 *   pnpm https:setup                          detect the address, ask, set it up
 *   pnpm https:setup --address=192.168.1.186  that address, no detection
 *   pnpm https:setup --yes                    no questions (the first address found)
 *   pnpm https:setup --off                    back to plain http://localhost
 *
 * What it does:
 *   1. finds this machine's address on the network (or takes --address);
 *   2. checks Caddy is installed, and prints this system's install command if not;
 *   3. on Linux, lets Caddy use ports 80 and 443 without root (`setcap`, asks
 *      for the sudo password once);
 *   4. writes the three settings into the ACTIVE profile (`pnpm env:show`):
 *      FRONTEND_URL and CORS_ORIGINS for the API, NEXT_PUBLIC_WS_URL for the
 *      web app — and nothing else in either file;
 *   5. checks the Caddyfile with that address;
 *   6. says what is left: the rebuild, the start, and each phone.
 *
 * What it cannot do, and says so: install Caddy (system software), reserve the
 * address on the router, Windows' own settings for WSL, and trusting the
 * certificate on each phone — a phone deliberately asks a person for that.
 *
 * Run it again whenever the address changes (another network, a new router).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces, platform } from 'node:os';
import { relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const { caddyLaunch, REPO } = createRequire(import.meta.url)('../deploy/https/host.cjs');

const SERVER_ENV = resolve(REPO, 'apps/web-server/.env.local');
const WEB_ENV = resolve(REPO, 'apps/web-app/.env.local');
/** The dev server's own address, kept allowed beside the HTTPS one so `pnpm dev` on localhost still works. */
const LOCAL_WEB = 'http://localhost:8081';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

function fail(message, ...more) {
  console.error(`  ✗ ${message}`);
  for (const line of more) console.error(`    ${line}`);
  process.exit(1);
}

function step(message) {
  console.log(`  ▸ ${message}`);
}

function done(message) {
  console.log(`  ✓ ${message}`);
}

// ── the profile ──────────────────────────────────────────────────────────

/** The profile file a `.env.local` link points at, so the edit lands in the profile itself. */
function profileFile(link) {
  if (!existsSync(link)) fail(`${relative(REPO, link)} is missing.`, 'Activate a profile first: pnpm env:use local');
  return realpathSync(link);
}

/**
 * Sets one variable in an env file: its line replaced, or added at the end.
 * ⚠ Only the named keys are touched; no other line is read back or printed,
 * because the same files hold the secrets.
 */
function setVariable(text, key, value) {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, 'm');
  const active = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (active.test(text)) return text.replace(active, line);
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.replace(/\n*$/u, '\n')}${line}\n`;
}

function removeVariable(text, key) {
  return text.replace(new RegExp(`^\\s*${key}\\s*=.*\\n?`, 'm'), '');
}

function currentValue(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\n]*)`, 'm'));
  return match ? match[1] : null;
}

function writeSettings(settings) {
  for (const { file, set, remove } of settings) {
    const path = profileFile(file);
    let text = readFileSync(path, 'utf8');
    for (const [key, value] of Object.entries(set)) {
      const before = currentValue(text, key);
      text = setVariable(text, key, value);
      done(`${key}="${value}"${before && before !== value ? `  (was "${before}")` : ''}`);
    }
    for (const key of remove ?? []) {
      if (currentValue(text, key) !== null) {
        text = removeVariable(text, key);
        done(`${key} removed`);
      }
    }
    writeFileSync(path, text);
  }
}

// ── the address ──────────────────────────────────────────────────────────

/** This machine's IPv4 addresses on a private network, Wi-Fi and Ethernet first. */
function networkAddresses() {
  const found = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(entry.address)) continue;
      // Docker's, WSL's and VPN bridges are not where a phone can reach this machine.
      if (/^(docker|br-|veth|vEthernet|utun|tailscale|zt)/u.test(name)) continue;
      found.push({ name, address: entry.address });
    }
  }
  return found;
}

async function chooseAddress() {
  const given = option('address');
  if (given) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/u.test(given)) fail(`--address=${given} is not an IPv4 address.`);
    return given;
  }
  const found = networkAddresses();
  if (found.length === 0) {
    fail('No address on a local network was found.', 'Connect to the Wi-Fi, or pass --address=192.168.x.x.');
  }
  for (const [index, entry] of found.entries()) console.log(`    ${index + 1}. ${entry.address}  (${entry.name})`);
  if (flag('yes') || found.length === 1) {
    if (!flag('yes')) await confirm(`Use ${found[0].address}?`);
    return found[0].address;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('  Which one do phones reach this machine at? [1] ');
  prompt.close();
  const picked = found[(Number.parseInt(answer, 10) || 1) - 1];
  if (!picked) fail('Not one of the addresses listed.');
  return picked.address;
}

async function confirm(question) {
  if (flag('yes')) return;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question(`  ${question} [Y/n] `)).trim().toLowerCase();
  prompt.close();
  if (answer === 'n' || answer === 'no') fail('Stopped. Nothing was changed.');
}

// ── Caddy ────────────────────────────────────────────────────────────────

function isWsl() {
  try {
    return /microsoft/iu.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function caddyVersion() {
  const result = spawnSync('caddy', ['version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function installHint() {
  if (platform() === 'darwin') return ['brew install caddy'];
  if (platform() === 'linux') {
    return [
      "Caddy's apt repository, then the package (caddyserver.com/docs/install#debian-ubuntu-raspbian):",
      'sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl',
      "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg",
      "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list",
      'sudo apt update && sudo apt install caddy',
      'sudo systemctl disable --now caddy    # pm2 runs it, not the system service',
    ];
  }
  return ['See caddyserver.com/docs/install'];
}

/** Linux keeps ports below 1024 for root; this lets the Caddy binary use 80 and 443 as any user. */
function allowLowPorts() {
  if (platform() !== 'linux') return;
  const path = spawnSync('sh', ['-c', 'command -v caddy'], { encoding: 'utf8' }).stdout.trim();
  const caps = spawnSync('getcap', [path], { encoding: 'utf8' }).stdout ?? '';
  if (caps.includes('cap_net_bind_service')) {
    done('Caddy may use ports 80 and 443');
    return;
  }
  step('Letting Caddy use ports 80 and 443 (sudo asks for your password)');
  const result = spawnSync('sudo', ['setcap', 'cap_net_bind_service=+ep', realpathSync(path)], { stdio: 'inherit' });
  if (result.status !== 0)
    fail('setcap did not work.', `Run it yourself: sudo setcap cap_net_bind_service=+ep ${path}`);
  done('Caddy may use ports 80 and 443');
}

function validateCaddyfile(address) {
  const launch = caddyLaunch(address);
  const result = spawnSync('caddy', ['validate', ...launch.args.slice(1)], {
    encoding: 'utf8',
    env: { ...process.env, ...launch.env },
  });
  if (result.status !== 0) fail('The Caddyfile does not validate:', (result.stderr || result.stdout).trim());
  done('The Caddyfile is valid for this address');
}

// ── the two directions ───────────────────────────────────────────────────

async function turnOn() {
  console.log('\n  HTTPS on the local network\n');

  const version = caddyVersion();
  if (!version) fail('Caddy is not installed. Install it, then run this again:', ...installHint());
  done(`Caddy ${version.split(' ')[0]}`);
  allowLowPorts();

  step('This machine on the network:');
  const address = await chooseAddress();
  const origin = `https://${address}`;

  step(
    `Writing the active profile (${relative(REPO, profileFile(SERVER_ENV))}, ${relative(REPO, profileFile(WEB_ENV))})`,
  );
  writeSettings([
    { file: SERVER_ENV, set: { FRONTEND_URL: origin, CORS_ORIGINS: `${origin},${LOCAL_WEB}` } },
    { file: WEB_ENV, set: { NEXT_PUBLIC_WS_URL: `wss://${address}/api/v1/graphql` } },
  ]);
  validateCaddyfile(address);

  console.log(`
  What is left:

  1. Reserve ${address} for this machine on the router (a DHCP reservation),
     so the address stays the same. If it changes, run this again: the phones
     trust the authority, not the address, so they need nothing new.${
       isWsl()
         ? `
     ⚠ WSL: phones reach WINDOWS, not WSL. In %USERPROFILE%\\.wslconfig set
     networkingMode=mirrored under [wsl2], run \`wsl --shutdown\`, and allow
     ports 80 and 443 in Windows Defender Firewall. Use the Windows PC's
     address above (run this again with --address=… if it differs).`
         : ''
}
  2. Built apps:   pnpm build && pnpm pm2:start && pnpm pm2:save
     Development:  pnpm dev:focus …   and, in a second terminal,  pnpm https
     (The web app must be BUILT again: NEXT_PUBLIC_WS_URL is baked in.)
  3. On each phone or tablet, on this Wi-Fi, open
       http://${address}/kwtech-local-ca.crt
     and trust it (README.md: iPhone needs Install, then Certificate Trust
     Settings). Then open ${origin}.

  Moving to another machine later? Copy the .caddy/ folder with the rest, and
  the phones keep trusting it.
`);
}

async function turnOff() {
  console.log('\n  Back to plain http://localhost\n');
  writeSettings([
    { file: SERVER_ENV, set: { FRONTEND_URL: LOCAL_WEB }, remove: ['CORS_ORIGINS'] },
    { file: WEB_ENV, set: { NEXT_PUBLIC_WS_URL: 'ws://localhost:8080/api/v1/graphql' } },
  ]);
  console.log('\n  Then: pnpm build && pnpm pm2:start (pm2 no longer starts Caddy). .caddy/ is kept.\n');
}

await (flag('off') ? turnOff() : turnOn());
