import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { AUTH_DEFAULT_DISPLAY, type AuthDisplayPreferences, prepareDisplayChange } from '../src/domain/display.js';
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

/** Just the delegate the service touches, keyed by user id like the table's `@id`. */
function fakeClient() {
  const rows = new Map<string, AuthDisplayPreferences & { userId: string }>();
  const client = {
    authDisplayPreference: {
      findUnique: async ({ where }: { where: { userId: string } }) => rows.get(where.userId) ?? null,
      upsert: async (args: {
        where: { userId: string };
        create: AuthDisplayPreferences & { userId: string };
        update: AuthDisplayPreferences;
      }) => {
        const existing = rows.get(args.where.userId);
        const row = existing ? { ...existing, ...args.update } : args.create;
        rows.set(args.where.userId, row);
        return row;
      },
    },
  };
  return { rows, client: client as unknown as AuthPrismaClient };
}

describe('AuthDisplayService', () => {
  it('reads the defaults for somebody who never chose, without writing a row', async () => {
    const { rows, client } = fakeClient();
    await expect(new AuthDisplayService(client).read('u1')).resolves.toEqual(AUTH_DEFAULT_DISPLAY);
    expect(rows.size).toBe(0);
  });

  it("keeps each person's sizes on their own row, and a second change keeps the first", async () => {
    const { client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', { textSize: 'largest' });
    await expect(service.update('u1', { spacing: 'roomy' })).resolves.toEqual({
      textSize: 'largest',
      spacing: 'roomy',
    });
    await expect(service.read('u2')).resolves.toEqual(AUTH_DEFAULT_DISPLAY);
  });

  it('refuses an unknown step as a bad request, and saves nothing', async () => {
    const { rows, client } = fakeClient();
    await expect(new AuthDisplayService(client).update('u1', { textSize: 'huge' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rows.size).toBe(0);
  });
});
