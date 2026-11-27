# Preparing a Windows server PC

`prepare-windows.ps1` gets a Windows 11 PC ready to serve kwtech on the
shop's network (#211, #133 P0b): WSL with Ubuntu and Docker Engine, and
[docs/HTTPS.md](../../docs/HTTPS.md) section 4 step 1 (network sharing, both
firewalls), plus staying up. The planned installer (#133 P3) runs it first on
Windows. It does not install Caddy (step 3): in the Docker setup Caddy runs
inside Compose, and the pm2 setup installs it as step 3 says.

```powershell
# PowerShell, Run as administrator, in this folder
powershell -ExecutionPolicy Bypass -File .\prepare-windows.ps1

# what it would change, changing nothing (runs without Administrator too)
powershell -ExecutionPolicy Bypass -File .\prepare-windows.ps1 -WhatIf
```

## What it does, in order

Each step checks first and prints `[ok]` when it is already done, so running
it again is always safe.

| Step | Checks | Changes when missing |
|---|---|---|
| The PC | Windows 11 22H2+ (build 22621), 64-bit, Administrator, virtualization on, ports 80 and 443 free | nothing: it stops and says how to fix it |
| WSL | installed | `wsl --install --no-distribution`, then a **restart**: it registers a task that continues after you sign in again, as the same user (with `-ThenRun`, the installer's own `install.ps1` continues instead), and exits 3010 |
| | | `wsl --update` |
| Ubuntu | listed by `wsl -l` | `wsl --install -d Ubuntu --no-launch` |
| systemd | `systemd=true` in the distro's `/etc/wsl.conf` | added under `[boot]` |
| Docker Engine | `docker version` inside the distro | Docker's own apt repository and packages (not Docker Desktop: #133, the licence) |
| Network sharing | `networkingMode=mirrored` and `vmIdleTimeout=-1` under `[wsl2]` in `%USERPROFILE%\.wslconfig` | set, keeping every other line |
| Private network | no connection marked Public | marked Private (the firewall rules cover Private only) |
| Windows Defender Firewall | a rule named `kwtech HTTPS` | ports 80 and 443 in, Private |
| Hyper-V firewall (in front of WSL) | a rule named `kwtech HTTPS` | ports 80 and 443 in, for WSL's id |
| Keep WSL running | a task `kwtech WSL at startup` with a startup, a sign-in and a 5-minute trigger | starts the distro at startup with nobody signed in (this user, no stored password), at sign-in, and again within 5 minutes whenever it stops; an older task with only the startup trigger is updated |
| Fast Startup | `HiberbootEnabled` is 0 | turned off, so Shut down really shuts down (Hibernate stays) |
| Sleep | plugged-in sleep is Never | sleep and hibernate on mains power: Never |

After changing `.wslconfig` or systemd it runs `wsl --shutdown` once, so
anything running inside WSL stops and starts again, and then starts the
task again (it holds WSL open only while it runs). At the end it prints the
PC's address and the one step it cannot do: **reserve that address on the
router** (#133, "A fixed address on the shop's network").

The rule names are the ones `docs/HTTPS.md` uses, so a PC set up by hand
reads as done.

## The print agent: `install-print-agent.ps1`

Sets up a Windows 10 or 11 printing PC (#133 P5), the README's manual
"Setting up a computer" in one script: Node.js 22 (winget, if missing); the
release's print agent zip, checked against its `SHA256SUMS.txt`, unpacked to
`C:\kwtech-print-agent`; the server's address, and the shop's certificate,
whose **SHA-256 fingerprint you compare** with the Local network page before
anything else happens; the printers it sees; pairing with the Printers page's
code; and a task that starts it at sign-in of this Windows user (the pairing
is kept per user). `install.ps1` runs it with `-ThisPc` on the server PC.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-print-agent.ps1                 # asks the address and the code
powershell -ExecutionPolicy Bypass -File .\install-print-agent.ps1 -WhatIf         # what it would do
```

- **Even on the server PC it goes through `https://localhost`**: the Docker
  install publishes only Caddy's 80 and 443, never the API's 8080.
- Node trusts the shop's authority only through `NODE_EXTRA_CA_CERTS`, read
  when Node starts, so the agent starts through the `start-agent.ps1` it writes.
- **Running it again updates the agent** (the release's files replace the
  old ones) and keeps `.env.local`, the certificate and the pairing.
- Not yet: running as a Windows service, so it prints with nobody signed in
  (#133, later).

## Tested

- `-WhatIf` on a PC already set up by hand (Windows 11 Pro build 26300,
  WSL 3.0.5): every check `[ok]`, nothing changed.
- `test\wslconfig.tests.ps1`: the `.wslconfig` edit on sample files.
- `-WhatIf` on that PC with the old startup-only task (#237): the task is
  reported as to be updated, and Fast Startup's state is read from the
  registry.
- `install-print-agent.ps1 -WhatIf -Server <address>` on that PC, and its
  fingerprint against Node's `fingerprint256` (the Local network page's) on
  the shop's real certificate: identical.

**Not yet run on a fresh PC:** the WSL install and restart, the Ubuntu and
Docker installs, and the start-at-boot task after a real restart. Run it on
a spare PC before relying on it at a shop.

## Traps it works around

Found running it on a real PC, and commented where they are handled:

- **Windows PowerShell 5.1 mangles a program argument that holds double
  quotes,** and **WSL's `--` expands `$` in the distro's shell first.** So
  commands go to the distro on standard input, through `--exec`, saved to a
  temporary file (so `apt-get` cannot read the rest of the script) and run
  from there.
- **Any stderr line from `wsl.exe` was fatal** under
  `$ErrorActionPreference = 'Stop'` (WSL warns "Failed to mount D:\");
  `wsl.exe` is judged by its exit code instead.
- **`-WhatIf` reached PowerShell's own module loading** ("What if: Set Alias
  gcim..."), so the script uses its own dry-run flag.
- **A startup task alone left the app down after a normal Shut down** (#237).
  With Fast Startup (on by default) Shut down logs off and hibernates, and
  the next power-on is a resume: no startup trigger runs. And the task holds
  WSL open only while its `sleep infinity` runs, so anything that ends the
  distro (`wsl --shutdown`, a WSL update, this script's own restart of WSL)
  ended it until the next real boot. A WSL started from a terminal instead
  stops when that terminal closes. Hence the sign-in and 5-minute triggers
  (with `IgnoreNew`, a repeat does nothing while the task runs), Fast
  Startup off, and the task started again after `wsl --shutdown`. In the
  System log it shows as event 1074 "power off" then 42 "entering sleep",
  and no Kernel-General event 12 at the next power-on.
- Output and the files are plain ASCII: 5.1 reads a script without a byte-order
  mark in the machine's code page.
