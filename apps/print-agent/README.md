# @kwtech/print-agent

A small program on a shop's computer. It pairs that computer with one
workspace, connects **out** to the server (the shop opens no port), reports
the printers the operating system has installed, with their papers and
printable areas, and **prints the PDFs the workspace sends it**. The web app's
Printers page (`module-print`) lists the printers and prints a ruler page; the
print studio prints its results through it.

How a job travels, and what the server keeps (nothing of the file):
`packages/module-print/README.md`.

## Setting up a computer

For the computer in a shop that the printers are connected to. Done once per
computer. The Printers page in the web app has the same steps as a "Setup
guide", with the server's two addresses ready to copy.

**What the computer needs**

- Windows 10 or 11, 64-bit, and switched on whenever the shop prints.
- Each printer installed in Windows with its maker's own driver, and able to
  print a Windows test page. A printer Windows does not list, the agent does
  not see.
- Node.js 22 or newer **for Windows** (check `node -v` in PowerShell, not in
  a WSL terminal).
- A way to the server: `localhost` when the server runs on the same computer
  (including inside WSL), otherwise its public `https://` address.

**1. Build the agent** (on a computer with this repository)

```bash
pnpm install
pnpm --filter @kwtech/print-agent bundle
```

That writes one file, `apps/print-agent/dist/bundle/print-agent.mjs`.

**2. Put it on the shop's computer**, in a folder that will stay, with the one
library it does not carry inside it. In PowerShell:

```powershell
mkdir C:\kwtech-print-agent
cd C:\kwtech-print-agent
npm init -y
npm install pdf-to-printer@5.8.1
# then copy print-agent.mjs into this folder
```

`pdf-to-printer` brings SumatraPDF, which does the printing. Nothing else is
installed, and nothing is added to Windows.

**3. Tell it where the server is.** In that folder, make a file named
`.env.local`:

```ini
API_URL="https://app.example.com/api/v1"
WS_URL="wss://app.example.com/api/v1/graphql"
```

- Both must name the same host and port. `WS_URL` is `API_URL` with `ws` for
  `http` and `/graphql` on the end.
- For a server on this same computer: `http://localhost:8080/api/v1` and
  `ws://localhost:8080/api/v1/graphql`. Windows reaches a server running in
  WSL through `localhost`.
- Anywhere but `localhost` they must be `https://` and `wss://`, or the agent
  refuses to start.
- Every other setting is optional; see "Settings" below.

**4. Check it sees the printers**, before pairing:

```powershell
node print-agent.mjs printers
```

It lists each printer with its paper types and qualities, and asks no server.
It takes about half a minute.

**5. Pair it with a workspace.** In the web app, open the workspace's
**Printers** page, press **Add a computer**, and name it. That needs
`print:manage_agents`, which workspace admins hold. On the computer:

```powershell
node print-agent.mjs pair ABCDE-FGHJK
```

The code works once, for ten minutes. A workspace may have 2 paired computers
unless its plan says otherwise.

**6. Start it, and leave it running.**

```powershell
node print-agent.mjs start
```

It logs `Connected.` and then `Reported N printer(s)`, and the computer shows
Online on the Printers page. Printing works only while this is running.

**7. Test each printer.** On the Printers page press **Test print** on a
printer and measure the page: both lines the length it says, the corner 20 mm
from the left edge and 30 mm from the top. If they are not, see "Printing"
below: the queue's own preferences in Windows are resizing the page.

### Starting it with Windows

⚠ Not tried here; these are Windows' own steps. In **Task Scheduler**, create
a task that runs **at log on** of the user who paired it, with program `node`,
arguments `print-agent.mjs start`, and "Start in" set to the agent's folder.
The pairing is kept per Windows user (`%APPDATA%\kwtech-print-agent`), so the
task must run as the user who ran `pair`, or `PRINT_AGENT_STATE_DIR` must
point somewhere both can read.

### Updating it

Build the bundle again, stop the agent, replace `print-agent.mjs`, and start
it. The pairing and the settings are in other files and are kept.

### Moving or removing a computer

- **Stop it printing for the workspace:** press **Revoke** on its card. The
  running agent notices within 30 seconds and exits.
- **Pair it again, or with another workspace:** `node print-agent.mjs unpair`
  on it, then pair with a new code. A computer is paired with one workspace
  at a time.

### One computer, several workspaces

