import type { AuthModuleOptions } from '@kwtech/module-auth/server';
import { Logger } from '@nestjs/common';
import { env } from '../config/env.js';

const logger = new Logger('PasswordReset');

/**
 * How a reset link reaches its owner.
 *
 * SMTP is not wired yet, so in development this logs the URL and the flow is
 * walkable end to end. In production it refuses instead — a reset link in an
 * aggregated log is a working credential in an aggregated log, and the failure
 * mode of "we sent nothing and said nothing" is a user who cannot get in, which
 * is recoverable. The other direction is not.
 *
 * Replacing this with a real mailer is a change to this one function; nothing
 * in the module knows how mail is sent.
 */
export const sendPasswordResetEmail: NonNullable<AuthModuleOptions['sendPasswordResetEmail']> = async ({
  user,
  token,
  expiresAt,
}) => {
  const url = `${env.AUTH_RESET_URL_BASE}?token=${encodeURIComponent(token)}`;

  if (env.NODE_ENV === 'production') {
    logger.error(`No mailer configured — cannot send a reset link to ${user.email}`);
    throw new Error('Password reset email is not configured');
  }

  logger.warn(`[dev only] Password reset for ${user.email}, valid until ${expiresAt.toISOString()}:\n  ${url}`);
};
