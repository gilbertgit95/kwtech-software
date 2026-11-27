# Installing kwtech at a shop

Follow this alone, step by step. Steps marked **(by hand)** are yours; the
installer does and shows the rest. Print it before going.

## 0. Before going to the shop

- [ ] **The release**, from the project's Releases page, on a USB stick:
      `kwtech-install-<version>.zip`, and, if the shop's internet is slow,
      the images file `kwtech-images-<version>.tar`.
- [ ] **The router's admin password** (often on a sticker under the router).
- [ ] **A network cable** for the server PC, if the router is near it.
- [ ] **The people list:** the organization's name, the first workspace's
      name, and for each person their name, email, username and role
      (Organization owner, admin or user; in the workspace Admin, Supervisor
      or Staff). The owner is required. **Never write passwords on it.**
- [ ] **The printers' drivers**, from each maker's website.

The server PC must be **Windows 11, version 22H2 or newer** (Settings,
System, About), 64-bit, with **8 GB of memory** and **20 GB free**, signed in
with an **administrator** account, and updated (Windows Update, then restart).
Windows 10 cannot be the server.

## 1. Prepare the PC (by hand, 5 minutes)

1. **Same network as the phones:** the shop's own Wi-Fi or cable, ⚠ never a
   guest network (guest networks keep devices from reaching each other).
2. Plug in the cable if there is one, and turn Wi-Fi off on this PC.
3. Copy `kwtech-install-<version>.zip` to `C:\` and unzip it to
   `C:\kwtech-install`.

## 2. Run the installer

1. Start, type **PowerShell**, right-click, **Run as administrator**, Yes.
2. Type, then Enter:
   ```powershell
   cd C:\kwtech-install
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   With the images on the USB stick, add ` -FromImages D:\kwtech-images-<version>.tar`.
3. It checks the PC and shows `[ok]` or `[xx]` for each check. An `[xx]` says
   what to fix (and Troubleshooting below); fix it and run the same command
   again. **Running it again is always safe.**
4. **If it asks to restart:** save your work, restart, and **sign in again as
   the same user**. It continues by itself. If nothing happens within 2
   minutes, run step 2 again.

## 3. Answer its questions

- **The address**: it shows the one it found (`192.168.1.186`). Press Enter
  if it is right. **Write it down** (step 9).
- **Email for password resets**: an SMTP address if the shop has a mail
  account, or Enter to skip. Skipped, a forgotten password is reset on this
  PC (Troubleshooting).
- It downloads the app and starts it (a few minutes the first time).
- **The shop and its first people**, from the people list:
  1. organization name, then Enter for the suggested key;
  2. first workspace name, then Enter;
  3. the **super admin**: name, email, username (Enter for the suggestion),
     password twice (nothing shows while typing);
  4. the **Organization owner** (required), then their workspace role
     (Enter for Workspace admin);
  5. for each other role, **y** to add a person or **n** to skip;
  6. **read the summary**, then **y**. Nothing is written before that.
- **Will this PC print?** **y** if a printer is connected to it.

At the end it opens **`https://localhost`** and prints the **MAC address** to
reserve. ⚠ On this PC always use `https://localhost`, never its own
`192.168.x.x` address (that one times out on this PC).

## 4. Reserve the address on the router (by hand) ⚠ do not skip

If the router gives this PC a new address one day, every phone loses the app
and every device shows a certificate warning.

1. Open the router's page: usually `http://192.168.1.1` or
   `http://192.168.0.1`, with its admin password.
2. Find **DHCP Reservation** (or *Address Reservation*, *Static Lease*,
   *IP & MAC Binding*), usually under LAN or DHCP.
3. Add this PC's **MAC address** and **address** from step 3. Save.
4. Restart this PC; in PowerShell run `ipconfig`: same address means done.

On Wi-Fi: turn off **Random hardware addresses** for the network (Settings,
Network & internet, Wi-Fi), or the MAC changes and the reservation stops
matching. A new or reset router loses the reservation: make it again.

