import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import {
  AUTH_ACCOUNT_DEVICE,
  AUTH_DEFAULT_DISPLAY,
  AUTH_DEFAULT_DISPLAY_LAYOUT,
  type AuthDisplayApplyTo,
  type AuthDisplayLayout,
  type AuthDisplayPreferences,
  type AuthDisplayRefusal,
  type AuthDisplaySource,
  isAuthDeviceId,
  isAuthDisplayApplyTo,
  isAuthDisplayLayout,
  prepareDisplayChange,
} from '../domain/display.js';
import { AUTH_PRISMA, type AuthPrismaClient } from './auth.repository.js';

/** What a refused change says. The values are a fixed list, so the message names it. */
const DISPLAY_REFUSAL_MESSAGES: Record<AuthDisplayRefusal, string> = {
  invalid_text_size: 'Text size is one of: small, normal, large, larger, largest.',
  invalid_spacing: 'Spacing is one of: compact, comfortable, roomy.',
  invalid_layout: 'Layout is one of: desktop, mobile.',
  invalid_device: 'That device id is not one this app makes.',
  invalid_apply_to: 'A change applies to: device, account.',
  device_required: 'Saving for this device needs the device.',
};

/** The sizes in effect, and where they came from. */
export interface AuthDisplayInEffect extends AuthDisplayPreferences {
  source: AuthDisplaySource;
}

/**
 * A person's own display sizes (issue #20): read on every signed-in page, so
 * the shell can apply them before it paints, and changed from Display.
 *
 * Kept PER LAYOUT (issue #22): the full site's and the phone layout's are set
 * apart, and a person who never chose for one gets the defaults there — never
 * the other layout's sizes, which were chosen for a different screen.
 *
 * And PER DEVICE (the operator, 2026-10-29): a device may have sizes of its
 * own for a layout, and uses them; without, it uses the account's for that
 * layout; without those, the defaults. Sizes set on one phone never change
 * another phone, nor a computer. See `src/domain/display.ts`.
 *
 * ⚠ NO FEATURE KEY, on purpose: the caller's session is the whole check, as
 * for `viewer`. Larger text is how somebody reads the app at all — a role
 * withholding it would lock a person out by eyesight, which is the one thing
 * a key here could do. It is also only ever the caller's own rows: the user id
 * comes from the principal, never from an argument — a device id selects among
 * THEIR rows and can reach nobody else's.
 */
@Injectable()
export class AuthDisplayService {
  constructor(@Optional() @Inject(AUTH_PRISMA) private readonly prisma?: AuthPrismaClient) {}

  /**
   * The sizes in effect for one layout on one device: the device's own, else
   * the account's, else the defaults — with which it was. No device (`null`)
   * reads the account's.
   */
  async read(userId: string, layout: AuthDisplayLayout, deviceId: string | null): Promise<AuthDisplayInEffect> {
    const rows = this.client().authDisplayPreference;
    if (deviceId) {
      const own = await rows.findUnique({ where: { userId_layout_deviceId: { userId, layout, deviceId } } });
      if (own) return { textSize: own.textSize, spacing: own.spacing, source: 'device' };
    }
    const account = await rows.findUnique({
      where: { userId_layout_deviceId: { userId, layout, deviceId: AUTH_ACCOUNT_DEVICE } },
    });
    if (account) return { textSize: account.textSize, spacing: account.spacing, source: 'account' };
    return { ...AUTH_DEFAULT_DISPLAY, source: 'default' };
  }

  /**
   * Changes the given fields of what is in effect, leaving the other as it
   * was, and saves the result:
   *
   *   `device`   as this device's own sizes for the layout;
   *   `account`  as the account's for the layout — every device of theirs
   *              without sizes of its own then follows — and THIS device's
   *              own are dropped, so it follows too. Somebody who chose "all
   *              my phones" on this phone expects this phone to be one of them.
   *
   * An upsert, so the first change creates the row and a double click is one
   * row, not a unique-constraint error. Answers with what is now in effect.
   */
  async update(
    userId: string,
    layout: AuthDisplayLayout,
    deviceId: string | null,
    applyTo: AuthDisplayApplyTo,
    input: { textSize?: string | undefined; spacing?: string | undefined },
  ): Promise<AuthDisplayInEffect> {
    if (applyTo === 'device' && !deviceId) this.refuse('device_required');
    const current = await this.read(userId, layout, deviceId);
    const next = prepareDisplayChange(current, input);
    if ('refused' in next) this.refuse(next.refused);

    const rows = this.client().authDisplayPreference;
    const target = applyTo === 'device' && deviceId ? deviceId : AUTH_ACCOUNT_DEVICE;
    await rows.upsert({
      where: { userId_layout_deviceId: { userId, layout, deviceId: target } },
      create: { userId, layout, deviceId: target, ...next },
      update: next,
    });
    if (applyTo === 'account' && deviceId) await rows.deleteMany({ where: { userId, layout, deviceId } });
    return this.read(userId, layout, deviceId);
  }

  /**
   * Drops this device's own sizes for the layout, so it follows the account's
   * again ("Use my usual sizes here"). Nothing to drop is not an error.
   */
  async forgetDevice(userId: string, layout: AuthDisplayLayout, deviceId: string): Promise<AuthDisplayInEffect> {
    await this.client().authDisplayPreference.deleteMany({ where: { userId, layout, deviceId } });
    return this.read(userId, layout, deviceId);
  }

  /**
   * The layout a request named, checked. Omitted is the full site — what
   * every caller meant before the split. Anything else is refused by name.
   */
  layoutOf(value: string | null | undefined): AuthDisplayLayout {
    if (value == null) return AUTH_DEFAULT_DISPLAY_LAYOUT;
    if (!isAuthDisplayLayout(value)) this.refuse('invalid_layout');
    return value;
  }

  /** The device a request named, checked; omitted is none — the account's own sizes. */
  deviceOf(value: string | null | undefined): string | null {
    if (value == null || value === '') return null;
    if (!isAuthDeviceId(value)) this.refuse('invalid_device');
    return value;
  }

  /**
   * Where a change goes. Omitted: this device when a device was named, else
   * the account — which is what every caller from before devices meant.
   */
  applyToOf(value: string | null | undefined, deviceId: string | null): AuthDisplayApplyTo {
    if (value == null) return deviceId ? 'device' : 'account';
    if (!isAuthDisplayApplyTo(value)) this.refuse('invalid_apply_to');
    return value;
  }

  private refuse(reason: AuthDisplayRefusal): never {
    throw new BadRequestException(DISPLAY_REFUSAL_MESSAGES[reason]);
  }

  private client(): AuthPrismaClient {
    if (!this.prisma) throw new Error('AuthModule.forRoot requires a Prisma client to keep display sizes');
    return this.prisma;
  }
}
