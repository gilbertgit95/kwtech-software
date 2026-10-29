import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import {
  AUTH_DEFAULT_DISPLAY,
  AUTH_DEFAULT_DISPLAY_LAYOUT,
  type AuthDisplayLayout,
  type AuthDisplayPreferences,
  isAuthDisplayLayout,
  prepareDisplayChange,
} from '../domain/display.js';
import { AUTH_PRISMA, type AuthPrismaClient } from './auth.repository.js';

/** What a refused change says. The values are a fixed list, so the message names it. */
const DISPLAY_REFUSAL_MESSAGES = {
  invalid_text_size: 'Text size is one of: small, normal, large, larger, largest.',
  invalid_spacing: 'Spacing is one of: compact, comfortable, roomy.',
  invalid_layout: 'Layout is one of: desktop, mobile.',
} as const;

/**
 * A person's own display sizes (issue #20): read on every signed-in page, so
 * the shell can apply them before it paints, and changed from Display.
 *
 * Kept PER LAYOUT (issue #22): the full site's and the phone layout's are set
 * apart, and a person who never chose for one gets the defaults there — never
 * the other layout's sizes, which were chosen for a different screen.
 *
 * ⚠ NO FEATURE KEY, on purpose: the caller's session is the whole check, as
 * for `viewer`. Larger text is how somebody reads the app at all — a role
 * withholding it would lock a person out by eyesight, which is the one thing
 * a key here could do. It is also only ever the caller's own row: the user id
 * comes from the principal, never from an argument.
 */
@Injectable()
export class AuthDisplayService {
  constructor(@Optional() @Inject(AUTH_PRISMA) private readonly prisma?: AuthPrismaClient) {}

  /** The caller's sizes for one layout, or the defaults when they never chose. */
  async read(userId: string, layout: AuthDisplayLayout): Promise<AuthDisplayPreferences> {
    const row = await this.client().authDisplayPreference.findUnique({
      where: { userId_layout: { userId, layout } },
    });
    return row ? { textSize: row.textSize, spacing: row.spacing } : AUTH_DEFAULT_DISPLAY;
  }

  /**
   * Changes the given fields, leaving the other as it was. An upsert, so the
   * first change creates the row and a double click is one row, not a
   * unique-constraint error.
   */
  async update(
    userId: string,
    layout: AuthDisplayLayout,
    input: { textSize?: string | undefined; spacing?: string | undefined },
  ): Promise<AuthDisplayPreferences> {
    const next = prepareDisplayChange(await this.read(userId, layout), input);
    if ('refused' in next) throw new BadRequestException(DISPLAY_REFUSAL_MESSAGES[next.refused]);
    const row = await this.client().authDisplayPreference.upsert({
      where: { userId_layout: { userId, layout } },
      create: { userId, layout, ...next },
      update: next,
    });
    return { textSize: row.textSize, spacing: row.spacing };
  }

  /**
   * The layout a request named, checked. Omitted is the full site — what
   * every caller meant before the split. Anything else is refused by name.
   */
  layoutOf(value: string | null | undefined): AuthDisplayLayout {
    if (value == null) return AUTH_DEFAULT_DISPLAY_LAYOUT;
    if (!isAuthDisplayLayout(value)) throw new BadRequestException(DISPLAY_REFUSAL_MESSAGES.invalid_layout);
    return value;
  }

  private client(): AuthPrismaClient {
    if (!this.prisma) throw new Error('AuthModule.forRoot requires a Prisma client to keep display sizes');
    return this.prisma;
  }
}
