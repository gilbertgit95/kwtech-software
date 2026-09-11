import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeNav, composeRoutes } from '@kwtech/module-kit';
import { chatIsEnabled } from '../src/enabled.js';
import { CHAT_FEATURE } from '../src/feature-keys.js';
import { CHAT_HREF, chatWebModule } from '../src/react/module.js';

/**
 * What adopting chat on the web actually contributes — and what switching it
 * off does and does not take away.
 *
 * ⚠ The second half is the one worth having. A disable that also dropped the
 * FEATURE REGISTRY would make the host's feature sync deprecate every `chat:*`
 * row, and a deprecated feature grants nothing — so flipping a flag for an
 * afternoon would silently strip chat rights from every role holding them, and
 * flipping it back would not return them.
 */

describe('chatWebModule', () => {
  it('contributes the route and its drawer entry, with the unread badge on it', () => {
    const module = chatWebModule();

    expect(composeRoutes([module]).map((route) => route.path)).toEqual([CHAT_HREF]);

    const [entry] = composeNav([module], [CHAT_FEATURE.read]);
    expect(entry?.href).toBe(CHAT_HREF);
    // The count lives on the drawer entry and nowhere else: chat puts nothing
    // in the app's main header, because the drawer already leads there and two
    // doors to one place is how somebody learns to wonder which is the real
    // one.
    expect(entry?.Badge).toBeDefined();
  });

  it('⚠ contributes NOTHING to the app header', () => {
    // A regression guard with a product decision behind it, not a style one.
    expect(chatWebModule()).not.toHaveProperty('headerSlots');
  });

  it('⚠ takes the badge away with the entry when the key is not held', () => {
    // The badge SUBSCRIBES. One that outlived its entry's filter would be a
    // live query running for somebody the API refuses.
    const module = chatWebModule();

    expect(composeRoutes([module])[0]?.feature).toBe(CHAT_FEATURE.read);
    expect(composeNav([module], [])).toEqual([]);
  });

  it('declares its features and its cap', () => {
    const module = chatWebModule();

    expect(module.features?.map((feature) => feature.key)).toContain(CHAT_FEATURE.read);
    expect(module.limits?.length).toBeGreaterThan(0);
  });
});

describe('chatWebModule({ enabled: false })', () => {
  const off = chatWebModule({ enabled: false });

  it('contributes no route and no drawer entry', () => {
    expect(composeRoutes([off])).toEqual([]);
    expect(composeNav([off])).toEqual([]);
  });

  it('⚠ KEEPS the feature registry, so a disable does not deprecate the keys', () => {
    // Dropping them would strip `chat:*` from every role that holds it, and
    // re-enabling would not put them back. Disabling must be reversible by
    // flipping one flag.
    expect(off.features?.map((feature) => feature.key)).toContain(CHAT_FEATURE.read);
    expect(off.limits?.length).toBeGreaterThan(0);
  });
});

describe('chatIsEnabled', () => {
  it('defaults to ON — a host that composed the module meant to have it', () => {
    expect(chatIsEnabled()).toBe(true);
    expect(chatIsEnabled({})).toBe(true);
    expect(chatIsEnabled({ enabled: true })).toBe(true);
  });

  it('is off only when someone says so', () => {
    expect(chatIsEnabled({ enabled: false })).toBe(false);
  });

  it('⚠ is the SAME reader the Nest module uses', () => {
    /*
     * The two halves of the module must not disagree about what "on" means: a
     * web descriptor that contributed a route while the server registered no
     * resolver would give a reader a page that answers nothing.
     *
     * Read out of the SOURCE rather than by importing the Nest module, which
     * would pull `@nestjs/common` and a container into a test about a flag.
     * `__dirname`, like `surface-coverage.test.ts`: this suite compiles to
     * CommonJS, where `import.meta` does not exist.
     */
    const source = readFileSync(join(__dirname, '..', 'src', 'server', 'chat.module.ts'), 'utf8');
    expect(source).toContain('chatIsEnabled(options)');
  });
});
