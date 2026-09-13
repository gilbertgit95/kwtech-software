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
import { QuickEmojiSection } from '../components/quick-emoji-section.js';
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
   * ⚠ A DIRECT CHAT HAS NO **GROUP** SETTINGS, AND THAT IS NOT THE SAME AS NONE.
   *
   * It cannot be renamed — it is named by who is in it — cannot take a third
   * person, and is not one person's to archive on the other's behalf. So none
   * of the sections below apply, and this branch renders its own short page
   * rather than the group one with five `isDirect ?` holes cut in it. Those
   * holes were there briefly and were the wrong shape: a layout that is mostly
   * absent is a different layout, not the same one with conditions.
   *
   * ⚠ What it DOES have is the viewer's own quick emoji, which belongs to the
   * person rather than the conversation and is available to every participant.
   * This page previously said "a direct conversation has no settings" and
   * returned — a sentence that was true until that section existed, and which
   * left the setting unreachable in every DM.
   */
  if (conversation.isDirect) {
    return (
      <ChatSubPage
        title={conversationTitle(conversation)}
        description="Your own settings for this conversation. Nothing here is shared with the other person."
      >
        <QuickEmojiSection conversationId={conversationId} />

        <p className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">
          A direct conversation has nothing else to configure: it is named by who is in it, only the two of you are ever
          in it, and neither of you can archive it on the other's behalf.
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

      {/*
        ⚠ NOT ON A DIRECT CHAT, and not because of a role. A DM is NAMED BY WHO
        IS IN IT — that is why `title` is nullable in the schema at all — so
        there is nothing to rename and nobody who could. The fallback below says
        "only an owner or an admin can rename this", which on a DM would be a
        sentence about a hierarchy that does not exist and a permission nobody
        has.
      */}
      {conversation.isDirect ? null : (
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
      )}

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

      {/*
        ⚠ THE VIEWER'S OWN, and the one section here that is not role-gated —
        see `QuickEmojiSection`. Shared with the direct-chat layout above rather
        than written twice, which is what stops the two drifting.
      */}
      <div className="border-b border-border py-6">
        <QuickEmojiSection conversationId={conversationId} />
      </div>

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
