import type { AuthAdminTargetCheck } from '@kwtech/module-auth/server';
import type { PermissionsService } from '@kwtech/module-permissions/server';

/**
 * Whether one administrator may change another person's account (#175): only
 * when every PLATFORM right the target holds, the actor holds too. The rule
 * `assignAppRole` applies to giving a role, applied to changing an account, so
 * Support (`users:update`) can get a customer signed in again and cannot remove
 * a Super admin's second factor, end their sessions or suspend them.
 *
 * Platform (app-level) rights only: an organization role is power inside one
 * customer, not over the platform's accounts. A target with no app role holds
 * none, and anybody with the key may help them. An actor with no context holds
 * nothing and may change only such accounts.
 */
export function holdsEveryRightOf(actor: readonly string[], target: readonly string[]): boolean {
  const held = new Set(actor);
  return target.every((key) => held.has(key));
}

export function createAdminTargetCheck(permissions: Pick<PermissionsService, 'loadContext'>): AuthAdminTargetCheck {
  return async (actorId, targetId) => {
    if (actorId === targetId) return true;
    const [actor, target] = await Promise.all([permissions.loadContext(actorId), permissions.loadContext(targetId)]);
    return holdsEveryRightOf(actor?.effective ?? [], target?.effective ?? []);
  };
}
