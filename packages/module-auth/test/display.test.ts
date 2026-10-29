import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import {
  AUTH_DEFAULT_DISPLAY,
  type AuthDisplayLayout,
  type AuthDisplayPreferences,
  isAuthDeviceId,
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

type Key = { userId_layout_deviceId: { userId: string; layout: AuthDisplayLayout; deviceId: string } };
type Row = AuthDisplayPreferences & { userId: string; layout: AuthDisplayLayout; deviceId: string };
const keyOf = ({ userId_layout_deviceId: k }: Key) => `${k.userId}/${k.layout}/${k.deviceId}`;

/** Just the delegate the service touches, keyed by (user, layout, device) like the table's `@@id`. */
function fakeClient() {
  const rows = new Map<string, Row>();
  const client = {
    authDisplayPreference: {
      findUnique: async ({ where }: { where: Key }) => rows.get(keyOf(where)) ?? null,
      upsert: async (args: { where: Key; create: Row; update: AuthDisplayPreferences }) => {
        const existing = rows.get(keyOf(args.where));
        const row = existing ? { ...existing, ...args.update } : args.create;
        rows.set(keyOf(args.where), row);
        return row;
      },
      deleteMany: async ({ where }: { where: { userId: string; layout: AuthDisplayLayout; deviceId: string } }) => {
        const key = `${where.userId}/${where.layout}/${where.deviceId}`;
        return { count: rows.delete(key) ? 1 : 0 };
      },
    },
  };
  return { rows, client: client as unknown as AuthPrismaClient };
}

const PHONE_A = 'phone-a-0000000000000001';
const PHONE_B = 'phone-b-0000000000000002';

describe('AuthDisplayService', () => {
  it('reads the defaults for somebody who never chose, says so, and writes no row', async () => {
    const { rows, client } = fakeClient();
    await expect(new AuthDisplayService(client).read('u1', 'desktop', null)).resolves.toEqual({
      ...AUTH_DEFAULT_DISPLAY,
      source: 'default',
    });
    expect(rows.size).toBe(0);
  });

  it("keeps each person's account sizes on their own row, and a second change keeps the first", async () => {
    const { client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', 'desktop', null, 'account', { textSize: 'largest' });
    await expect(service.update('u1', 'desktop', null, 'account', { spacing: 'roomy' })).resolves.toEqual({
      textSize: 'largest',
      spacing: 'roomy',
      source: 'account',
    });
    await expect(service.read('u2', 'desktop', null)).resolves.toEqual({ ...AUTH_DEFAULT_DISPLAY, source: 'default' });
  });

  it('keeps the phone layout’s sizes apart from the full site’s (issue #22)', async () => {
    const { client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', 'desktop', null, 'account', { textSize: 'small', spacing: 'compact' });
    await service.update('u1', 'mobile', null, 'account', { textSize: 'larger' });

    await expect(service.read('u1', 'desktop', null)).resolves.toMatchObject({ textSize: 'small', spacing: 'compact' });
    // Never the desktop's: sizes chosen for a desk are wrong for a phone, so an unset field is the default.
    await expect(service.read('u1', 'mobile', null)).resolves.toMatchObject({
      textSize: 'larger',
      spacing: 'comfortable',
    });
  });

  it("uses a device's own sizes, and never another device's: one phone does not change another", async () => {
    const { client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', 'mobile', null, 'account', { textSize: 'large' });
    await service.update('u1', 'mobile', PHONE_A, 'device', { textSize: 'largest' });

    await expect(service.read('u1', 'mobile', PHONE_A)).resolves.toMatchObject({
      textSize: 'largest',
      source: 'device',
    });
    // Phone B has none of its own: the account's, for phones.
    await expect(service.read('u1', 'mobile', PHONE_B)).resolves.toMatchObject({
      textSize: 'large',
      source: 'account',
    });
    // And the computer is untouched by either.
    await expect(service.read('u1', 'desktop', PHONE_A)).resolves.toMatchObject({ source: 'default' });
  });

  it('a change made on a device without sizes of its own starts from the ones in effect there', async () => {
    const { client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', 'mobile', null, 'account', { textSize: 'large', spacing: 'roomy' });
    await expect(service.update('u1', 'mobile', PHONE_A, 'device', { spacing: 'compact' })).resolves.toEqual({
      textSize: 'large',
      spacing: 'compact',
      source: 'device',
    });
  });

  it("saving for all phones from a phone sets the account's and drops that phone's own, so it follows", async () => {
    const { rows, client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', 'mobile', PHONE_A, 'device', { textSize: 'small' });
    await expect(service.update('u1', 'mobile', PHONE_A, 'account', { textSize: 'larger' })).resolves.toMatchObject({
      textSize: 'larger',
      source: 'account',
    });
    expect(rows.has(`u1/mobile/${PHONE_A}`)).toBe(false);
    await expect(service.read('u1', 'mobile', PHONE_B)).resolves.toMatchObject({
      textSize: 'larger',
      source: 'account',
    });
  });

  it("forgetting a device's sizes returns it to the account's", async () => {
    const { client } = fakeClient();
    const service = new AuthDisplayService(client);
    await service.update('u1', 'mobile', null, 'account', { textSize: 'large' });
    await service.update('u1', 'mobile', PHONE_A, 'device', { textSize: 'small' });
    await expect(service.forgetDevice('u1', 'mobile', PHONE_A)).resolves.toMatchObject({
      textSize: 'large',
      source: 'account',
    });
  });

  it('refuses an unknown step, and saving for "this device" with no device, as bad requests — and saves nothing', async () => {
    const { rows, client } = fakeClient();
    const service = new AuthDisplayService(client);
    await expect(service.update('u1', 'desktop', null, 'account', { textSize: 'huge' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('u1', 'desktop', null, 'device', { textSize: 'large' })).rejects.toThrow(
      /needs the device/,
    );
    expect(rows.size).toBe(0);
  });

  it('reads what a request named: an omitted layout is the full site; a device id is checked; applyTo follows the device', () => {
    const service = new AuthDisplayService(fakeClient().client);
    expect(service.layoutOf(undefined)).toBe('desktop');
    expect(service.layoutOf('mobile')).toBe('mobile');
    expect(() => service.layoutOf('tablet')).toThrow(/Layout is one of: desktop, mobile/);

    expect(service.deviceOf(undefined)).toBeNull();
    expect(service.deviceOf('')).toBeNull();
    expect(service.deviceOf(PHONE_A)).toBe(PHONE_A);
    expect(() => service.deviceOf('x')).toThrow(/not one this app makes/);
    expect(() => service.deviceOf('a'.repeat(65))).toThrow(/not one this app makes/);

    expect(service.applyToOf(undefined, PHONE_A)).toBe('device');
    expect(service.applyToOf(undefined, null)).toBe('account');
    expect(() => service.applyToOf('everywhere', PHONE_A)).toThrow(/applies to: device, account/);
  });

  it('accepts the ids the web app makes, and nothing that could be a key of any size', () => {
    expect(isAuthDeviceId(crypto.randomUUID())).toBe(true);
    expect(isAuthDeviceId('short')).toBe(false);
    expect(isAuthDeviceId('has spaces in it, sixteen+')).toBe(false);
    expect(isAuthDeviceId(42)).toBe(false);
  });
});
