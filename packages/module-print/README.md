# @kwtech/module-print

A workspace's **printing side**, run as a sub-app on the Apps page ("Printers").
A shop's computer is **paired** with a workspace and runs the print agent
(`apps/print-agent`); it reports the printers its operating system has
installed, and prints the PDFs the workspace sends it.

**A file is never saved on the server.** A print job's PDF crosses it through
an in-memory relay: the browser's upload is piped into the computer's download
and nothing is written anywhere (PLAN §13, 2026-10-07). ⚠ So the computer must
be online at that moment, and a job cannot wait in a queue.

The plan: `docs/PRINT-STUDIO-PLAN.md` §10. Running a computer:
`apps/print-agent/README.md`.

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
import { printWebModule } from '@kwtech/module-print/react';
const FEATURE_MODULES = [..., printWebModule()];

// app/api/print/jobs/[jobId]/content/route.ts — where the browser sends a job's file
import { createPrintRelayRouteHandlers } from '@kwtech/module-print/next';
export const { PUT } = createPrintRelayRouteHandlers();
```

- One sub-app (key `print`, "Printers"), no routes and nothing in the drawer.
- The page: one line of how things stand ("1 of 2 computers online · 3
  printers ready"), a card per computer with its printers as tiles, and two
  dialogs. **Add a computer** walks through naming it, typing the code (with
  copy buttons) and seeing it arrive. **Test print** on a printer's tile
  prints the ruler page and says what to measure. Papers, paper types and
  qualities are behind "Details" on each tile.
- ⚠ **Keep the app's proxy (middleware) off `/api/print`.** Next reads a
  request's body to run a proxy over it, up to a size limit, and a file past
  the limit arrives cut short. No session is read there: the one-time ticket
  is the authorisation.
- The route handler reads `API_URL` and answers 503 without it.
- `printWebModule({ wsUrl })`: the server's socket address as a computer
  outside reaches it. The page's **Setup guide** shows it, and the API's
  address worked out from it (`agentServerSettings`), as the two lines of the
  agent's settings file. Left out, the guide shows them blank; it never
  guesses. The guide itself is the short form of
  `apps/print-agent/README.md`, "Setting up a computer".

### Printing for another module

`createPrintTarget()` is this module as somewhere another module can print to:
the printers a person may choose, and "put this PDF on that one". The print
studio declares a port of that shape and the app binds the two, in a client
file (`apps/web-app/src/app/providers.tsx`):

```tsx
const STUDIO_PRINTER = createPrintTarget();
<StudioPrinterProvider printer={STUDIO_PRINTER}>{children}</StudioPrinterProvider>
```

- Each printer comes with its **settings** for one print: a list of things
  to choose (`Paper type`, `Quality`), each with the driver's own options and
  the one the printer is set to now. The caller shows them and hands back
  `settings: { mediaType, quality }` by key; it never learns what they mean.
- The caller gives the page's **size**, never a paper's name. The paper is
  found among those the printer reported (`paperForSize`, within 1 mm, either
  way round). ⚠ No paper of that size is a refusal with a sentence, never
  "print on whatever is loaded".
- One copy is asked for: the caller's PDF already holds every page it wants.
- `printers()` is empty for somebody the API refuses; `print()` never throws.

## In a NestJS app

```ts
const PRINT_SERVER_MODULE = printServerModule({
  prismaProvider: printPrismaProvider,
  prismaWriteProvider: printWritePrismaProvider,
  limitCheckerProvider: { provide: PRINT_LIMIT_CHECKER, useExisting: PermissionsLimitChecker },
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
});
```

| Port / option | Asked | Unbound means |
|---|---|---|
| `PRINT_PRISMA`, `PRINT_PRISMA_WRITE` | every read and write | the module cannot start |
| `PRINT_LIMIT_CHECKER` | when a pairing code is made and when it is used | the **declared default** cap (2), never unlimited |
| `expose: { graphql, rest }` | at start | both on. `rest` is the relay's two routes |

The app must also:

- **Admit the agent's socket.** A paired computer opens `graphql-ws` with its
  secret as a connection parameter and nobody signed in. Route the anonymous
  handshake by `isPrintAgentHandshake(params)` to `PrintAgentService.admit`
  (`app.module.ts`, `admitAnonymous`).
- Add the registries to `seed/registry.ts`, grant the presets in
  `seed/app-roles.ts` and sell the keys and the cap in `seed/plans.ts`.

⚠ **One server instance** (PLAN §12.114). The relay is in one process's
memory: the browser's request, the computer's request and the computer's
socket must all reach it.

## How a job travels

1. A person presses Print. `startPrintJob` checks the printer is this
   workspace's, still there, on a computer that is paired and **online**, and
   that the paper is one that printer reported. It answers a job id and a
   **one-time ticket**.
2. The computer hears of the job on its socket (`printAgentJobs`) and asks for
   the file: `GET /print/jobs/:id/content`, presenting its secret.
3. The browser sends the file: `PUT` to the app's handler, with the ticket,
   which passes the stream on to `PUT /print/jobs/:id/content`.
4. The relay pipes the one into the other. It lets through exactly the
   declared number of bytes of something that starts `%PDF-`.
5. The computer prints and says how it went (`reportPrintAgentJob`). The page
   reads the job (`printJob`) until it ends.

| A job's state | Means |
|---|---|
| `waiting` | opened; the two requests have not both arrived (30 s) |
| `sending` | the file is crossing |
| `printing` | the computer holds the whole file and has not said how it went (180 s) |
| `printed` | the computer's operating system **took** it. ⚠ Not "paper came out" |
| `failed` | with a reason: `agent_did_not_fetch`, `nothing_sent`, `not_a_pdf`, `wrong_size`, `interrupted`, `printer_refused`, `timed_out` |

A job's outcome is remembered for 5 minutes, in memory, for the person who
opened it and nobody else.

## Rules worth knowing

- **A code pairs one computer, once, within ten minutes.** It is shown once;
  the server keeps its hash. The secret it is exchanged for is 256 bits, kept
  hashed, and never shown by any command.
- **Every refusal of a credential is one answer.** A wrong code, a used one,
  an expired one and a full workspace are the same `null`; a wrong ticket, a
  spent one and somebody else's job are the same 404.
- **Revoked, never deleted.** A revoked computer is refused at the handshake
  and on its next heartbeat (within 30 s for an open socket).
- **Refused, not queued, when the computer is offline** (`agent_offline`).
- **At most 3 jobs under way per computer, 50 MB a file, 50 copies.**
- **The printers are a mirror** of what the computer reports, rewritten on
  every report. One that is no longer reported is marked gone, not deleted.
- **Margins a driver did not give are "not reported"**, never "borderless".
- **A printer's paper types and qualities are the driver's own lists**, with
  the driver's ids (`psk:Plain`, `ns0000:HighQuality`) and its names for a
  person. A job may name one of each (`startPrintJob`'s `mediaType` and
  `quality`); one it does not name stays as the printer is set. ⚠ A job
  naming one the printer never reported is refused (`invalid_job`): only the
  driver's own words reach its print ticket.
- **The driver has the last word on a combination.** It picks the resolution
  that goes with a paper type and quality, and may not do a pair at all (an
  Epson L110 prints plain paper at Standard whatever is asked). The agent's
  log says when what was printed is not what was asked; the web app does not.
- **"Actual size" is only as true as the queue's preferences in Windows.**
  A queue set there to fit pages onto another paper resizes every job, and
  nothing here checks for it (`apps/print-agent/README.md`, "Printing"). The
  ruler page on a printer's card is how to find out.
- **Windows' "user-defined" paper is never reported.** It is a slot whose size
  is whatever was last typed into the driver, not a paper a job can name.
- **The ruler page** (`rulerPagePdf`) is a vector PDF written by hand: two
  lines of a known length from a corner a known distance from the paper's
  edges. Printed from a printer's card, it proves that printer does not scale.
- `test/web-module.test.ts` fails if the web half touches browser storage, or
  reaches the network anywhere but its API client. `test/surface-coverage.test.ts`
  fails on a GraphQL operation that is neither bound to a key nor declared public.

## What it declares

| Key | Lets you |
|---|---|
| `print:read` | see the paired computers, their printers and whether they are online |
| `print:send` | send a file to a printer, and read how your own job went |
| `print:manage_agents` (privileged) | pair a computer and revoke one |

| Limit | Counts | Default |
|---|---|---|
| `print:agents` | paired computers per workspace, revoked ones left out | 2 |

Presets (`PRINT_ROLE_PRESETS`): `print-user` (read, send) and `print-admin`
(adds `print:manage_agents`). No background process, no notification.

Public surfaces, each with its reason: `pairPrintAgent` (also a credential
surface: a code is typed), the agent's four socket operations, and the two
relay routes.

## Not here yet

- Calibration through the agent, and a job's outcome in the studio's history
  (PLAN §12.112).
- Settings other than paper type and quality (colour or greyscale,
  borderless, the tray), and telling the person when a driver changed what
  they chose (PLAN §12.115).
- Receipts for other modules (PRINT-STUDIO-PLAN §11).
- Printing on anything but Windows: the agent's only real driver is the
  Windows one.
- Proof on paper beyond A4 portrait, which is all that has been measured
  (PRINT-STUDIO-PLAN §10).
