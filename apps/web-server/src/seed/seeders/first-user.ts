import {
  checkPassword,
  isPlausibleEmail,
  isPlausibleUsername,
  normaliseEmail,
  normaliseUsername,
} from '@kwtech/module-auth';
import { hashPassword } from '@kwtech/module-auth/server';
import type { PrismaClient } from '../../generated/client.js';
import type { Seeder } from '../types.js';

/**
 * The first operator account, from SEED_USER_*.
 *
 * Squarely the app's: which person gets the first account is deployment data,
 * not something `@kwtech/module-auth` could have an opinion about. The module
 * supplies the parts that must not be reimplemented — the hash, the
 * normalisation, the password policy — and this composes them.
 *
 * Phase 'seed', not 'sync'. It is asked for once per environment; a deploy that
 * re-asserted an operator's password every time would be a way to lock someone
 * out of their own account with a stale .env.
 */

interface SeedUserInput {
  email: string;
  username: string;
  displayName: string;
  password: string;
}

function readInput(): SeedUserInput {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required. See apps/web-server/.env.example.`);
    return value;
  };

  return {
    email: required('SEED_USER_EMAIL'),
    username: required('SEED_USER_USERNAME'),
    displayName: required('SEED_USER_NAME'),
    password: required('SEED_USER_PASSWORD'),
  };
}

export async function seedUser(prisma: PrismaClient, input: SeedUserInput): Promise<{ id: string; created: boolean }> {
  const email = normaliseEmail(input.email);
  const username = normaliseUsername(input.username);

  if (!isPlausibleEmail(email)) throw new Error(`SEED_USER_EMAIL is not a valid address: ${input.email}`);
  if (!isPlausibleUsername(username)) {
    throw new Error(
      `SEED_USER_USERNAME must be 3–32 characters of a-z, 0-9, dot, dash or underscore, and may not contain '@': ${input.username}`,
    );
  }

  /**
   * The seeded password is checked against the SAME policy the reset endpoint
   * applies — and only warns rather than refusing.
   *
   * Refusing would block an operator who has deliberately chosen a value for a
   * local database. Staying silent would be worse: a password the application
   * would not let you CHOOSE, but happily let you keep, is a trap that surfaces
   * months later when the same value is rejected at a password reset. So it is
   * seeded, and said out loud.
   */
  const complaint = checkPassword(input.password);
  if (!complaint.ok) {
    console.warn(
      `⚠  The seeded password does not meet this application's own policy (${complaint.reason}).\n` +
        '   It will work for signing in, but /auth/reset-password would REFUSE the same value.\n' +
        '   Fix by choosing a longer password, or by lowering MIN_PASSWORD_LENGTH in\n' +
        '   packages/module-auth/src/domain/policy.ts — deliberately, not by accident.',
    );
  }

  const secret = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.authUser.findUnique({ where: { email }, select: { id: true } });

    const user = await tx.authUser.upsert({
      where: { email },
      create: {
        email,
        username,
        displayName: input.displayName,
        status: 'active',
        // Seeded by an operator who already controls the address, so there is
        // nothing to verify. A production sign-up must NOT do this.
        emailVerifiedAt: new Date(),
      },
      update: {
        username,
        displayName: input.displayName,
        status: 'active',
        // Re-seeding is usually a password reset by another name, so clear any
        // lockout with it.
        failedLoginCount: 0,
        lockedUntil: null,
      },
      select: { id: true },
    });

    await tx.authCredential.upsert({
      where: { userId_type: { userId: user.id, type: 'password' } },
      create: { userId: user.id, type: 'password', secret },
      update: { secret },
    });

    return { id: user.id, created: existing === null };
  });
}

export const firstUserSeeder: Seeder = {
  name: 'auth:first-user',
  phase: 'seed',
  description: 'Create or update the operator account named by SEED_USER_*.',
  async run({ prisma, log }) {
    const input = readInput();
    const { id, created } = await seedUser(prisma, input);
    log(`${created ? 'created' : 'updated'} ${normaliseEmail(input.email)} (${id})`);
  },
};
