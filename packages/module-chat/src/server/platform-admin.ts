/**
 * "May this caller administer a conversation they are not in?"
 *
 * ⚠ A PORT, because the answer is `module-permissions`' and this module may not
 * import a module (§9). Chat DECLARES `chat:manage_all` — it is a chat right,
 * and belongs in chat's registry — and cannot CHECK it. The host, which depends
 * on both, resolves it and hands back a boolean.
 *
 * The same shape as the `UserDirectory`: a named port with one method, filled
 * in by the one layer that can see both sides.
 */
export interface PlatformAdminCheck {
  /**
   * @param request whatever the transport calls a request — the same opaque
   * value `resolveActorId` is given. This module never inspects it.
   *
   * ⚠ ASKED PER MUTATION, never on a read path. It costs the host a permission
   * context load, which is affordable for a write on one conversation and would
   * not be on a message list.
   */
  isPlatformAdmin(request: unknown): Promise<boolean> | boolean;
}
