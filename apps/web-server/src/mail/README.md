# Email templates

Everything a recipient reads lives in `templates/`. The code passes **facts** — a
name, a URL, a duration — and the template writes the sentences.

```
templates/
  layout.html          the shell every email shares
  password-reset.html  the body
  password-reset.txt   the plain-text twin, and the source of the subject
render.ts              renderEmail(name, data) → { subject, html, text }
```

## Adding an email

1. Write `templates/<name>.html` and `templates/<name>.txt`.
2. Add `'<name>'` to `EmailData` in `render.ts` with the values it needs.
3. Call `renderEmail('<name>', { … })` and hand the result to nodemailer.

The `EmailData` entry is what makes the compiler complain if a template and its
caller drift apart — and adding it is the reminder to write the `.txt` twin.

## Rules that are not style preferences

**Escape every interpolation.** `<%= %>` escapes, `<%~ %>` does not. Use the
second one only on markup a template wrote itself. Values like `displayName` are
free text the account holder chooses; unescaped, a display name of
`<a href="https://evil.example">Reset here</a>` renders as a live link inside a
genuine, DKIM-signed email. Clients strip `<script>`; they do not strip anchors.
This was a real bug here, and `test/render.test.ts` exists to keep it fixed.

**Comment with `<% /* … */ %>`, never `<!-- … -->`.** HTML comments are not
stripped — they are delivered. The first version of these templates sent 922 of
4005 characters of engineering notes to every recipient. Gmail also clips a
message at ~102KB and hides the rest behind "View entire message", which for a
reset email would mean hiding the button.

**Always ship both parts.** HTML-only mail scores badly with spam filters, and
the `.txt` renders through a second Eta instance with escaping *off* — there is
no markup to escape into, and escaping it is how text alternatives end up
showing `&#39;` to a reader.

**Write 1999 HTML on purpose.** Tables, not flexbox: Outlook on Windows renders
mail with Microsoft Word's engine. Inline styles, not a `<style>` block: Gmail
drops `<head>` when it clips. No web fonts, no external images, no JavaScript.
Colours are literal hex rather than `@kwtech/web-ui` tokens — a CSS variable has
nothing to resolve against in an inbox, so keeping them in step with the brand is
a manual job.

## Two things that fail silently

- `tsc` copies nothing but JavaScript. These files reach `dist/` only because of
  the `assets` entry in `nest-cli.json`. Remove it and they compile fine and are
  absent at runtime.
- Biome parses `.html` and rejects `<%` as an unescaped `<`, and a file it cannot
  parse is one it silently stops checking. `biome.jsonc` excludes this directory
  explicitly for that reason.

## Previewing

There is no preview server. `renderEmail` is a pure function, so the fastest
look at a change is a test or a one-liner against `dist/`:

```bash
pnpm --filter @kwtech/web-server build
cd apps/web-server && set -a && . .env && set +a && node -e "
  import('./dist/mail/render.js').then(({renderEmail}) => {
    const m = renderEmail('password-reset', { displayName: 'Ada', url: 'https://x.test/r?token=t', expiresIn: 'one hour' });
    require('node:fs').writeFileSync('/tmp/preview.html', m.html);
    console.log(m.subject); console.log(m.text);
  })"
```

To watch what actually goes over the wire — headers, MIME structure, both parts —
point `SMTP_URL` at a local sink: `docker run -d -p 1025:1025 -p 8025:8025
axllent/mailpit` gives you one with a web UI on :8025.
