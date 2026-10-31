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

### One way in: `LISTEN_HOST`

By default both apps listen on **every** address, so another device could
also open `http://<address>:8081` or `:8080` directly, around the front
door, unencrypted. **`LISTEN_HOST="127.0.0.1"`** (in
`envs/<name>/web-server.env`) makes both apps answer **only to this
computer**, so the front door is the only way in from the network:

```
                              THE SERVER
                      ┌───────────────────────────────────────────┐
📱 https://<address> ─🔒─▶│ Caddy / nginx :443 ─┬─▶ web app 127.0.0.1:8081 │
                      │                       └─▶ API     127.0.0.1:8080 │
📱 http://<address>:8081 ✗  refused: nothing listens there for the network │
                      └───────────────────────────────────────────┘
```

| Setup | `LISTEN_HOST` |
|---|---|
| One computer | empty (default). `127.0.0.1` also works, and keeps the apps off the network |
| The shop's network (Caddy) | `127.0.0.1` — **`pnpm https:setup` sets it**, `--off` removes it |
| A remote server, **nginx on the same machine** | `127.0.0.1` — set it yourself (section 7) |
| A remote server on a **platform** (Render, Fly.io, …) or in **Docker** | ⚠ **empty**: the front door is on another machine and must reach the apps over the network; `127.0.0.1` would cut them off |

The API reads it itself (`apps/web-server/src/config/env.ts`); the web app
gets it as `next -H` from `scripts/next.mjs` (its `dev` and `start` scripts)
and from pm2 (`ecosystem.config.cjs`). The server always keeps
`http://localhost:8081`.

⚠ For this computer the web app is given **`localhost`**, never `127.0.0.1`
(`webListenHost()` in `deploy/https/host.cjs`): Next writes 127.0.0.1 as
"localhost" inside its middleware, so with `-H 127.0.0.1` the phone layout's
rewrite looked external, and **every page on a phone was a 500**
(*"Failed to proxy https://localhost:8081/mobile … wrong version number"*).
It then listens on `[::1]`, which `localhost` and Caddy reach.

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
([SETUP.md](SETUP.md)). About ten minutes. Do the steps in this order: each
one needs the one before it.

### Before you start

Have these ready. Then nothing stops halfway.

| Have ready | Why, and how to get it |
|---|---|
| **The app running on this computer** | [SETUP.md](SETUP.md): `http://localhost:8081` opens and you can sign in. The right profile is active: `pnpm env:show` (normally `local`) |
| **This computer's address** on the shop's network, written down | Steps 2 and 4 use it. Windows: `ipconfig` in PowerShell, the *IPv4 Address* of the Ethernet or Wi-Fi adapter (e.g. `192.168.1.68`). ⚠ Not WSL's `hostname -I` before step 1: that prints a `172.x.x.x` address inside WSL. Mac: `ipconfig getifaddr en0`. Linux: `hostname -I` |
| **`.caddy/` from the old server**, only if this computer **replaces** one | The certificate authority the shop's phones already trust (section 3). Without it, every device must be registered again. Copy the whole folder from the old server's repository root, e.g. `tar czf caddy.tgz .caddy` there, then `tar xzf caddy.tgz` in this repository's root, inside WSL. ⚠ It holds a private key: a USB stick or `scp`, never chat or email, and delete `caddy.tgz` afterwards. Moving the profile and the database too: section 8 |
| **The passwords** | `sudo` on Linux/WSL (steps 3 and 4). On Windows, an **administrator** account for PowerShell *Run as Administrator* (step 1). The **router's admin page** (step 2) |
| **Internet** on this computer | Step 3 downloads Caddy |
| **Windows with WSL only:** Windows 11 and a current WSL | Mirrored networking needs both. `wsl --version` in PowerShell; `wsl --update` if it is old |
| **Ports 80 and 443 free** | Caddy needs both. Something else using them (IIS, another web server, Skype) stops it. Windows: `netstat -ano \| findstr /C:":80 " /C:":443 "` in PowerShell (the space after each port keeps out `:8080` and `:8081`) should show nothing *LISTENING* before the setup |
| **A phone on the shop's Wi-Fi** | To check it at the end (step 6, section 5) |

### Step 1 — Windows with WSL only: share the network, open the ports

Skip this on a Mac or Linux server.

The app, Caddy and the database all run inside WSL. Phones and other
computers reach **Windows**, not WSL, so Windows has to share its network
with WSL and let ports 80 and 443 through. No `netsh interface portproxy` is
needed. Set up this way on 2026-10-31 (Windows 11 build 26300, WSL 3.0.3).

