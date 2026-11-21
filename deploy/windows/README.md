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
| Start at boot | a task `kwtech WSL at startup` | starts the distro at boot with nobody signed in (this user, no stored password) |
| Sleep | plugged-in sleep is Never | sleep and hibernate on mains power: Never |

After changing `.wslconfig` or systemd it runs `wsl --shutdown` once, so
anything running inside WSL stops and starts again. At the end it prints the
PC's address and the one step it cannot do: **reserve that address on the
router** (#133, "A fixed address on the shop's network").

The rule names are the ones `docs/HTTPS.md` uses, so a PC set up by hand
reads as done.

## Tested

- `-WhatIf` on a PC already set up by hand (Windows 11 Pro build 26300,
  WSL 3.0.5): every check `[ok]`, nothing changed.
- `test\wslconfig.tests.ps1`: the `.wslconfig` edit on sample files.

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
- Output and the files are plain ASCII: 5.1 reads a script without a byte-order
  mark in the machine's code page.
