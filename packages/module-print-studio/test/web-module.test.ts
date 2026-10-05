import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { composeApps, composeNav, composeRoutes } from '@kwtech/module-kit';
import { STUDIO_FEATURE, STUDIO_LIMIT } from '../src/feature-keys.js';
import { studioWebModule } from '../src/react/module.js';
import { StudioApp } from '../src/react/studio-app.js';

/** What adopting the print studio on the web contributes. */
describe('studioWebModule', () => {
  const module = studioWebModule();

  it('offers the studio on the Apps page, gated on studio:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({
        key: 'studio',
        label: 'Print Studio',
        feature: STUDIO_FEATURE.read,
        component: StudioApp,
      }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts of the Apps page', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['studio']);
  });

  it('⚠ has no route and nothing in the drawer — a sub-app is reached from the Apps page', () => {
    expect(composeRoutes([module])).toEqual([]);
    expect(composeNav([module], [STUDIO_FEATURE.read], { params: {} })).toEqual([]);
  });

  it('carries its keys and its cap, so an app composing descriptors sees them', () => {
    expect(module.features?.map((spec) => spec.key)).toEqual(Object.values(STUDIO_FEATURE));
    expect(module.limits?.map((spec) => spec.key)).toEqual(Object.values(STUDIO_LIMIT));
  });
});

/**
 * ⚠ PRINT AND GO, TURNED INTO A RED BUILD (PRINT-STUDIO-PLAN decision 8).
 *
 * Photos and results live in the tab's memory. These read the web half's SOURCE
 * for the three ways a file could leave it or outlive the page, so adding one
 * is a failing test and a conversation rather than a quiet change.
 */
describe('the web half keeps files in memory', () => {
  const root = join(__dirname, '..', 'src', 'react');
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/u.test(name) ? [path] : [];
    });
  }
  /** Code only: a comment may NAME localStorage to say it is not used. */
  const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const files = sources(root);

  it('finds the web half — the walk has to work for this suite to mean anything', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('⚠ writes nothing to browser storage', () => {
    for (const path of files) {
      expect([path, /localStorage|sessionStorage|indexedDB|caches\.open|showSaveFilePicker/u.test(code(path))]).toEqual(
        [path, false],
      );
    }
  });

  it('⚠ reaches the network from the API client alone, and that client sends JSON', () => {
    const callers = files.filter((path) => /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket\(/u.test(code(path)));
    expect(callers.map((path) => path.slice(root.length + 1))).toEqual(['studio-client.ts']);
    const client = code(join(root, 'studio-client.ts'));
    expect(/FormData|Blob|File\b|arrayBuffer/u.test(client)).toBe(false);
  });
});
