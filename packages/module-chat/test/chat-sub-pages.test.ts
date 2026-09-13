import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeRoutes } from '@kwtech/module-kit';
import { CHAT_HREF, chatWebModule } from '../src/react/module.js';

/**
 * ── EVERY SUB-PAGE HAS A WAY BACK ──────────────────────────────────────────
 *
 * ⚠ THIS TEST EXISTS BECAUSE ONE DID NOT. `/chat/preferences` shipped with no
 * way back to chat, and it was found by somebody using it rather than by
 * anything here. The back link lived in a private `Frame` inside
 * `chat-settings-page.tsx`, so a new page written as a new file simply did not
 * have one — you cannot forget a component you never knew existed.
 *
 * The fix was to make the frame shared (`ChatSubPage`). This is what stops the
 * next page from skipping it: a convention that lives in one file is a habit,
 * and a habit is exactly what a new file does not inherit.
 *
 * ⚠ It reads SOURCE rather than rendering, deliberately. Nothing in this repo
 * runs a browser or a React renderer, and the property worth protecting is
 * structural — "this file uses the frame" — not visual. `tenant-routes.test.ts`
 * in `module-permissions` reads its own source for the same kind of reason.
 */

// ⚠ `__dirname`, like `web-module.test.ts` and `surface-coverage.test.ts`:
// this suite compiles to CommonJS, where `import.meta` does not exist.
const PAGES_DIR = join(__dirname, '..', 'src', 'react', 'pages');

/** Every route this module contributes that is NOT the chat page itself. */
const subRoutes = composeRoutes([chatWebModule()]).filter((route) => route.path !== CHAT_HREF);

describe('chat sub-pages', () => {
  it('contributes at least one sub-page, or this test is asserting nothing', () => {
    expect(subRoutes.length).toBeGreaterThan(0);
  });

  /**
   * ⚠ THE ASSERTION THAT WOULD HAVE CAUGHT IT. Every page component under
   * `pages/` other than the chat page itself must render `ChatSubPage`, which
   * is where the back link lives.
   */
  it('⚠ every sub-page renders ChatSubPage, which is what carries the way back', () => {
    const offenders: string[] = [];

    for (const file of readdirSync(PAGES_DIR)) {
      // The chat page is the destination, not a sub-page — it needs no way back
      // to itself, and the drawer entry is how somebody arrives.
      if (!file.endsWith('.tsx') || file === 'chat-page.tsx') continue;

      const source = readFileSync(join(PAGES_DIR, file), 'utf8');
      if (!source.includes('<ChatSubPage')) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  /**
   * ⚠ The link names its DESTINATION, not a direction. "← Back" tells somebody
   * which way they are going and not where they end up, which is the wrong half
   * when they have forgotten how they arrived.
   */
  it('⚠ names where the link goes, and points at the chat page', () => {
    const frame = readFileSync(join(PAGES_DIR, '../components/chat-sub-page.tsx'), 'utf8');

    expect(frame).toContain('Back to chat');
    // The href comes from the shared constant, so the route and the link to it
    // cannot drift apart.
    expect(frame).toContain('href={CHAT_HREF}');
  });

  /**
   * ⚠ A PLAIN ANCHOR, never `next/link`. This package declares React as an
   * optional peer and Next as nothing at all — importing `next/link` anywhere
   * in it would make every consumer a Next app.
   */
  it('⚠ uses a plain anchor rather than a framework link', () => {
    const frame = readFileSync(join(PAGES_DIR, '../components/chat-sub-page.tsx'), 'utf8');

    // ⚠ Matches an IMPORT, not the string — the file's own comment explains why
    // next/link is not used, and a bare `toContain` check fails on the prose.
    expect(frame).not.toMatch(/^\s*import .*['"]next\/link['"]/m);
  });
});
