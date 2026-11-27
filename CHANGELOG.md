# Changelog

kwtech, one version for the API, the web app, the print agent and every module (#204).

## 0.3.2 (2026-11-28)

### Fixed

- Daily backups and uploaded files now save on a Docker install: the installer gives the app its backups and files folders, which were the system's and refused every write. Run the installer again (or `kwtech update`) on an existing install to fix it.
- On Windows, the app now starts after a normal Shut down and power-on: the installer turns off Fast Startup and keeps WSL running (at startup, at sign-in and within 5 minutes whenever it stops). Run the installer again on an existing shop PC to get this.

## 0.3.1 (2026-11-21)

### Fixed

- kwtech can be installed on an Apple Silicon (M-series) Mac with `install-mac.sh`, and its images now also run natively on ARM computers.

## 0.3.0 (2026-11-21)

### New

- A new organization's overview shows what is left to set up (workspaces, staff, a role for each person), with a link to each step.

### Fixed

- A shop's install downloads the app from the project's own registry address, so new installs and updates can reach it.

## 0.2.0 (2026-11-21)

### New

- A forgotten password can be set again on the server computer with `kwtech recover-account`, for shops without email and for the super admin.

## 0.1.0 (2026-11-21)

### New

- kwtech can run on a shop's own computer in Docker, with its database and HTTPS included, and without an email account.
- A new install can be set up with one command that asks for the shop's name, its first workspace, the super admin and a first person for each role, then creates them all.

### Fixed

- The print agent reports its real version when a computer is paired, instead of 0.0.0.

