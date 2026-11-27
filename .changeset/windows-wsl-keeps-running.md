---
"@kwtech/web-server": patch
---

On Windows, the app now starts after a normal Shut down and power-on: the installer turns off Fast Startup and keeps WSL running (at startup, at sign-in and within 5 minutes whenever it stops). Run the installer again on an existing shop PC to get this.