Not supported yet: an agent holds one pairing, and `pair` refuses a second.
Building it properly (one agent, several pairings, one line of jobs) is put
off and described in PLAN §12.116.

⚠ Untried stopgap: a copy of the agent per workspace, each in its own folder
with its own `PRINT_AGENT_STATE_DIR`. The copies do not know of each other, so
two jobs can reach one printer at the same moment, and one that sets a paper
type or quality could pass its settings to the other.

### When it does not work

| It says, or you see | Why | Do |
|---|---|---|
| `The server at … could not be reached` | `API_URL` is wrong, or the computer has no way to it | open that address in a browser on the same computer |
| `The server did not accept that code` | mistyped, used already, older than ten minutes, or the workspace has all the computers it may | make a new code; revoke a computer if the workspace is full |
| `This computer is already paired` | it holds a pairing | `unpair`, and revoke the old one in the web app |
| `The print agent's settings are not valid` | `.env.local` is missing a line, or uses `http://` away from `localhost`, or names two servers | fix the file; the message says which line |
| `Not paired` on `start` | `pair` was run as another Windows user, or with another state folder | pair as the user who starts it |
| The computer shows Offline in the web app | the agent is not running, or cannot reach `WS_URL` | start it; read its last lines |
| It stops with "revoked in the web app" | somebody pressed Revoke | `unpair`, then pair again |
| A printer is missing | Windows does not list it, or it is a name in `PRINT_AGENT_EXCLUDE_PRINTERS` | install it in Windows; the list is read again every 5 minutes |
| Fax and "Print to PDF" queues are listed | Windows lists them as printers | name them in `PRINT_AGENT_EXCLUDE_PRINTERS` |
| A print comes out a little large or small | the queue's Printing Preferences in Windows fit the page onto another paper | set the queue's paper to the one loaded and turn off Reduce/Enlarge; test print again |
| A print uses the wrong paper type | none was chosen, so the queue's own was used | choose one in the studio's print dialog, or set the queue's in Windows |

## Commands

On a shop's computer every command is run as `node print-agent.mjs <command>`
from the agent's folder.


```
print-agent pair <code>   pair this computer, with the code from the web app
print-agent start         connect, stay connected, and print what is sent
print-agent printers      list the printers this computer would report (asks no server)
print-agent status        say whether this computer is paired, and to what
print-agent unpair        forget the pairing on this computer
```

In the repository: `pnpm --filter @kwtech/print-agent build`, then
`pnpm --filter @kwtech/print-agent agent <command>` from `apps/print-agent`.
`pnpm --filter @kwtech/print-agent bundle` writes one file,
`dist/bundle/print-agent.mjs`, which needs only Node >= 22 beside it.

### Developing

`pnpm dev` and `pnpm start` at the repository root leave the agent out (their
scripts filter it), so that working on the web side does not pay for it in
memory. Run the server with `pnpm dev` or `pnpm dev:api`, and the agent in a
second terminal, from the repository root:

```
pnpm dev:print-agent              print-agent start, rebuilt and restarted on every edit
pnpm dev:print-agent printers     the same for another command
pnpm start:print-agent            build once, then print-agent start (no watching)
```

`dev:print-agent` is `scripts/dev.mjs`: `tsc --watch` beside `node --watch`. A
command that ends (not paired yet, revoked) is run again on the next edit, not
treated as a crash. Pair once, outside it:
`pnpm --filter @kwtech/print-agent agent pair <code>`. ⚠ An edit to
`@kwtech/module-print` reaches the running agent only when something rebuilds
that package (`pnpm dev`, or its own `dev`).

⚠ Settings come from `.env.local` here, not from the shell: turbo does not
pass a variable it was not told about on to the task.

`start` exits 2 when the server says the computer was revoked, and does not
try again: a revoked secret cannot become good.

## Settings

Copy `.env.example` to `.env.local` (or `.env`). The agent reads it from the
folder it is run in, else from the folder the program is in, so a startup task
needs no working folder set. Variables already set win over the file.

| Variable | Empty means | For |
|---|---|---|
| `APP_ENV` | `local` | which environment this is |
| `API_URL` | required | the server, `http://localhost:8080/api/v1` locally |
| `WS_URL` | required | its socket, `ws://localhost:8080/api/v1/graphql` locally |
| `PRINT_AGENT_STATE_DIR` | `%APPDATA%\kwtech-print-agent`, or `~/.config/kwtech-print-agent` | where the pairing is kept |
| `PRINT_AGENT_EXCLUDE_PRINTERS` | the ones Windows adds itself (Print to PDF, XPS, Fax, OneNote) | exact names never reported, comma separated; `none` reports all |
| `PRINT_AGENT_DRIVER` | `windows` on Windows, `fake` elsewhere | `fake` invents two printers, for developing inside WSL |