## 5. Check it on this PC

1. `https://localhost` opens with a padlock, no warning. Sign in as the
   **super admin**; open **Server, Local network**: the address and two QR codes.
2. Sign out; sign in as the **owner**: the organization and its workspace are there.

## 6. Each printing PC (Windows 10 or 11)

1. **(by hand)** Install each printer with its maker's driver and print a
   Windows test page.
2. **(by hand)** On the workspace's **Printers** page, as a workspace admin:
   **Add a computer**, name it after the PC. The pairing code works **once,
   for 10 minutes**.
3. On the printing PC, PowerShell as administrator, from the bundle:
   `powershell -ExecutionPolicy Bypass -File .\windows\install-print-agent.ps1`,
   then type the server's address and the code.
4. **(by hand)** Compare the certificate fingerprint it shows with the Local
   network page's; answer **y** only if they match.
5. **(by hand)** Set that PC to sign in automatically and never sleep.
6. **(by hand)** **Test print** on each printer from the Printers page, and
   measure the page (lines the stated length, the corner 20 mm from the left
   and 30 mm from the top).

## 7. Each phone, tablet and other PC

On the shop's Wi-Fi: scan **QR code 1** on the Local network page to download
the certificate, install it (`docs/HTTPS.md` section 5 has each device), then
**QR code 2** to open the app.

- **Android:** Settings, search **CA certificate**, Install anyway, the file. Needs a screen lock.
- **iPhone / iPad:** Safari, Allow; Settings, **Profile Downloaded**, Install; then
  Settings, General, About, **Certificate Trust Settings**, turn it on. ⚠ The last step is the one usually missed.
- **Windows:** open the file, Install Certificate, **Local Machine**,
  **Trusted Root Certification Authorities**.

## 8. Before leaving: the final check

- [ ] The router reservation is made, and after a restart the address stayed (`ipconfig`).
- [ ] After that restart, a phone opened the app **without anybody signing in to the server PC**.
- [ ] A phone shows the padlock, and the point of sale shows **no** "Not live" note.
- [ ] Every printing PC shows **Online**, and a test print came out right.
- [ ] **Server, Backups** shows the daily 9 PM backup. Copy backups off the PC now and then.

## 9. The record sheet (leave a copy at the shop)

The installer writes `/opt/kwtech/RECORD.txt` inside WSL (version, address,
MAC, computer name, date). Add: the router's model, which PCs print, and the
super admin's email (**never** a password).

## On a Mac (Apple Silicon, M-series)

⚠ **Not yet run on a real Mac** (#233): try it on one before a shop relies on it.

**The Mac:** an M-series MacBook or Mac mini, **macOS 13 (Ventura) or newer**,
at least 16 GB of memory, signed in as an administrator, on the shop's own
network (not a guest network). Intel Macs are not supported. Printing still
needs a Windows PC with the print agent (step 6).

1. **Homebrew** (brew.sh), if the Mac does not have it: paste its install
   command into Terminal, then open a new Terminal.
2. Unzip `kwtech-install-<version>.zip` into your home folder, then:
   ```bash
   cd ~/kwtech-install-<version>
   bash install-mac.sh --dry-run    # what it would change
   bash install-mac.sh              # do it
   ```
   It installs **Colima** (free Docker for the Mac), starts it at sign-in,
   stops the Mac sleeping on power (asks your password), installs the app in
   `~/kwtech`, asks the same questions as on Windows (step 3), and makes the Mac
   trust the shop's certificate (asks your password again).
3. **At the end it checks whether phones can reach it.** `[ok] https://<address>
   answers` means yes. `[xx]` lists what to check: usually macOS's Firewall
   (System Settings, Network, Firewall) blocking incoming connections for
   `limactl`.
4. **(by hand)** System Settings, Users & Groups: **automatic sign-in** for
   this user. Colima runs as the signed-in user, so after a power cut the app
   comes back only once someone (or automatic sign-in) signs in. With
   FileVault on, macOS does not allow automatic sign-in: a person signs in
   after each restart.
5. **(by hand)** Reserve the Mac's address on the router (step 4; the MAC
   address is in `~/kwtech/RECORD.txt`), and register devices (step 7).

