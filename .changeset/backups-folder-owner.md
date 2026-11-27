---
"@kwtech/web-server": patch
---

Daily backups and uploaded files now save on a Docker install: the installer gives the app its backups and files folders, which were the system's and refused every write. Run the installer again (or `kwtech update`) on an existing install to fix it.