## What it refuses, and why

- **A plain `http://` or `ws://` URL anywhere but localhost.** The secret
  crosses that connection every time.
- **A `WS_URL` on another host or port than `API_URL`.** The secret `API_URL`
  issued is presented to `WS_URL`.
- **An `API_URL` other than the one it was paired with.** Unpair and pair
  again; the secret is not sent to another server.
- **Pairing twice.** `unpair` first, and revoke the old one in the web app.

## The secret

Issued by the server at pairing, never typed, never printed by any command,
and not a setting. It is kept in `agent.json` in the state folder, in the
clear, mode 0600 where the system honours one. ⚠ Anybody who can read that
user's files can act as this computer until it is revoked in the web app
(PLAN §12.113).

## While connected

- A heartbeat every 30 s. One left unanswered for 30 s ends the connection
  and the agent reconnects: a socket can die without closing.
- The printers are read at connect and every 5 minutes, and sent only when
  they changed. A printer Windows describes in a way the server would refuse
  is left out and named in the log, so one bad driver does not hide the rest.
- A lost connection is retried after 2 s, doubling to 60 s.

## Printing

- A job arrives on the socket. The agent fetches its file from the server
  over HTTP, presenting its secret, and checks the length against the job's.
- **One job at a time, in the order they came.**
- The file is on this computer's disk **only while it prints**: in a folder
  made for that one job in the system's temporary folder, removed afterwards
  whether it printed, failed or threw.
- It is printed at actual size (`noscale`) on the paper the job names, which
  is one this printer reported. ⚠ Windows' "User-Defined" paper is never
  reported: it is whatever size was last typed into the driver.
- ⚠ **"Actual size" depends on the queue's own preferences in Windows, and
  the agent does not check them.** A queue set to fit pages onto another
  paper (Epson: Reduce/Enlarge, or a custom paper saved as its Document
  Size) resizes every job: an A4 photo came out 2.8% large on a queue saved
  with a 8.5 × 13 inch paper. Set the queue's paper to the one it is loaded
  with and turn resizing off, in its Printing Preferences. A ruler page from
  the Printers page shows whether a queue is right.
- **A paper type and a quality**, when the job names them, are set on the
  queue for that one job and put back afterwards, printed or failed. They
  are the driver's own (`print-agent printers` lists them, the current one in
  brackets). ⚠ For those seconds anything else this Windows user prints on
  that queue gets them too, and an agent killed in between leaves the queue
  as the job set it (PLAN §12.115). A setting that cannot be set stops the
  job: glossy printed as plain is a ruined sheet.
- The driver decides the resolution, and may not do a combination at all;
  the log then says what it printed with instead. "Sent" means Windows took the job, ⚠ not that
  paper came out.
- A job another socket of this computer already took is skipped, not failed.
- With `PRINT_AGENT_DRIVER=fake` nothing is printed: the log says the file's
  length and SHA-256, which is how to check that what arrived is what was sent.

## Windows

Printers are read by PowerShell 5.1 (`powershell.exe`) through .NET and
`DeviceCapabilities`; nothing is installed and nothing is changed. The agent
must run under **Windows** Node: WSL does not see Windows printers. Reading
takes about half a minute for ten queues.

## Tests

`pnpm --filter @kwtech/print-agent test`. The socket and PowerShell are seams
(`open` in `run.ts`, `run` in `printers/windows.ts`), so the suite needs
neither a server nor a printer. ⚠ Not covered by any test: the PowerShell
script itself, and a job through the Windows driver onto paper.

Proven by hand on 2026-10-07: under Windows Node, paired with a server in WSL
over `localhost`, a ruler page on A4 on an Epson L5290 (network, Epson's
driver) and on a USB Epson through Windows' generic class driver. Both
measured accurate.

Run for real on 2026-10-07, by a script and not by this suite, with the fake
driver against the local server: pairing, the socket, a 24 MB file through
the web app's handler arriving with the same SHA-256, each refusal, and a
revoked agent stopping by itself with exit 2.