Day to day in Terminal: `kwtech status`, `kwtech logs api`, `kwtech update`,
`kwtech recover-account` (in `/opt/homebrew/bin`, or `~/kwtech/kwtech`).

**Trying it the first time:** after step 2, check these and note what you see:
`kwtech status` (all healthy); `https://localhost` opens with a padlock;
a phone on the same Wi-Fi opens `https://<address>`; restart the Mac, sign in,
and the app comes back by itself.

## Day to day, in PowerShell

```powershell
wsl -d Ubuntu -u root kwtech status            # is everything running
wsl -d Ubuntu -u root kwtech logs api          # what the app is doing (Ctrl+C stops)
wsl -d Ubuntu -u root kwtech recover-account   # a new password for an account
wsl -d Ubuntu -u root kwtech update            # the newest release, safely (below)
```

## Updating

Do it when someone can check the shop afterwards, not just before opening.

1. PowerShell as administrator: `wsl -d Ubuntu -u root kwtech update`.
2. It shows the version it moves from and to, and that release's notes. Answer **y**.
3. It **backs up first** (the database, the shop's certificate authority and
   the settings, in `/opt/kwtech/backups/update-<from>-to-<to>-<time>`), and
   stops if the backup fails.
4. It updates and waits until everything is healthy. **If the new version
   does not come up, it goes back to the old one by itself**, restoring the
   database if the new one had changed it, and says what failed.
5. Then update the **print agent on each printing PC** it lists (step 6, with
   the same release's bundle). Always the server first, then the agents: an
   agent newer than its server gets no print jobs.

Offline, from a USB stick: unzip the new `kwtech-install-<version>.zip`,
then `kwtech update --bundle <that folder as WSL sees it, e.g. /mnt/d/kwtech-install-<version>> --from-images /mnt/d/kwtech-images-<version>.tar`.

## Troubleshooting

| What you see | Why | What to do |
|---|---|---|
| "Windows 11 version 22H2 or newer is needed" | Windows 10 or an old Windows 11 | Update Windows; Windows 10 cannot be the server |
| "Ports 80 and 443 must be free … in use by …" | another web server (IIS, Skype, another app) | Stop or uninstall what it names, run again |
| "Virtualization is off" | the PC's firmware setting | Restart into BIOS/UEFI (F2, F10 or Del at start), turn on Intel VT-x / AMD-V / SVM |
| It did not continue after the restart | signed in as another user | Sign in as the user who started it; run step 2 again |
| "Not healthy after 6 minutes", with log lines | a service would not start | Run it again once. If it repeats, photograph the screen; the shop's data is untouched |
| A phone cannot open the app | not on the shop's Wi-Fi, a guest network, or the PC asleep | Same Wi-Fi, not guest; the server PC on and awake |
| It worked yesterday; today nothing reaches it | the address changed (no reservation) | `ipconfig`; reserve the OLD address again (step 4) and restart |
| "Not private" / "Not secure" on a phone | the certificate is not installed, or not trusted (iPhone) | Step 7 again; on iPhone, **Certificate Trust Settings** |
| The point of sale says "Not live" | opened through the wrong address | `https://<address>`; on the server PC `https://localhost` |
| A printing PC shows Offline | nobody signed in, asleep, or off the network | Automatic sign-in, never sleep, check its network |
| Server, Backups shows no daily backup, or an upload fails | an install made before 0.3.2: the backups and files folders were not the app's | Run step 2 again (or `kwtech update`): it hands the folders to the app, and keeps the data |
| "The code has expired" when pairing | codes last 10 minutes, once | Add the computer again for a new code |
| Forgot a password | | With email: *Forgot password* on the sign-in page. Without, or for the super admin: on the server PC, `wsl -d Ubuntu -u root kwtech recover-account` |
