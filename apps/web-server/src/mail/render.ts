import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import { env } from '../config/env.js';

/**
 * Turns a template plus some facts into a message.
 *
 * ## Why the copy is in files and not in this file
 *
 * Everything a recipient reads lives in `templates/`. The code passes VALUES —
 * a name, a URL, a duration — and the template writes the sentences. That is
 * the whole split, and it is what lets the wording of a security email be
 * reviewed as content rather than diffed out of a string concatenation.
 *
 * ## Escaping is the property that matters, not the file extension
 *
 * The naive version of "templates in .html files" is `.replace('{{url}}', url)`,
 * which has exactly the hole that string concatenation had: `displayName` is
 * free text the account holder chooses, and unescaped it renders as live markup
 * inside a genuine, DKIM-signed password-reset email — a phishing primitive
 * handed to anyone who can edit their own profile.
 *
 * Eta escapes `<%= %>` by default. `<%~ %>` is the deliberate opt-out and is
 * used in exactly one place: inserting an already-rendered body into the layout.
 *
 * ## Two engines, on purpose
 *
 * The `.txt` twin is rendered with escaping OFF. There is no markup in a plain
 * text part, so escaping it would put `&amp;` and `&#39;` in front of a reader —
 * the classic way text alternatives end up looking broken.
 */

const html = new Eta({ autoEscape: true, autoTrim: false });
const text = new Eta({ autoEscape: false, autoTrim: false });

/**
 * `import.meta.url`, never `process.cwd()`.
 *
 * The working directory of a container is whatever the entrypoint chose; this
 * resolves relative to the compiled file itself, which is the only thing that
 * survives being started from somewhere else. See the `assets` entry in
 * nest-cli.json for how these files reach `dist/` at all — tsc copies nothing
 * but JavaScript, so without it these templates compile fine and are simply
 * absent at runtime.
 */
const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');

/**
 * Read once, then kept. Templates do not change between deploys, and re-reading
 * from disk per email would put synchronous I/O on the send path.
 *
 * Loaded LAZILY rather than at import: a missing template should fail when the
 * first email is sent, not take the whole API down at boot — mail is not on the
 * critical path for serving requests.
 */
const cache = new Map<string, string>();

function source(file: string): string {
  let contents = cache.get(file);
  if (contents === undefined) {
    contents = readFileSync(join(TEMPLATE_DIR, file), 'utf8');
    cache.set(file, contents);
  }
  return contents;
}

/**
 * What each template needs. The keys are the filenames without an extension, so
 * a template and its data shape cannot drift apart without the compiler saying
 * so — and adding an email means adding a line here, which is the reminder to
 * write the `.txt` twin as well.
 */
export interface EmailData {
  'password-reset': {
    /** Free text the user chose. Escaped by the template; never trust it. */
    displayName: string | null;
    url: string;
    /** Rendered as a phrase — "one hour" — because a reader is not parsing seconds. */
    expiresIn: string;
  };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * The `Subject:` line lives at the top of the `.txt` template, followed by a
 * blank line — the shape of an actual message.
 *
 * It is copy, so it belongs with the copy. Keeping it in TypeScript would mean
 * the one line of an email a recipient definitely reads was the one line an
 * editor could not find, and holding it in the text template rather than in
 * both means the HTML and text parts cannot disagree about it.
 */
function splitSubject(rendered: string): { subject: string; body: string } {
  const match = /^Subject:[ \t]*(.*?)\r?\n\r?\n/.exec(rendered);
  if (!match?.[1]) {
    throw new Error('An email template must begin with "Subject: …" followed by a blank line');
  }
  return { subject: match[1].trim(), body: rendered.slice(match[0].length) };
}

export function renderEmail<K extends keyof EmailData>(name: K, data: EmailData[K]): RenderedEmail {
  // `brand` is added here rather than asked of every caller: it is the same on
  // every message, and a per-call argument is a per-call chance to omit it.
  const context = { ...data, brand: env.MAIL_BRAND };

  const { subject, body: plain } = splitSubject(text.renderString(source(`${name}.txt`), context));

  const rendered = html.renderString(source(`${name}.html`), { ...context, subject });
  const wrapped = html.renderString(source('layout.html'), {
    ...context,
    subject,
    // Raw, and the only `<%~ %>` in the templates: this is markup the body
    // template produced, having escaped its own interpolations already.
    body: rendered,
    // The grey line an inbox shows next to the subject. Taken from the text
    // part's first sentence so it can never contradict what the email says.
    preheader:
      plain
        .split('\n')
        .find((line) => line.trim().length > 0 && !line.startsWith('Hi'))
        ?.trim() ?? '',
  });

  return { subject, html: wrapped, text: plain };
}
