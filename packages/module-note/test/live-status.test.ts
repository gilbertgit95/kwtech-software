import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Not live" is the SOCKET'S state, by this module's own threshold (issue
 * #64). There are no React render tests here (testing rules), so the wiring is
 * checked by reading the source, as the sub-page suites do; the rule itself is
 * module-kit's `isRealtimeLive`, tested there.
 *
 * ⚠ `__dirname`: this suite compiles to CommonJS, where `import.meta` does not exist.
 */
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('live status — the socket’s state, by this screen’s threshold (#64)', () => {
  const hook = read('src/react/use-notes.ts');

  it('declares its own threshold', () => {
    expect(read('src/react/use-notes.ts')).toMatch(/const NOTES_NOT_LIVE_AFTER_MS = 10_000;/);
  });

  it('takes live from useRealtimeLive with that threshold', () => {
    expect(hook).toMatch(/useRealtimeLive\(NOTES_NOT_LIVE_AFTER_MS\)/);
  });

  it('⚠ never reads "the app has a connection" as live — true while a socket times out forever (#50)', () => {
    expect(hook).not.toMatch(/live:\s*realtime\s*!==\s*null/);
  });

  it.each([
    ['the full screen', 'src/react/note-app.tsx'],
    ['the phone', 'src/mobile/notes-mobile-app.tsx'],
  ])('says so on %s', (_label, path) => {
    expect(read(path)).toMatch(/!(state\.)?live\b/);
  });
});
