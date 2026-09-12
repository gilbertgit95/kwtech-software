import type { ChatDefaultReader } from '@kwtech/module-chat';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { Injectable } from '@nestjs/common';

/**
 * Chat's third port that only the APP can fill, beside the user directory and
 * the platform-admin check.
 *
 * ## Why it exists at all
 *
 * `module-chat` DECLARES its two defaults — they are chat's decisions, about
 * chat's participant roles — and cannot READ them. The VALUE lives in
 * `perm_default`, a table `@kwtech/module-permissions` owns, and neither module
 * may import the other (PLAN §9). The same split as the cap: chat declares
 * `chat:group_chats` and calls a `LimitChecker` to find out the number.
 *
 * ⚠ It is in `src/chat/` rather than inline in `app.module.ts`, where it
 * started, for the reason `ChatPlatformAdmin` moved: that file composes
 * modules, and an implementation living inside a descriptor is how a
 * composition file stops being one.
 */
@Injectable()
export class ChatDefaults implements ChatDefaultReader {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * ⚠ `readDefault`, NOT `listDefaults`. The list is the defaults SCREEN's
   * answer — every row, then both target tables, then a label and an icon and
   * an availability flag per default — and a group creation consults two keys,
   * so going through it would run that three-query page render twice to obtain
   * two strings.
   *
   * ⚠ AND IT IS UNGUARDED, which is correct here and would not be on a screen.
   * There is no actor: the caller is chat creating a group, asking what the
   * OPERATOR configured, not a person asking to see the settings. Reading the
   * configured default is part of the write the actor was already permitted to
   * make — `chat:start_group` is the check — and `perm_default` holds an
   * operator's choices, never anybody's data. The defaults screen's own read
   * stays behind `defaults:manage`.
   *
   * @returns the stored value, or null when nobody has chosen one. Never
   * validated here — chat re-checks it against its own enum, because this layer
   * does not know what chat's roles are.
   */
  async read(key: string): Promise<string | null> {
    return await this.permissions.readDefault(key);
  }
}
