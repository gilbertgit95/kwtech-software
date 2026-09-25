/**
 * What this module asks the app, because the answer lives in another module's
 * tables. Declared structurally; the app implements each one in
 * `apps/web-server/src/notifications/`.
 */

export interface NotificationRecipientView {
  userId: string;
  displayName: string;
  email: string;
}

/**
 * People, for the compose screen: finding them, and naming who sent a batch.
 *
 * ⚠ Only the compose screen and the Sent list call it, and both are behind
 * `notification:send` — a privileged key. Recipients never see a person's
 * name on a notification; they see its source.
 */
export interface NotificationUserDirectory {
  /** People whose name or email matches, at most `limit` of them. */
  search(query: string, limit: number): Promise<NotificationRecipientView[]>;
  /** Display names for these ids. An id it cannot name is simply absent. */
  names(userIds: readonly string[]): Promise<Map<string, string>>;
}
