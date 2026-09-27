'use client';

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * A note's body, rendered.
 *
 * ## ⚠ What it will not render
 *
 * - **Raw HTML** (`skipHtml`): a shared note is written by one member and read
 *   by the rest, and HTML in it would be script in their browsers.
 * - **Images**, as images. `![](https://tracker.example/x.png)` in a shared note
 *   would load a remote file from every reader's browser — their address and
 *   the moment they opened it, handed to whoever wrote the URL. An image is
 *   shown as a link to itself instead (NOTE-PLAN §9).
 * - **Unsafe link protocols**: react-markdown's default URL filter drops
 *   `javascript:` and friends. It is left in place on purpose — overriding
 *   `urlTransform` would switch it off.
 *
 * ## Rhythm
 *
 * Every block is one rule per line of text and leaves whole rules below it
 * (`NOTE_PROSE_RHYTHM`), so writing sits on the Notebook's lines. Hence
 * `leading-(--note-rule)` and `mb-(--note-rule)` everywhere, and no padding
 * that is not a multiple of the rule.
 *
 * Loaded lazily (see `note-page.tsx`): the parser is only needed when a note is
 * previewed, and it is ESM-only, which the test runner never has to load.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-(--note-rule)">{children}</p>,
  h1: ({ children }) => <h2 className="text-[1.3em] font-semibold">{children}</h2>,
  h2: ({ children }) => <h3 className="text-[1.2em] font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="text-[1.1em] font-semibold">{children}</h4>,
  h4: ({ children }) => <h5 className="font-semibold">{children}</h5>,
  h5: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  h6: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  ul: ({ children }) => <ul className="mb-(--note-rule) list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="mb-(--note-rule) list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-(--note-rule) border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="mb-(--note-rule) overflow-x-auto rounded-sm bg-muted/60 font-mono text-[0.9em]">{children}</pre>
  ),
  code: ({ children }) => <code className="rounded-sm bg-muted/60 font-mono text-[0.9em]">{children}</code>,
  // A rule is one line tall with the line drawn through its middle.
  hr: () => <hr className="my-[calc(var(--note-rule)/2_-_0.5px)] border-border" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-primary underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),
  // ⚠ Never an <img>: see above.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">
        {alt ? `Image: ${alt}` : 'Image'}
      </a>
    ) : null,
  table: ({ children }) => (
    <div className="mb-(--note-rule) overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border px-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/60 px-2">{children}</td>,
  input: ({ checked }) => (
    // GFM task list boxes, shown and not editable: ticking one would be an edit
    // that bypasses the editor's draft and its version.
    <input type="checkbox" checked={checked ?? false} readOnly disabled className="mr-1.5 align-middle" />
  ),
};

export function NoteMarkdown({ body }: { body: string }) {
  return (
    <div className="leading-(--note-rule) wrap-break-word">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={COMPONENTS}>
        {body}
      </Markdown>
    </div>
  );
}