**1a. Mirrored networking.** In `%USERPROFILE%\.wslconfig` (Windows side,
e.g. `C:\Users\<you>\.wslconfig`), under `[wsl2]`:

```ini
[wsl2]
networkingMode=mirrored
# optional, for a server: keep WSL (and pm2's services) running with no terminal open
vmIdleTimeout=-1
```

Then, in PowerShell, `wsl --shutdown`, and open WSL again. Check it in WSL:
`hostname -I` now prints the **PC's own network address** (e.g.
`192.168.1.68`), not a `172.x.x.x` one. That is the server's address from
here on.

**1b. Mark the shop's network Private.** The firewall rules below cover the
Private profile only. In PowerShell, `Get-NetConnectionProfile` shows the
category. If it says *Public*, change it with `Set-NetConnectionProfile
-InterfaceAlias "<alias it shows>" -NetworkCategory Private` (as
Administrator), or with Settings → Network → *Private network*.

**1c. Open ports 80 and 443**, in **PowerShell as Administrator**. With
mirrored networking there are **two** firewalls: Windows Defender Firewall,
and the **Hyper-V firewall** that stands in front of WSL and blocks
everything coming in by default. Opening only the first one is not enough.
Phones then time out.

```powershell
# Windows Defender Firewall
New-NetFirewallRule -DisplayName "kwtech HTTPS" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 80,443 -Profile Private

# the Hyper-V firewall in front of WSL ({40E0AC32-…} is WSL's id, the same on every PC)
New-NetFirewallHyperVRule -Name "kwtech-https" -DisplayName "kwtech HTTPS" -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPorts 80,443 `
  -VMCreatorId "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}"
```

Check the rules with `Get-NetFirewallRule -DisplayName "kwtech HTTPS"` and
`Get-NetFirewallHyperVRule -DisplayName "kwtech HTTPS"`. Remove them with
`Remove-NetFirewallRule` and `Remove-NetFirewallHyperVRule`, using the same
`-DisplayName`.

Everything from step 2 on runs **inside WSL**, in WSL's copy of the
repository, as on a Linux server.

### Step 2 — Give the server a fixed address

On the router's admin page, reserve the server's current address for it (a
*DHCP reservation*, also called *static lease* or *address reservation*).
Otherwise the router may give the server a new address after a restart, and
every device shows a warning until step 4 is run again.

To see the address: `ipconfig getifaddr en0` (Mac), `hostname -I` (Linux, and
WSL after step 1), `ipconfig` (Windows). `pnpm https:setup` finds it too.

### Step 3 — Install Caddy (2.8 or newer)

| System | Install |
|---|---|
| **Mac** | `brew install caddy` |
| **Ubuntu, or Windows with WSL** (inside WSL) | Caddy's own apt repository, below. Ubuntu's own `caddy` package is too old |

On Ubuntu, and inside WSL on Windows (Caddy's instructions,
caddyserver.com/docs/install):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
sudo systemctl disable --now caddy   # the app runs Caddy itself (pm2 or `pnpm https`), not the system service
```

The system service has to stay off. Otherwise it holds ports 80 and 443,
and the app's Caddy cannot start.

Check it: `caddy version` (2.11.7 on the WSL server, 2026-10-31).

### Step 4 — Run the setup

From the repository, with the right profile active (`pnpm env:show`):

```bash
pnpm https:setup
```

It finds the address and asks you to confirm it; checks Caddy (and prints
the install command if it is missing); on Linux lets Caddy use ports 80 and
443 without root (`setcap`, asks for the sudo password once; check it with
`getcap /usr/bin/caddy`, which prints `cap_net_bind_service=ep`); writes
three settings into the active profile and **nothing else** —
`FRONTEND_URL`, `CORS_ORIGINS` and `LISTEN_HOST="127.0.0.1"` in
`envs/<name>/web-server.env`, `NEXT_PUBLIC_WS_URL` in
`envs/<name>/web-app.env`; checks the Caddyfile for that address; and prints
what is left.

**On WSL, give the address yourself.** WSL reports more than one address,
Docker's `172.17.0.1` among them, and the one to use is the PC's address on
the shop's network (step 2):

```bash
pnpm https:setup --address=192.168.1.68
```

On that PC it wrote `FRONTEND_URL="https://192.168.1.68"` and
`NEXT_PUBLIC_WS_URL="wss://192.168.1.68/api/v1/graphql"`.

