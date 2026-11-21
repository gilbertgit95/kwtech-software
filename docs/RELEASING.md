# Releasing

kwtech has **one version** for the API, the web app, the print agent and every
module (#204). It is raised by [changesets](https://github.com/changesets/changesets),
and its release notes are written by the people who made each change, for the
shops that read them before updating.

## 1. In every PR: a changeset

```bash
pnpm changeset            # which packages, patch / minor / major, one sentence
pnpm changeset --empty    # nothing a shop needs to know (tests, CI, a refactor)
```

Commit the file it writes in `.changeset/`. CI's **Changeset** check fails a PR
that changes a package (anything under `apps/*` or `packages/*`) without one,
and says which command to run. A PR that touches only the root (docs, CI,
`scripts/`) needs none.

| Choose | When | Example sentence |
|---|---|---|
| **patch** | something was wrong and now works | "Receipts no longer cut off the last line on 58 mm paper." |
| **minor** | something new, nothing a shop must do | "Bookings can repeat every week." |
| **major** | a shop must notice or act: something removed or changed in how they work | "Discounts are now set per item, not per order; check your price list after updating." |

The sentence goes into the release notes as written: plain English, about what
a person using the app sees. Not the commit title.

Which packages you pick does not change the version: every `@kwtech/*` package
is in one `fixed` group (`.changeset/config.json`), so all of them move to the
same number. Pick the ones you changed, so the history says where.

## 2. The version PR (automatic)

After a merge to `main` with changesets pending, the **Release** workflow
(`.github/workflows/release.yml`) opens or updates one PR,
**chore(release): kwtech <version>**, from `changeset-release/main`. It holds:

- the next version on every package and the root `package.json`;
- one new section at the top of `CHANGELOG.md`, the sentences grouped under
  *Needs your attention*, *New* and *Fixed* (`scripts/release-version.mjs notes`);
- the changesets removed.

It shows no CI checks: GitHub starts no workflows for a PR the workflow's own
token opened. It changes only versions and `CHANGELOG.md`.

## 3. Releasing: merge the version PR

Read `CHANGELOG.md` in the PR, fix a sentence there if needed, and merge it.
The Release workflow then tags `v<version>` and creates the GitHub release
**kwtech <version>** with that section as its notes. Nothing else to do.

Not ready to release? Leave the PR open: later merges add to it.

## By hand, if ever needed

```bash
pnpm changeset:version                  # what the version PR does, locally
node scripts/release-version.mjs        # the current version
node scripts/release-version.mjs check  # every package on one version
```

## One-time setting

The workflow needs **Settings → Actions → General → Workflow permissions →
"Allow GitHub Actions to create and approve pull requests"** turned on, or the
version PR step fails with "GitHub Actions is not permitted to create or
approve pull requests".

## Not yet

Showing the version in the app (the health endpoint, the Server pages), the
print agent reporting it, and building the Docker images and the print agent
zip on each release are #133 (P2 and P5).
