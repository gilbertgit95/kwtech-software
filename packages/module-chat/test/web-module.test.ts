import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeHeaderTools, composeNav, composeRoutes } from '@kwtech/module-kit';
import { chatIsEnabled } from '../src/enabled.js';
import { CHAT_FEATURE } from '../src/feature-keys.js';
import { CHAT_HREF, CHAT_PREFERENCES_HREF, chatWebModule } from '../src/react/module.js';

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
  it('contributes the routes, and by default reaches them from the HEADER, not the drawer', () => {
    const module = chatWebModule();

    expect(composeRoutes([module]).map((route) => route.path)).toEqual([
      CHAT_HREF,
      CHAT_PREFERENCES_HREF,
      `${CHAT_HREF}/:conversationId/settings`,
    ]);

    /*
     * ⚠ ONE door. The inbox button in the header is the way in, so `/chat` is
     * unlisted — a drawer entry as well would be two doors to one place, the
     * reason §12.52 once took the header icon away.
     */
    expect(composeNav([module], [CHAT_FEATURE.read])).toEqual([]);
    expect(composeHeaderTools([module], [CHAT_FEATURE.read]).map((tool) => tool.key)).toEqual(['chat']);
  });

  it('⚠ lists the header tool only for somebody holding chat:read — it subscribes, like the badge', () => {
    expect(composeHeaderTools([chatWebModule()], [])).toEqual([]);
  });

  it("with placement: 'drawer', goes back to the drawer entry with its badge, and leaves the header alone", () => {
    const module = chatWebModule({ placement: 'drawer' });

    const [entry] = composeNav([module], [CHAT_FEATURE.read]);
    expect(composeNav([module], [CHAT_FEATURE.read])).toHaveLength(1);
    expect(entry?.href).toBe(CHAT_HREF);
    expect(entry?.Badge).toBeDefined();
    expect(module.headerTools).toBeUndefined();
  });

  /**
   * ⚠ `/chat/preferences` AND `/chat/:conversationId/settings` MUST NOT
   * COLLIDE, and the reason they do not is worth an assertion rather than a
   * glance: they are different LENGTHS. A `/chat/:conversationId` route would
   * make `preferences` ambiguous with a conversation id the moment somebody
   * added one — this is the test that would notice.
   */
  it('⚠ keeps the static preferences path unambiguous against the dynamic one', () => {
    const routes = composeRoutes([chatWebModule()]);
    const dynamic = routes.filter((route) => route.path.includes(':'));

    for (const route of dynamic) {
      expect(route.path.split('/').length).not.toBe(CHAT_PREFERENCES_HREF.split('/').length);
    }
  });

  it('⚠ guards the settings sub-page with the same key as the page', () => {
    // Which controls appear on it is decided by the participant's ROLE, inside
    // the page and again at the API. A narrower key here would be a third
    // answer to a question two places already answer.
    const settings = composeRoutes([chatWebModule()]).find((route) => route.path.endsWith('/settings'));
    expect(settings?.feature).toBe(CHAT_FEATURE.read);
    expect(settings?.nav).toBeUndefined();
  });

  it('⚠ takes the badge away with the entry when the key is not held', () => {
    // The badge SUBSCRIBES. One that outlived its entry's filter would be a
    // live query running for somebody the API refuses.
    const module = chatWebModule({ placement: 'drawer' });

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

  it('contributes no route, no drawer entry and no header tool', () => {
    expect(composeRoutes([off])).toEqual([]);
    expect(composeNav([off])).toEqual([]);
    expect(composeHeaderTools([off])).toEqual([]);
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
