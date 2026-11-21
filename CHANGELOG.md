# Changelog

kwtech, one version for the API, the web app, the print agent and every module (#204).

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

