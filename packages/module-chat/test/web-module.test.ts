import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeHeaderSlots, composeNav, composeRoutes } from '@kwtech/module-kit';
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
  it('contributes the route, the drawer entry and the header icon', () => {
    const module = chatWebModule();

    expect(composeRoutes([module]).map((route) => route.path)).toEqual([CHAT_HREF]);
    expect(composeNav([module], [CHAT_FEATURE.read]).map((entry) => entry.href)).toEqual([CHAT_HREF]);
    expect(composeHeaderSlots([module]).map((slot) => slot.key)).toEqual(['chat']);
  });

  it('⚠ guards the icon and the page with the SAME key', () => {
    // One key, filtered in three places and enforced in a fourth. Two keys here
    // would let somebody hold the icon and be refused by the page it opens.
    const module = chatWebModule();

    expect(composeRoutes([module])[0]?.feature).toBe(CHAT_FEATURE.read);
    expect(composeHeaderSlots([module])[0]?.feature).toBe(CHAT_FEATURE.read);
  });

  it('shows neither to somebody who does not hold the key', () => {
    const module = chatWebModule();

    expect(composeNav([module], [])).toEqual([]);
    expect(composeHeaderSlots([module], [])).toEqual([]);
  });

  it('declares its features and its cap', () => {
    const module = chatWebModule();

    expect(module.features?.map((feature) => feature.key)).toContain(CHAT_FEATURE.read);
    expect(module.limits?.length).toBeGreaterThan(0);
  });
});

describe('chatWebModule({ enabled: false })', () => {
  const off = chatWebModule({ enabled: false });

  it('contributes no route, no drawer entry and no icon', () => {
    expect(composeRoutes([off])).toEqual([]);
    expect(composeNav([off])).toEqual([]);
    expect(composeHeaderSlots([off])).toEqual([]);
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
