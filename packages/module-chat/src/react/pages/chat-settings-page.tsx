'use client';

import { cn } from '@kwtech/web-ui/react';
import { useState } from 'react';
import {
  canArchiveConversation,
  canInviteToConversation,
  canManageConversation,
  refuseRoleChange,
  refuseRoleRemoval,
  roleOf,
} from '../../domain/participant-roles.js';
import type { ChatParticipantRole } from '../../types.js';
import type { ChatClient } from '../chat-client.js';
import { ChatSubPage } from '../components/chat-sub-page.js';
import { PersonFinder } from '../components/person-finder.js';
import { useConversationSettings } from '../use-conversation-settings.js';
import { conversationTitle } from '../view/conversation-view.js';

/**
 * `/chat/:conversationId/settings` — what a group is called, who is in it, and
 * who runs it.
 *
 * ## Why a page rather than a panel on the thread
 *
 * Because it grew past a strip. Renaming arrived as an inline form above the
 * messages, and adding people as another; a third for roles and a fourth for
 * archiving would have been a settings screen wearing a thread as a hat — and
 * every one of them pushing the newest message down the moment somebody opened
 * it. Sub-pages are what `ModuleRoute`'s `:params` are for, and the permissions
 * module's write screens already work this way.
 *
 * ## ⚠ THE CONTROLS ARE DRAWN FROM THE SAME RULES THE SERVER ENFORCES
 *
 * `canManageConversation`, `refuseRoleRemoval` and the rest are imported from
 * the domain, not restated here. C1's exact failure was a helper that existed,
 * was used by the React layer, and was never called server-side — this is the
 * same helper called on both sides, so a mistake here can only ever SHOW a
 * control the API then refuses, never the reverse.
 *
 * ## ⚠ IT IS FOR PARTICIPANTS, and the platform key does not open it
 *
 * `chat:manage_all` lets somebody administer a group they are not in — through
 * the API. It does not let them READ one, and this page reads the conversation
 * to draw it, so the query refuses them like anybody else (§12.42). A platform
 * administrator acting on a group they are not in needs a surface of its own,
 * which does not exist yet.
 */
