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

## Day to day, in PowerShell

```powershell
wsl -d Ubuntu -u root kwtech status            # is everything running
wsl -d Ubuntu -u root kwtech logs api          # what the app is doing (Ctrl+C stops)
wsl -d Ubuntu -u root kwtech recover-account   # a new password for an account
```

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
| "The code has expired" when pairing | codes last 10 minutes, once | Add the computer again for a new code |
| Forgot a password | | With email: *Forgot password* on the sign-in page. Without, or for the super admin: on the server PC, `wsl -d Ubuntu -u root kwtech recover-account` |
