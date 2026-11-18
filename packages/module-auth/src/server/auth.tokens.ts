/**
 * ⚠ WHO MAY CHANGE WHOSE ACCOUNT (#175).
 *
 * `users:update` and `users:disable` say an administrator may change accounts;
 * they do not say WHICH. Without a second rule a support engineer holding
 * `users:update` could remove a Super admin's second factor, end their
 * sessions or suspend them: power over an account with more rights than their
 * own. This module does not know what a right is, so the app answers.
 *
 * `(actorId, targetId) => Promise<boolean>`: true when the actor may change
 * the target. The app's answer is the no-escalation rule `assignAppRole`
 * already applies: the target's platform rights must all be the actor's too.
 *
 * UNBOUND REFUSES every account write, with a sentence saying the app has not
 * wired it: a missing rule is not permission.
 */
export const AUTH_ADMIN_TARGET_CHECK = 'kwtech:auth-admin-target-check';

export type AuthAdminTargetCheck = (actorId: string, targetId: string) => Promise<boolean>;
