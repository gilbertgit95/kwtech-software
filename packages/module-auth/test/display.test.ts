import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import {
  AUTH_DEFAULT_DISPLAY,
  type AuthDisplayLayout,
  type AuthDisplayPreferences,
  prepareDisplayChange,
} from '../src/domain/display.js';
import type { AuthPrismaClient } from '../src/server/auth.repository.js';
import { AuthDisplayService } from '../src/server/auth-display.service.js';

describe('a change to the display sizes', () => {
  it('replaces only the fields given', () => {
    expect(prepareDisplayChange(AUTH_DEFAULT_DISPLAY, { textSize: 'larger' })).toEqual({
      textSize: 'larger',
      spacing: 'comfortable',
    });
    expect(prepareDisplayChange({ textSize: 'large', spacing: 'roomy' }, {})).toEqual({
      textSize: 'large',
      spacing: 'roomy',
    });
  });

  it('refuses a step that does not exist, naming which', () => {
    expect(prepareDisplayChange(AUTH_DEFAULT_DISPLAY, { textSize: 'huge' })).toEqual({ refused: 'invalid_text_size' });
    expect(prepareDisplayChange(AUTH_DEFAULT_DISPLAY, { spacing: 'tight' })).toEqual({ refused: 'invalid_spacing' });
  });
});

type Key = { userId_layout: { userId: string; layout: AuthDisplayLayout } };
const keyOf = (where: Key) => `${where.userId_layout.userId}/${where.userId_layout.layout}`;

/** Just the delegate the service touches, keyed by (user, layout) like the table's `@@id`. */
function fakeClient() {
  const rows = new Map<string, AuthDisplayPreferences & { userId: string; layout: AuthDisplayLayout }>();
  const client = {
    authDisplayPreference: {
      findUnique: async ({ where }: { where: Key }) => rows.get(keyOf(where)) ?? null,
      upsert: async (args: {
        where: Key;
        create: AuthDisplayPreferences & { userId: string; layout: AuthDisplayLayout };
        update: AuthDisplayPreferences;
      }) => {
        const existing = rows.get(keyOf(args.where));
        const row = existing ? { ...existing, ...args.update } : args.create;
        rows.set(keyOf(args.where), row);
        return row;
      },
    },
  };
  return { rows, client: client as unknown as AuthPrismaClient };
}

describe('AuthDisplayService', () => {
  it('reads the defaults for somebody who never chose, without writing a row', async () => {
    const { rows, client } = fakeClient();
    await expect(new AuthDisplayService(client).read('u1', 'desktop')).resolves.toEqual(AUTH_DEFAULT_DISPLAY);
    expect(rows.size).toBe(0);
  });

  it("keeps each person's sizes on their own row, and a second change keeps the first", async () => {
    const { client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', 'desktop', { textSize: 'largest' });
    await expect(service.update('u1', 'desktop', { spacing: 'roomy' })).resolves.toEqual({
      textSize: 'largest',
      spacing: 'roomy',
    });
    await expect(service.read('u2', 'desktop')).resolves.toEqual(AUTH_DEFAULT_DISPLAY);
  });

  it('refuses an unknown step as a bad request, and saves nothing', async () => {
    const { rows, client } = fakeClient();
    await expect(new AuthDisplayService(client).update('u1', 'desktop', { textSize: 'huge' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rows.size).toBe(0);
  });

  it('keeps the phone layout’s sizes apart from the full site’s (issue #22)', async () => {
    const { client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', 'desktop', { textSize: 'small', spacing: 'compact' });
    await service.update('u1', 'mobile', { textSize: 'larger' });

    await expect(service.read('u1', 'desktop')).resolves.toEqual({ textSize: 'small', spacing: 'compact' });
    // Never the desktop's: sizes chosen for a desk are wrong for a phone, so an unset field is the default.
    await expect(service.read('u1', 'mobile')).resolves.toEqual({ textSize: 'larger', spacing: 'comfortable' });
  });

  it('reads an omitted layout as the full site, and refuses one it does not know, by name', () => {
    const service = new AuthDisplayService(fakeClient().client);
    expect(service.layoutOf(undefined)).toBe('desktop');
    expect(service.layoutOf(null)).toBe('desktop');
    expect(service.layoutOf('mobile')).toBe('mobile');
    expect(() => service.layoutOf('tablet')).toThrow(/Layout is one of: desktop, mobile/);
  });
});
