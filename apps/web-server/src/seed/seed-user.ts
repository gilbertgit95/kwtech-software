import {
  checkPassword,
  isPlausibleEmail,
  isPlausibleUsername,
  normaliseEmail,
  normaliseUsername,
} from '@kwtech/module-auth';
import { hashPassword } from '@kwtech/module-auth/server';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/client.js';

/**
 * Creates the first user.
 *
 * There is no sign-up endpoint, and that is not an oversight: §12.12 put
 * identity in `module-auth`, but nothing yet decides WHO may create an account —
 * open registration, invite-only, or provisioned by an administrator are three
 * different products. Until that is decided, the first account is an explicit
 * operator action, which is what this script is.
 *
 * Idempotent: run it twice and the second run updates the existing row rather
 * than failing on the unique index. That matters because the most common reason
 * to run it again is having forgotten the password.
 *
 * Reads its values from the environment so a real password never has to be
 * committed. `pnpm db:seed` supplies the defaults for local development.
 */

interface SeedInput {
  email: string;
  username: string;
  displayName: string;
  password: string;
}

function readInput(): SeedInput {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required. See package.json's db:seed script.`);
    return value;
  };

  return {
    email: required('SEED_USER_EMAIL'),
    username: required('SEED_USER_USERNAME'),
    displayName: required('SEED_USER_NAME'),
    password: required('SEED_USER_PASSWORD'),
  };
}

export async function seedUser(prisma: PrismaClient, input: SeedInput): Promise<{ id: string; created: boolean }> {
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

async function main() {
  const input = readInput();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

  try {
    const { id, created } = await seedUser(prisma, input);
    console.log(
      `${created ? 'Created' : 'Updated'} user ${id}\n` +
        `  name:     ${input.displayName}\n` +
        `  username: ${normaliseUsername(input.username)}\n` +
        `  email:    ${normaliseEmail(input.email)}\n` +
        '\nSign in at http://localhost:8081/auth/signin with either the email or the username.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Only when run directly, so the function above stays importable by a test.
if (process.argv[1]?.endsWith('seed-user.js')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