⚠ From the next start, the apps answer **only to Caddy**: other devices use
`https://<address>`, and `http://<address>:8081` is refused (section 1, "One
way in"). Restart both apps after the setup for it to take effect.

Options: `--address=192.168.1.186` (no detection), `--yes` (no questions),
`--off` (back to `http://localhost`, section 9).

### Step 5 — Start it

**If this computer replaces another server**, put the `.caddy/` folder
you got ready (Before you start) in the repository's root **now**, before
the first start. On WSL, put it in WSL's copy of the repository, not the
Windows file system. Keep its private keys private: `chmod -R go-rwx
.caddy`. With it, the devices
already registered keep working. Without it, the first start below makes a
new authority, and every device must be registered again (section 5).

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

The first start creates the authority in `.caddy/`, unless one was copied.

### Step 6 — Check it from the server

On WSL, run these inside WSL:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" https://192.168.1.186/api/health          # 200
curl -sk -o /dev/null -w "%{http_code}\n" https://192.168.1.186/api/v1/health       # 200 (the API through Caddy)
curl -s  -o /dev/null -w "%{http_code}\n" http://192.168.1.186/kwtech-local-ca.crt  # 200
curl -s -m 3 http://192.168.1.186:8081/ || echo "refused — good: the only way in is https"
```

Then register each device (section 5), the server's own browser too if it
will use the `https://` address. That browser cannot use it on WSL (below).

**On WSL, what reaches what** (checked on 2026-10-31, with
`LISTEN_HOST="127.0.0.1"`):

| From | Use | Works |
|---|---|---|
| A phone or another computer on the network | `https://<address>` | yes, through both firewalls to Caddy in WSL |
| **The Windows PC itself**, browser | `http://localhost:8081` (or `https://localhost`) | yes: mirrored networking shares `localhost` with WSL |
| The Windows PC itself | `https://<address>` (its own network address) | ⚠ **no**, it times out: Windows does not route its own address back into WSL. Use `localhost` on this PC |
| A print agent on the Windows PC | `http://localhost:8080/api/v1` | yes |

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

### The installed app's name

The name under the icon, in the app drawer and in Settings → Apps is
`APP_NAME` from the web app's profile (`envs/<name>/web-app.env`). It is read
per request, so a rename needs a restart, not a rebuild; check it at
`/manifest.webmanifest`. Rename the web server's `APP_NAME` at the same time,
or the emails keep the old name.

A device that installed the app before the rename keeps the old name:

- **iPhone / iPad:** the name is fixed when the app is added. Remove it from
  the home screen and add it again.
- **Android (Chrome):** Chrome re-reads the manifest from time to time and
  updates the name by itself, sometimes after asking. Uninstall and install
  again to get it at once.

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
   open to the internet. Never expose 8080, 8081 or Postgres' 5432. With
   nginx on the same machine, `LISTEN_HOST="127.0.0.1"` (below) closes 8080
   and 8081 even if the firewall is wrong; on a platform the platform keeps
   them private.

### The profile

In `envs/<name>/` on the server (`pnpm env:new <name>`, then `pnpm env:use
<name>`; set `APP_ENV` to `production`):

```bash
# web-server.env
FRONTEND_URL="https://pos.yourshop.com"      # a domain: pm2 starts NO Caddy
CORS_ORIGINS="https://pos.yourshop.com"
LISTEN_HOST="127.0.0.1"   # ONLY with nginx on this same machine; leave EMPTY on a platform or in Docker

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
3. **On the new server**, section 4: steps 1–3 (WSL, address, Caddy), then
   `pnpm https:setup` (step 4), which writes the NEW address, and step 5.
4. **Devices**: nothing, if `.caddy/` was copied — they trust the authority,
   which signs a certificate for the new address. They just open the new
   address (or the same one, if the new server took it over on the router).

A **remote** server instead: section 7, with no `.caddy/` to copy.

### A print agent on another computer

A print agent ([apps/print-agent/README.md](../apps/print-agent/README.md))
on the **server** itself keeps `http://localhost:8080/api/v1`. On **another**
computer on the shop's network it goes through the front door, like a phone:
`API_URL="https://<address>/api/v1"` and
`WS_URL="wss://<address>/api/v1/graphql"`. The agent is a Node program and
does not read the computer's certificate list: point it at the shop's
certificate, downloaded from `http://<address>/kwtech-local-ca.crt`, with
`NODE_EXTRA_CA_CERTS=/path/to/kwtech-local-ca.crt` in its environment.
(Not yet tried on a second computer.)

## 9. Day to day

| Task | How |
|---|---|
| Start (built apps) | `pnpm pm2:start` — Caddy too (`kwtech-https`) on the shop's network |
| Start (development) | the dev servers as usual, plus `pnpm https` in a second terminal |
| What is running | `pnpm pm2:status`: `kwtech-web-server`, `kwtech-web-app`, and on the shop's network `kwtech-https` |
| Caddy's log | `pnpm pm2:logs kwtech-https` (built), or the `pnpm https` terminal |
| Stop | `pnpm pm2:stop` — all of them (e.g. before `pnpm dev`, which needs the same ports) |
| **The address changed** (new router, another network) | `pnpm https:setup` again, then `pnpm build && pnpm pm2:start`. Devices need **nothing** new. Then reserve the address (section 4, step 2) |
| **A new phone, tablet or computer** | section 5 only |
| **Turn local HTTPS off** | `pnpm https:setup --off` (the profile goes back to `http://localhost`), then `pnpm build && pnpm pm2:start` |

## 10. Troubleshooting

| What you see | Why, and the fix |
|---|---|
| *Your connection is not private* / *Not secure* on a device | It has not trusted the authority yet (section 5). **iPhone**: both *Install* **and** *Certificate Trust Settings*. **Android**: installed as **CA certificate**, from Settings |
| The warning comes back on every device at once | The server's address changed: `pnpm https:setup`, rebuild (section 9), reserve the address on the router |
| A phone shows a crash, or *"crypto.randomUUID is not a function"* | It is on plain `http://<address>:8081`: open **`https://<address>`** (section 2) |
| `http://<address>:8081` (or `:8080`) is refused from another device | By design with `LISTEN_HOST="127.0.0.1"`: the only way in is `https://<address>` (section 1, "One way in") |
| Every page on a **phone** is a 500, the server's log says *Failed to proxy https://localhost:8081/mobile … wrong version number* | The web app was started with `-H 127.0.0.1`. Start it through its scripts or pm2, which give Next `localhost` (section 1, "One way in") |
| A **remote** server's site is down after setting `LISTEN_HOST` | It runs on a platform or in Docker, whose front door is on another machine: remove `LISTEN_HOST` (section 1) and restart |
| A print agent on another computer cannot connect | It needs `https://` / `wss://` and `NODE_EXTRA_CA_CERTS` pointing at the shop's certificate (section 8) |
| A phone cannot stay signed in | It is on `http://`: the built app's cookies need `https://` |
| *"Not live — other tills' changes show when you reload"* | Live updates cannot connect. Is Caddy (or the remote host's proxy) running and passing the WebSocket upgrade on `/api/v1/`? Is `NEXT_PUBLIC_WS_URL` `wss://<address or domain>/api/v1/graphql`? It is baked in: `pnpm build` after changing it |
| `kwtech-https` errored in `pnpm pm2:status` | Caddy is not installed, or on Linux may not use port 443: `pnpm https:setup` says which. `pnpm pm2:logs kwtech-https` shows the error |
| `pnpm https` says *FRONTEND_URL … is not an https:// address on this network* | Run `pnpm https:setup` first. On a remote server with a domain this is expected: there is no Caddy there (section 7) |
| A remote server shows `kwtech-https` | `FRONTEND_URL` is a private address, not the domain: fix the profile (section 7), then `pnpm pm2:start` |
| The page does not open from a phone | Not on the shop's Wi-Fi; ports 80/443 blocked (Windows: section 4, step 1); or Caddy is not running |
| WSL: phones time out though the Windows firewall allows 80/443 | The **Hyper-V firewall** rule is missing (`Get-NetFirewallHyperVRule -DisplayName "kwtech HTTPS"`), or the network is marked *Public* (section 4, step 1) |
| WSL: `hostname -I` prints `172.x.x.x` | Mirrored networking is not on: `.wslconfig`, then `wsl --shutdown` (section 4, step 1) |
| WSL: `https://<address>` times out **on the Windows PC itself** but works from phones | Expected with mirrored networking: on that PC use `http://localhost:8081` (section 4, step 6) |
| Mac: *Error: -25294* importing the certificate | `security add-trusted-cert`, or Keychain Access with *Destination: login* (section 5, Mac) |
| Phones get *502 Bad Gateway* after the ports were changed | The Caddyfile still says `localhost:8080` / `localhost:8081`: [SETUP.md §8, "Changing the ports"](SETUP.md#changing-the-ports) lists every place |
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
