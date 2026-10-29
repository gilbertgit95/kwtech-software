# HTTPS: on one computer, on the shop's network, on a remote server

How people reach the app over HTTPS, and what to set up where. Read this
when installing the app on a new machine, on a remote server, or when a new
phone, tablet or computer starts using it. Getting the code running at all
is [SETUP.md](SETUP.md); running the built apps under pm2 is the README,
"Commands".

The decision behind it: PLAN §13, 2026-10-26 and 2026-10-29. The code:
`deploy/https/` (the Caddyfile, and `host.cjs`, which decides when Caddy
runs), `scripts/https-setup.mjs` and `scripts/https.mjs`.

**Contents**

1. [Which setup do you need?](#1-which-setup-do-you-need)
2. [Why other devices need HTTPS](#2-why-other-devices-need-https)
3. [The shop's network: how Caddy does it](#3-the-shops-network-how-caddy-does-it)
4. [The shop's network: first-time installation on the server](#4-the-shops-network-first-time-installation-on-the-server)
5. [The shop's network: registering a device](#5-the-shops-network-registering-a-device) — [Android](#android) · [iPhone and iPad](#iphone-and-ipad) · [Mac](#mac) · [Windows](#windows) · [Firefox](#firefox-any-system)
6. [Installing the app on a phone](#6-installing-the-app-on-a-phone)
7. [A remote server with a domain (no Caddy)](#7-a-remote-server-with-a-domain-no-caddy)
8. [Another computer becomes the server](#8-another-computer-becomes-the-server)
9. [Day to day](#9-day-to-day)
10. [Troubleshooting](#10-troubleshooting)
11. [Known limits](#11-known-limits)

## 1. Which setup do you need?

**Caddy is optional.** It has one job: giving the devices on the **shop's own
network** HTTPS when there is **no domain**. The app does not depend on it:
both apps run on their own ports (API `:8080`, web app `:8081`) with or
without it, and nothing in the app's code knows it exists.

| Where the app runs, and who uses it | HTTPS from | Set up | Each device |
|---|---|---|---|
| **One computer**, used only on that computer (`http://localhost:8081`) | not needed — `localhost` counts as secure | nothing | nothing |
| **The shop's network**: one computer serves, phones, tablets and other computers on the Wi-Fi use it | **Caddy**, with its own local certificate authority | sections 3–4 | trusts the certificate once (section 5) |
| **A remote server** with a domain (`https://pos.yourshop.com`) | the **host**: the platform, Cloudflare, or nginx with Let's Encrypt — **no Caddy** | section 7 | nothing: a public certificate is trusted already |

Caddy runs only when the API's `FRONTEND_URL` is `https://` on a **private
network address** — `192.168.x.x`, `10.x.x.x` or `172.16–31.x.x`
(`httpsHost()` in `deploy/https/host.cjs`). With `http://`, `localhost` or a
**domain**, pm2 runs only the two apps and `pnpm https` refuses to start.

## 2. Why other devices need HTTPS

Any device **other than the server itself** must open the app over HTTPS,
on the shop's network as on a remote server:

- **The built app's sign-in needs it.** Its session cookies are `Secure`,
  and browsers drop those on plain http, so nobody stays signed in.
- **Live updates** run over `wss://` once the page is `https://`.
- **Installing the app** on a phone's home screen, **system pop-up
  notifications** and the **Copy** buttons only exist on a secure page.
- ⚠ **Today the app crashes on plain `http://<address>:8081`**, in
  development too: off `localhost` the page is not a *secure context*, so the
  browser leaves out `crypto.randomUUID()`, which the browser code calls in a
  dozen places (the phone layout fails as it loads; taking payment would
  too). Open `https://<address>` instead.

The server itself may keep using `http://localhost:8081`.

## 3. The shop's network: how Caddy does it

With no domain there is no public certificate. **Caddy** sits in front of
both apps on port 443 with a certificate signed by its **own local
certificate authority**, which each device trusts **once**.

```
https://<address>/api/v1/*            →  the API, :8080 (and the live-updates socket, wss://)
https://<address>/*                   →  the web app, :8081
http://<address>/kwtech-local-ca.crt  →  the authority's certificate, for devices to install
http://<address>/*                    →  redirected to https://
```

- `<address>` is the server's address on the network, e.g. `192.168.1.186`.
- The authority lives in the gitignored **`.caddy/`** folder at the
  repository's root. ⚠ It holds the authority's private key: never commit
  it, never share it, and keep it when the server moves (section 8), or every
  device must be registered again.
- Devices trust the **authority**, not the address: when the address
  changes, the server issues itself a new certificate and the devices need
  nothing new.

## 4. The shop's network: first-time installation on the server

Once, on the computer that serves the shop, after the app itself runs
([SETUP.md](SETUP.md)). About ten minutes.

### Step 1 — Give the server a fixed address

On the router's admin page, reserve the server's current address for it (a
*DHCP reservation*, also called *static lease* or *address reservation*).
Otherwise the router may give the server a new address after a restart, and
every device shows a warning until step 4 is run again.

To see the address: `ipconfig getifaddr en0` (Mac), `hostname -I` (Linux),
`ipconfig` (Windows). `pnpm https:setup` finds it too.

### Step 2 — Install Caddy (2.8 or newer)

| System | Install |
|---|---|
| **Mac** | `brew install caddy` |
| **Ubuntu, or Windows with WSL** | Caddy's own apt repository (caddyserver.com/docs/install), then `sudo apt install caddy`. Then `sudo systemctl disable --now caddy`: the app runs Caddy itself, not the system service |

Check it: `caddy version`.

### Step 3 — Windows with WSL only

Other devices reach Windows, not WSL, unless WSL shares Windows' network:

1. In `%USERPROFILE%\.wslconfig`, under `[wsl2]`, add
   `networkingMode=mirrored` (Windows 11).
2. Run `wsl --shutdown`, then open WSL again.
3. In **Windows Defender Firewall**, allow inbound TCP ports **80** and **443**.

The address in step 1 is then the Windows PC's.

### Step 4 — Run the setup

From the repository, with the right profile active (`pnpm env:show`):

```bash
pnpm https:setup
```

It finds the address and asks you to confirm it; checks Caddy (and prints
the install command if it is missing); on Linux lets Caddy use ports 80 and
443 without root (`setcap`, asks for the sudo password once); writes three
settings into the active profile and **nothing else** — `FRONTEND_URL` and
`CORS_ORIGINS` in `envs/<name>/web-server.env`, `NEXT_PUBLIC_WS_URL` in
`envs/<name>/web-app.env`; checks the Caddyfile for that address; and
prints what is left.

Options: `--address=192.168.1.186` (no detection), `--yes` (no questions),
`--off` (back to `http://localhost`, section 9).

### Step 5 — Start it

**The built apps** (the shop's server):

```bash
pnpm build                 # ⚠ needed: NEXT_PUBLIC_WS_URL is baked into the web app's build
pnpm pm2:start             # three services: kwtech-web-server, kwtech-web-app, kwtech-https
pnpm pm2:save              # all three start again after a reboot
```

**Development**: the dev servers as usual (`pnpm dev:focus …` or `pnpm dev`),
and in a second terminal:

```bash
pnpm https                 # Caddy beside the dev servers; Ctrl+C stops it
```

The first start creates the authority in `.caddy/`.

### Step 6 — Check it from the server

```bash
curl -sk -o /dev/null -w "%{http_code}\n" https://192.168.1.186/api/health          # 200
curl -sk -o /dev/null -w "%{http_code}\n" https://192.168.1.186/api/v1/health       # 200 (the API through Caddy)
curl -s  -o /dev/null -w "%{http_code}\n" http://192.168.1.186/kwtech-local-ca.crt  # 200
```

Then register each device (section 5), the server's own browser too if it
will use the `https://` address.

## 5. The shop's network: registering a device

Once on **each** phone, tablet or computer, connected to the **shop's
Wi-Fi**. It makes the device trust the shop's certificate authority, so
`https://<address>` opens without a warning. iPhones and Android phones
deliberately ask a person to do this; no script can.

Every device starts by downloading the certificate from
**`http://192.168.1.186/kwtech-local-ca.crt`** — plain `http://`, because
the device does not trust the `https://` address yet.

### Android

Chrome downloads the certificate but cannot install it; Android installs it
from **Settings**.

1. **Download.** In Chrome, open `http://192.168.1.186/kwtech-local-ca.crt`.
   It saves `kwtech-local-ca.crt` to Downloads. If Chrome says a certificate
   cannot be installed from the browser, that is expected.
2. **Install**, in Settings:
   - **Pixel and most phones:** Settings → **Security & privacy** → **More
     security settings** → **Encryption & credentials** → **Install a
     certificate** → **CA certificate** → **Install anyway** → choose
     `kwtech-local-ca.crt`.
   - **Samsung:** Settings → **Security and privacy** → **More security
     settings** → **Install from device storage** → **CA certificate** →
     **Install anyway** → choose the file.
   - **Other phones:** search Settings for **"CA certificate"**.

   Choose **CA certificate**, never *VPN & app user certificate* or *Wi-Fi
   certificate*: those do not make the browser trust it. Android asks for a
   **screen lock** (PIN, pattern or password) first; set one if the phone
   has none.
3. **Open the app.** Close any tab still on the old address, then open
   **`https://192.168.1.186`** in Chrome.

To remove it later: Encryption & credentials → **Trusted credentials** →
**User** → *Caddy Local Authority* → Remove.

### iPhone and iPad

Two steps, and **both** are needed.

1. **Download.** In **Safari** (not Chrome), open
   `http://192.168.1.186/kwtech-local-ca.crt` → **Allow**. iOS says *Profile
   Downloaded*.
2. **Install the profile.** Settings → **Profile Downloaded** (near the
   top; or General → **VPN & Device Management**) → **Install** → passcode →
   **Install**.
3. **Turn on full trust.** Settings → General → About → **Certificate Trust
   Settings** → turn on **Caddy Local Authority** → **Continue**.
4. **Open the app:** `https://192.168.1.186` in Safari.

Skipping step 3 is the usual reason an iPhone still says *Not Private*.

### Mac

⚠ Double-clicking the file can fail with *"Unable to import … Error:
-25294"*: the dialog picks a keychain it cannot write to. Instead:

- **On the server itself**, from the repository:

  ```bash
  security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db .caddy/pki/authorities/local/root.crt
  ```

  macOS asks for your password.
- **On another Mac:** download the file, then **Keychain Access** → File →
  **Import Items…** → the file, **Destination: login**. Open the imported
  *Caddy Local Authority* → **Trust** → *When using this certificate*:
  **Always Trust**, and enter your password.

Then quit and reopen the browser (Safari and Chrome use the keychain).

### Windows

1. Download the file, open it → **Install Certificate…**
2. Store location: **Local Machine** → Next (allow the admin prompt).
3. **Place all certificates in the following store** → Browse → **Trusted
   Root Certification Authorities** → Next → Finish.
4. Restart the browser (Edge and Chrome use the Windows store).

### Firefox (any system)

Firefox keeps its own list: Settings → **Privacy & Security** →
Certificates → **View Certificates** → **Authorities** → **Import…** → the
file → tick *Trust this CA to identify websites*.

### Check a registered device

Open `https://192.168.1.186` and sign in:

- no *Not private* / *Not secure* warning, and a padlock in the address bar;
- the point of sale shows **no** *"Not live — other tills' changes show when
  you reload"* note: live updates work;
- an order held on the phone appears on the Cashier screen by itself.

## 6. Installing the app on a phone

On any `https://` address — the shop's, once the device is registered, or a
remote server's — the app can live on the home screen and open full screen.

- **Android (Chrome):** open the address → **⋮** → **Install app** (or
  **Add to Home screen**) → **Install**.
- **iPhone / iPad (Safari):** open the address → **Share** → **Add to Home
  Screen** → **Add**.

## 7. A remote server with a domain (no Caddy)

On a server reachable from the internet, HTTPS is **required** — passwords
and sessions would otherwise cross the internet in the clear — and it comes
from the **host**, with a **public** certificate every device already
trusts. **No Caddy, and no device registration.**

### What the server needs

1. **A domain** (e.g. `pos.yourshop.com`) whose DNS points at the server.
2. **HTTPS from the host**, one of:
   - a platform that provides it (Render, Railway, Fly.io, DigitalOcean App
     Platform, …);
   - **Cloudflare** in front of the server;
   - on a plain VPS, **nginx** with **certbot** (Let's Encrypt). (Caddy with
     the domain as its site address would also do it, with its own automatic
     Let's Encrypt — but not through `pnpm https`, which is for the shop's
     network only.)
3. **Routing**, the same as Caddy does on the shop's network:

   | Path | Goes to |
   |---|---|
   | `/api/v1/*`, **including the WebSocket upgrade** (live updates) | the API, port **8080** |
   | everything else | the web app, port **8081** |

   Or put the API on a subdomain of its own (`api.yourshop.com` → 8080) and
   adjust the settings below to it.
4. **Ports**: only **443** (and 80, for the certificate and the redirect)
   open to the internet. Never expose 8080, 8081 or Postgres' 5432.

### The profile

In `envs/<name>/` on the server (`pnpm env:new <name>`, then `pnpm env:use
<name>`; set `APP_ENV` to `production`):

```bash
# web-server.env
FRONTEND_URL="https://pos.yourshop.com"      # a domain: pm2 starts NO Caddy
CORS_ORIGINS="https://pos.yourshop.com"

# web-app.env
NEXT_PUBLIC_WS_URL="wss://pos.yourshop.com/api/v1/graphql"   # baked in at build time
```

Do **not** run `pnpm https:setup` there: it is for the shop's network, and
writes a private address.

### Start it

```bash
pnpm build && pnpm pm2:start && pnpm pm2:save    # two services: kwtech-web-server, kwtech-web-app
pnpm pm2:status                                   # no kwtech-https here, by design
```

### An nginx example (a plain VPS)

After `sudo certbot --nginx -d pos.yourshop.com` has issued the
certificate:

```nginx
server {
    listen 443 ssl;
    server_name pos.yourshop.com;
    # ssl_certificate / ssl_certificate_key: written here by certbot

    # Uploads (photos, PDFs) larger than nginx's 1 MB default.
    client_max_body_size 50m;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        # Live updates: the WebSocket upgrade must be passed on.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;   # a live-updates socket stays open
    }

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name pos.yourshop.com;
    return 301 https://$host$request_uri;
}
```

On a platform or behind Cloudflare, set the same routing in its settings,
and make sure WebSockets are allowed (Cloudflare: Network → WebSockets on).

### Check it

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pos.yourshop.com/api/health      # 200
curl -s -o /dev/null -w "%{http_code}\n" https://pos.yourshop.com/api/v1/health   # 200
```

Then sign in from a phone: no warning, and no *"Not live"* note in the point
of sale. Google sign-in works here (it needs a real domain).

## 8. Another computer becomes the server

A new computer takes over serving the shop's network (or a copy is set up
on another computer):

1. **Install and run the app** on it: [SETUP.md](SETUP.md).
2. **Copy what the repository does not carry**, from the old server:
   - **`.caddy/`** — the certificate authority. ⚠ Without it a new
     authority is made, and **every device must be registered again**
     (section 5). With it, devices notice nothing.
   - **`envs/<name>/`** — the profile with its secrets, then `pnpm env:use
     <name>`.
   - **The database**, if it moves too: SETUP.md §7, "Moving a database to
     another computer".
3. **On the new server**, section 4: steps 1–3 (address, Caddy, WSL), then
   `pnpm https:setup` (step 4), which writes the NEW address, and step 5.
4. **Devices**: nothing, if `.caddy/` was copied — they trust the authority,
   which signs a certificate for the new address. They just open the new
   address (or the same one, if the new server took it over on the router).

A **remote** server instead: section 7, with no `.caddy/` to copy.

## 9. Day to day

| Task | How |
|---|---|
| Start (built apps) | `pnpm pm2:start` — Caddy too (`kwtech-https`) on the shop's network |
| Start (development) | the dev servers as usual, plus `pnpm https` in a second terminal |
| What is running | `pnpm pm2:status`: `kwtech-web-server`, `kwtech-web-app`, and on the shop's network `kwtech-https` |
| Caddy's log | `pnpm pm2:logs kwtech-https` (built), or the `pnpm https` terminal |
| Stop | `pnpm pm2:stop` — all of them (e.g. before `pnpm dev`, which needs the same ports) |
| **The address changed** (new router, another network) | `pnpm https:setup` again, then `pnpm build && pnpm pm2:start`. Devices need **nothing** new. Then reserve the address (section 4, step 1) |
| **A new phone, tablet or computer** | section 5 only |
| **Turn local HTTPS off** | `pnpm https:setup --off` (the profile goes back to `http://localhost`), then `pnpm build && pnpm pm2:start` |

## 10. Troubleshooting

| What you see | Why, and the fix |
|---|---|
| *Your connection is not private* / *Not secure* on a device | It has not trusted the authority yet (section 5). **iPhone**: both *Install* **and** *Certificate Trust Settings*. **Android**: installed as **CA certificate**, from Settings |
| The warning comes back on every device at once | The server's address changed: `pnpm https:setup`, rebuild (section 9), reserve the address on the router |
| A phone shows a crash, or *"crypto.randomUUID is not a function"* | It is on plain `http://<address>:8081`: open **`https://<address>`** (section 2) |
| A phone cannot stay signed in | It is on `http://`: the built app's cookies need `https://` |
| *"Not live — other tills' changes show when you reload"* | Live updates cannot connect. Is Caddy (or the remote host's proxy) running and passing the WebSocket upgrade on `/api/v1/`? Is `NEXT_PUBLIC_WS_URL` `wss://<address or domain>/api/v1/graphql`? It is baked in: `pnpm build` after changing it |
| `kwtech-https` errored in `pnpm pm2:status` | Caddy is not installed, or on Linux may not use port 443: `pnpm https:setup` says which. `pnpm pm2:logs kwtech-https` shows the error |
| `pnpm https` says *FRONTEND_URL … is not an https:// address on this network* | Run `pnpm https:setup` first. On a remote server with a domain this is expected: there is no Caddy there (section 7) |
| A remote server shows `kwtech-https` | `FRONTEND_URL` is a private address, not the domain: fix the profile (section 7), then `pnpm pm2:start` |
| The page does not open from a phone | Not on the shop's Wi-Fi; ports 80/443 blocked (Windows: section 4, step 3); or Caddy is not running |
| Mac: *Error: -25294* importing the certificate | `security add-trusted-cert`, or Keychain Access with *Destination: login* (section 5, Mac) |
| Uploads fail on a remote server | The proxy's body limit: nginx's `client_max_body_size` (section 7) |

## 11. Known limits

- **Google sign-in** does not work on the shop's network (a bare address):
  Google accepts only a real domain. Passwords and two-step verification do.
  On a remote server with a domain it works.
- **The shop's network only** for Caddy: nothing is reachable from the
  internet that way, by design.
- `NEXT_PUBLIC_WS_URL` is **baked into the web app's build**: rebuild after
  changing it.
- Plain `http://` from another device does not work today (section 2). Making
  the browser code independent of `crypto.randomUUID()` would let development
  run over plain http from phones; the built app would still need HTTPS to
  stay signed in.