export function ChatSettingsPage({ params, client }: { params?: Record<string, string>; client?: ChatClient }) {
  /*
   * ⚠ There is no `backHref` prop any more. It defaulted to '/chat' and nobody
   * ever passed anything else, which made it a configurable answer to a
   * question with one answer — and the page that FORGOT to render the frame at
   * all was not saved by it being configurable. `ChatSubPage` owns the link.
   */
  const conversationId = params?.conversationId ?? '';
  const settings = useConversationSettings(conversationId, client ? { client } : {});
  const { conversation, participants, me } = settings;

  const [title, setTitle] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (settings.missing) {
    return (
      <ChatSubPage title="Conversation not found">
        <p className="text-sm text-muted-foreground">
          This conversation does not exist, or you are not in it. Those are the same answer on purpose.
        </p>
      </ChatSubPage>
    );
  }

  if (!conversation) {
    return (
      <ChatSubPage title="Settings">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </ChatSubPage>
    );
  }

  /*
   * ⚠ A DIRECT CHAT HAS NO SETTINGS. It cannot be renamed (it is named by who
   * is in it), cannot take a third person, and is not one person's to archive
   * on the other's behalf. Rendering an empty settings page would suggest those
   * controls are merely missing.
   */
  if (conversation.isDirect) {
    return (
      <ChatSubPage title={conversationTitle(conversation)}>
        <p className="text-sm text-muted-foreground">
          A direct conversation has no settings. It is named by who is in it, and only the two of you are ever in it.
        </p>
      </ChatSubPage>
    );
  }

  const actor = { participant: me };
  const canManage = canManageConversation(actor);
  const canArchive = canArchiveConversation(actor);
  const canInvite = canInviteToConversation(actor);
  const names = new Map(conversation.participants.map((one) => [one.userId, one.displayName]));

  return (
    <ChatSubPage title={conversationTitle(conversation)} description="Who is in this conversation, and who runs it.">
      {settings.error ? (
        <p
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{settings.error}</span>
          <button type="button" onClick={settings.dismissError} className="shrink-0 text-xs underline">
            Dismiss
          </button>
        </p>
      ) : null}

      <section className="space-y-3 border-b border-border pb-6">
        <h2 className="text-sm font-medium text-foreground">Name</h2>
        {canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = (title ?? '').trim();
              if (!next) return;
              void settings.rename(next);
              setTitle(null);
            }}
            className="flex items-end gap-2"
          >
            <input
              value={title ?? conversation.title ?? ''}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Group name"
              className={cn(
                'min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            />
            {/*
              Disabled on an empty name rather than sending one: the server
              reads a blank title as "clear it" and the group becomes "Untitled
              group", which is a real state and not one to reach by pressing
              Save.
            */}
            <button
              type="submit"
              disabled={settings.busy || (title ?? conversation.title ?? '').trim() === ''}
              className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {conversationTitle(conversation)} — only an owner or an admin can rename this.
          </p>
        )}
      </section>

      <section className="space-y-3 border-b border-border py-6">
        <h2 className="text-sm font-medium text-foreground">People</h2>
        <ul className="space-y-1">
          {participants.map((one) => {
            const role = roleOf(one);
            const removal = refuseRoleRemoval({ actor, target: one });
            const roleChange = refuseRoleChange({ actor, target: one, next: 'admin' });

            return (
              <li
                key={one.userId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{names.get(one.userId) ?? one.userId}</span>
                  <span className="block text-xs text-muted-foreground">
                    {one.status === 'invited' ? 'Invited — has not answered yet' : ROLE_LABELS[role]}
                  </span>
                </span>

                {/*
                  ⚠ THE OWNER'S ALONE, and `refuseRoleChange` says so rather
                  than this file deciding. `self_demotion` is why the owner's
                  own row has no picker: a group with no owner is a dead end
                  reachable in one click, and handing it on is the way out.
                */}
                {roleChange === null ? (
                  <select
                    value={role}
                    disabled={settings.busy}
                    aria-label={`Role for ${names.get(one.userId) ?? one.userId}`}
                    onChange={(event) => void settings.setRole(one.userId, event.target.value as ChatParticipantRole)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    {/*
                      ⚠ A TRANSFER, not a second owner — the server demotes the
                      current one in the same act. Said in the option's own
                      words, because "Owner" alone reads as a label rather than
                      as something that takes the group away from you.
                    */}
                    <option value="owner">Owner — hand the group over</option>
                  </select>
                ) : null}

                {removal === null ? (
                  <button
                    type="button"
                    disabled={settings.busy}
                    onClick={() => void settings.remove(one.userId)}
                    className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {canInvite ? (
          adding ? (
            <PersonFinder
              label="Add somebody by email"
              action="Add"
              busy={settings.busy}
              onFind={settings.lookUp}
              onFound={(person) => {
                void settings.invite(person.userId);
                setAdding(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md px-2 py-1 text-sm text-primary hover:bg-accent/60"
            >
              Add someone
            </button>
          )
        ) : null}
      </section>

      <section className="space-y-3 pt-6">
        <h2 className="text-sm font-medium text-foreground">This conversation</h2>

        {canArchive ? (
          <div className="space-y-1">
            <button
              type="button"
              disabled={settings.busy}
              onClick={() => void settings.setArchived(!conversation.archived)}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              {conversation.archived ? 'Restore this conversation' : 'Archive this conversation'}
            </button>
            {/*
              ⚠ Says what archiving DOES, because it is not deletion and it is
              not only about this screen: it takes the conversation off
              everybody's list, and it frees a place against the creator's
              group-chat cap.
            */}
            <p className="text-xs text-muted-foreground">
              Archiving takes it off everybody’s list and frees a place against the group limit. Nothing is deleted.
            </p>
          </div>
        ) : null}

        <div className="space-y-1">
          <button
            type="button"
            disabled={settings.busy}
            onClick={() => void settings.leave()}
            className="rounded-md border border-border px-3 py-2 text-sm text-destructive disabled:opacity-50"
          >
            Leave this conversation
          </button>
          {/*
            ⚠ Told BEFORE they press it, not after. An owner leaving hands the
            group to somebody else automatically, and finding that out
            afterwards is finding out you gave your group away.
          */}
          <p className="text-xs text-muted-foreground">
            {roleOf(me) === 'owner'
              ? 'You own this conversation. Leaving hands it to the longest-standing admin, or to the longest-standing member.'
              : 'Your messages stay. Coming back needs an invitation.'}
          </p>
        </div>
      </section>
    </ChatSubPage>
  );
}

const ROLE_LABELS: Record<ChatParticipantRole, string> = {
  owner: 'Owner — runs this conversation',
  admin: 'Admin — can add and remove people',
  member: 'Member',
};
