# Changesets

Every PR that changes a package carries a changeset: a small file here that
says what changed, for the people who will read the release notes (a shop's
owner deciding whether to update, not a developer).

```bash
pnpm changeset            # asks which packages, patch / minor / major, and the sentence
pnpm changeset --empty    # nothing to tell (tests, CI, a refactor): says so on purpose
```

- **One product version.** Every `@kwtech/*` package is in one `fixed` group
  (`config.json`), so a release is "kwtech 1.5.0" for all of them, whichever
  packages a changeset names. Nothing is published to npm.
- **patch** fixes something, **minor** adds something, **major** changes or
  removes something a shop relies on (an update needs their attention).
- **The sentence** is plain English, for the shop: "Receipts print the
  workspace's address", not "fix(module-basic-pos): address in header".
- CI fails a PR that changes a package with no changeset (`pnpm
  changeset:check`). The release workflow turns the pending changesets into
  the **Version Packages** PR; merging it is the release. See
  `docs/RELEASING.md`.
