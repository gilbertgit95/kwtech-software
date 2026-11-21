import { normaliseEmail, normaliseUsername } from '@kwtech/module-auth';
import { AuthAdminService, hashPassword } from '@kwtech/module-auth/server';
import { env } from '../config/env.js';
import type { PrismaClient } from '../generated/client.js';
import { checkNewPassword } from './first-setup-plan.js';
import { askChecked, askYesNo, createPrompter } from './prompts.js';

/**
 * `kwtech recover-account` (the API image) or `pnpm --filter
 * @kwtech/web-server recover-account`: a new password for any account, typed
 * on the server PC (#133 P3).
 *
 * ## Why it exists
 *
 * A super admin can only SEND a reset email (`adminSendPasswordReset`), never
 * set a password. A shop's own install may have no email at all (#213), and
 * the super admin can forget their own. Somebody with the server PC's
 * administrator account (Docker, or the repository) is the one who may
 * then reset it: that access already reaches the whole database.
 *
 * ## What it does, and what it reuses
 *
 * - the password: typed hidden, twice, checked against the policy the app
 *   enforces (`checkNewPassword`), hashed as every credential is;
 * - clears a lockout from too many wrong attempts;
 * - ends every session the account has, through the Users page's own
 *   `AuthAdminService.revokeSessions` (refresh tokens and the access-token
 *   denylist alike);
 * - optionally removes two-step sign-in, through `removeTwoFactor`, for a
 *   person who lost the phone that held it.
 *
 * It logs that an account was recovered, never the password.
 */

async function main(): Promise<void> {
  if (env.JOBS_RUNNER !== 'off') {
    throw new Error(
      'Run it with JOBS_RUNNER=off (the commands set it): booting the app here must not start a second job runner.',
    );
  }
  const prompter = createPrompter();
  const [{ NestFactory }, { AppModule }, { PrismaService }] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module.js'),
    import('../prisma/prisma.service.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  try {
    await app.init();
    const prisma: PrismaClient = app.get(PrismaService, { strict: false });
    const admin = app.get(AuthAdminService, { strict: false });

    prompter.say('Set a new password for an account on this install.');
    prompter.say();
    let user: { id: string; email: string; displayName: string | null } | null = null;
    while (!user) {
      const identifier = await askChecked(prompter, 'Email or username of the account', (answer) =>
        answer.trim() ? null : 'Type the email or the username.',
      );
      user = await prisma.authUser.findFirst({
        where: identifier.includes('@')
          ? { email: normaliseEmail(identifier) }
          : { username: normaliseUsername(identifier) },
        select: { id: true, email: true, displayName: true },
      });
      if (user) break;
      if (!prompter.interactive) throw new Error('No account has that email or username.');
      prompter.say('  ✗ No account has that email or username.');
    }
    prompter.say(`  Account: ${user.displayName ?? user.email} <${user.email}>`);

    let password = '';
    for (;;) {
      password = await prompter.askHidden('  New password');
      const refusal = checkNewPassword(password);
      if (refusal) {
        if (!prompter.interactive) throw new Error(refusal);
        prompter.say(`  ✗ ${refusal}`);
        continue;
      }
      const again = await prompter.askHidden('  New password again');
      if (again === password) break;
      if (!prompter.interactive) throw new Error('The two passwords differ.');
      prompter.say('  ✗ The two passwords differ. Type it again.');
    }
    const removeTwoFactor = await askYesNo(prompter, '  Also remove two-step sign-in (the phone was lost)?', false);
    if (!(await askYesNo(prompter, `Set the new password for ${user.email}, and sign them out everywhere?`, false))) {
      prompter.say('Stopped. Nothing was changed.');
      return;
    }

    const secret = await hashPassword(password);
    const userId = user.id;
    await prisma.$transaction(async (tx) => {
      await tx.authCredential.upsert({
        where: { userId_type: { userId, type: 'password' } },
        create: { userId, type: 'password', secret },
        update: { secret },
      });
      // A lockout from wrong attempts would refuse the new password too.
      await tx.authUser.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
    });
    const { revoked } = await admin.revokeSessions(userId);
    const removed = removeTwoFactor ? (await admin.removeTwoFactor(userId)).removed : 0;
    console.log(`[recover-account] password set for user ${userId} on the server PC; ${revoked} session(s) ended`);
    prompter.say();
    prompter.say(
      `✓ ${user.email} can sign in with the new password. ${revoked} session(s) ended${removeTwoFactor ? `, ${removed} two-step method(s) removed` : ''}.`,
    );
  } finally {
    prompter.close();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
