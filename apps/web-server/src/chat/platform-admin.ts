import { CHAT_FEATURE } from '@kwtech/module-chat';
import type { PlatformAdminCheck } from '@kwtech/module-chat/server';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { Injectable } from '@nestjs/common';
import { resolvePrincipal } from '../auth/resolve-principal.js';

/**
 * Chat's second port that only the APP can fill, beside the user directory.
 *
 * ## Why it lives here and can live nowhere else
 *
 * `module-chat` DECLARES `chat:manage_all` — it is a chat right and belongs in
 * chat's registry — and cannot CHECK it. Asking whether somebody holds a key is
 * `@kwtech/module-permissions`' question, and neither module may import the
 * other (PLAN §9). The app is the only layer that already depends on both, so
 * the app answers.
 *
 * ⚠ It is in `src/chat/` rather than inline in `app.module.ts`, where it
 * started. That file composes modules; it is not where an implementation
 * belongs, and twenty lines of permission logic inside a descriptor is how a
 * composition file stops being one. `ChatUserDirectory` beside this set the
 * precedent.
 */
@Injectable()
export class ChatPlatformAdmin implements PlatformAdminCheck {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * ⚠ APP-LEVEL GRANTS ONLY, from a context loaded with NO SCOPE.
   *
   * A conversation belongs to no organization — chat is reachable between two
   * people who share none — so an organization-scoped reading would be
   * answering about the wrong thing. `grantedAtAppLevel` is exactly "what this
   * person holds everywhere", which is what reaching down from the top means.
   *
   * ⚠ AND IT GRANTS NO READING. The key admits administering a conversation the
   * holder is not in — renaming it, changing who is in it, deciding who runs
   * it — and not one word of what was said in it. §12.42 ships no
   * read-any-conversation key; every message query stays bound to `chat:read`
   * and refuses a non-participant whoever is asking.
   *
   * It costs a context load per mutation that offers it. Affordable because
   * every one is a write on a single conversation: never on a read path, and
   * never on the message list.
   */
  async isPlatformAdmin(request: unknown): Promise<boolean> {
    const userId = resolvePrincipal(request)?.userId;
    if (!userId) return false;

    const context = await this.permissions.loadContext(userId);
    return context?.grantedAtAppLevel.includes(CHAT_FEATURE.manageAll) ?? false;
  }
}
