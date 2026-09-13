import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canArchiveConversation,
  canInviteToConversation,
  canManageConversation,
} from '../src/domain/participant-roles.js';
import type { ChatConversationView } from '../src/react/chat-client.js';
import { viewerAuthority, viewerParticipant } from '../src/react/view/conversation-view.js';

/**
 * ── WHAT THE VIEWER MAY DO HERE ────────────────────────────────────────────
 *
 * ⚠ THIS EXISTS BECAUSE A CONTROL WAS SHOWN TO PEOPLE THE SERVER REFUSES. The
 * thread header's "Add someone" was gated on `!isDirect` and nothing else, so
 * every MEMBER of a group saw it, opened the finder, found somebody, and had
 * the invitation refused by the API. The conversation settings page had gated
 * its own copy from the start — the bridge from the wire shape to the domain's
 * rules lived inside one hook, so the other surface simply did not have it.
 *
 * One helper now, so "what may this viewer do here" has one answer.
 */

const conversation = (over: Partial<ChatConversationView> = {}): ChatConversationView => ({
  id: 'c1',
  title: 'Team',
  icon: null,
  isDirect: false,
  createdById: 'ann',
  archived: false,
  lastMessageAt: null,
  myStatus: 'active',
  myUserId: 'bob',
  unread: 0,
  preview: null,
  participants: [
    { userId: 'ann', displayName: 'Ann', status: 'active', role: 'owner' },
    { userId: 'bob', displayName: 'Bob', status: 'active', role: 'member' },
  ],
  ...over,
});

describe('viewerParticipant', () => {
  it('finds the viewer’s own row by myUserId', () => {
    expect(viewerParticipant(conversation())).toMatchObject({ userId: 'bob', role: 'member' });
  });

  /**
   * ⚠ NARROWED, NOT CAST. `role` crosses GraphQL as a plain string, and a value
   * this build does not know must not be read as authority it cannot verify.
   * `member` is the floor and the safe direction.
   */
  it('⚠ falls back to member for a role this build does not know', () => {
    const odd = conversation({
      participants: [{ userId: 'bob', displayName: 'Bob', status: 'active', role: 'superuser' }],
    });

    expect(viewerParticipant(odd)?.role).toBe('member');
    expect(canInviteToConversation(viewerAuthority(odd))).toBe(false);
  });

  it('returns undefined when the viewer is not in the list, which reads as no authority', () => {
    const absent = conversation({
      participants: [{ userId: 'ann', displayName: 'Ann', status: 'active', role: 'owner' }],
    });

    expect(viewerParticipant(absent)).toBeUndefined();
    expect(canInviteToConversation(viewerAuthority(absent))).toBe(false);
    expect(canManageConversation(viewerAuthority(absent))).toBe(false);
    expect(canArchiveConversation(viewerAuthority(absent))).toBe(false);
  });
});

describe('what each role may do, as the screen asks it', () => {
  const asRole = (role: string) =>
    viewerAuthority(conversation({ participants: [{ userId: 'bob', displayName: 'Bob', status: 'active', role }] }));

  /** ⚠ THE BUG. A member saw "Add someone" and the API refused it. */
  it('⚠ a MEMBER may not invite', () => {
    expect(canInviteToConversation(asRole('member'))).toBe(false);
  });

  it('an admin may invite but may not archive — the delegate’s whole shape', () => {
    expect(canInviteToConversation(asRole('admin'))).toBe(true);
    expect(canManageConversation(asRole('admin'))).toBe(true);
    // Archiving frees the creator's cap slot and takes the room off everybody's
    // list at once. A delegate who can add people should not put it away.
    expect(canArchiveConversation(asRole('admin'))).toBe(false);
  });

  it('an owner may do all three', () => {
    expect(canInviteToConversation(asRole('owner'))).toBe(true);
    expect(canManageConversation(asRole('owner'))).toBe(true);
    expect(canArchiveConversation(asRole('owner'))).toBe(true);
  });

  /** Somebody merely INVITED commands nothing, whatever role the row carries. */
  it('an invited person commands nothing', () => {
    const invited = viewerAuthority(
      conversation({ participants: [{ userId: 'bob', displayName: 'Bob', status: 'invited', role: 'owner' }] }),
    );

    expect(canInviteToConversation(invited)).toBe(false);
    expect(canManageConversation(invited)).toBe(false);
  });
});

/**
 * ⚠ THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. Reading source
 * rather than rendering, for the reason `chat-sub-pages.test.ts` does: nothing
 * here runs a React renderer, and the property worth protecting is structural.
 */
describe('the surfaces that offer to add somebody', () => {
  const read = (relative: string) => readFileSync(join(__dirname, '..', 'src', 'react', relative), 'utf8');

  it('⚠ the thread header gates its invite on the domain rule, not just on isDirect', () => {
    const source = read('components/message-thread.tsx');

    expect(source).toContain('canInviteToConversation');
    // Both conditions, because either alone shipped a wrong control once.
    expect(source).toContain('!conversation.isDirect && canInvite');
  });

  it('the settings page gates its invite on the same rule', () => {
    expect(read('pages/chat-settings-page.tsx')).toContain('canInviteToConversation');
  });

  /**
   * ⚠ THE GAP A PREVIOUS COMMIT CREATED. The settings link was groups-only,
   * on the reasoning that "a direct chat has no settings at all" — true of
   * everything on that page at the time. It stopped being true the moment the
   * page gained the viewer's OWN quick emoji, which is per-device, invisible to
   * the other person, and exactly as applicable to a DM. Hiding the link left
   * that setting unreachable in every direct conversation.
   */
  it('⚠ offers the settings link on a DIRECT chat too, or its quick emoji is unreachable', () => {
    const source = read('components/message-thread.tsx');

    // The link is no longer inside a `!conversation.isDirect` branch.
    expect(source).not.toContain('{!conversation.isDirect ? (\n            <a');
    expect(source).toContain("conversation.isDirect ? 'Options' : 'Settings'");
  });

  /**
   * ⚠ BUT THE GROUP-ONLY CONTROLS STAY GROUP-ONLY. A DM cannot be renamed —
   * it is named by who is in it — cannot take a third person, and is not one
   * person's to archive or leave.
   */
  it('⚠ keeps rename, invite, leave and roles off a direct chat', () => {
    const thread = read('components/message-thread.tsx');
    const page = read('pages/chat-settings-page.tsx');

    expect(thread).toContain('!conversation.isDirect && canInvite');
    // Rename and the role labels are both behind an isDirect check on the page.
    expect(page).toContain('{conversation.isDirect ? null : (');
    expect(page).toContain('conversation.isDirect');
  });

  /**
   * ⚠ THE SAME CATALOGUE IN BOTH SETTINGS SCREENS. They offered a hand-written
   * list of ten while the composer offered a hundred and sixty — for what is
   * the same choice.
   */
  it('⚠ lets every screen choose from the whole catalogue, never a shortlist', () => {
    // The default is chosen straight from the grid; a conversation's override
    // reaches it through the shared section. Neither may reintroduce a shortlist.
    expect(read('pages/chat-preferences-page.tsx')).toContain('<EmojiGrid');
    expect(read('components/quick-emoji-section.tsx')).toContain('<EmojiGrid');

    for (const file of [
      'pages/chat-preferences-page.tsx',
      'pages/chat-settings-page.tsx',
      'components/quick-emoji-section.tsx',
    ]) {
      expect(read(file)).not.toContain('QUICK_EMOJI_CHOICES');
    }
  });

  /**
   * ⚠ THE GAP THE OPERATOR REPORTED. A direct conversation returned early with
   * "a direct conversation has no settings" — true until the page gained a
   * setting belonging to the VIEWER rather than to the conversation. Its own
   * layout must render the quick emoji section, or the setting is unreachable
   * in every DM again.
   */
  it('⚠ gives a direct chat its own layout, carrying the quick emoji section', () => {
    const page = read('pages/chat-settings-page.tsx');

    expect(page).toContain('if (conversation.isDirect)');
    // Rendered in BOTH branches, from one shared component.
    expect(page.match(/<QuickEmojiSection/g) ?? []).toHaveLength(2);
    expect(page).not.toContain('A direct conversation has no settings.');
  });

  /**
   * ⚠ AVAILABLE TO EVERY PARTICIPANT. It is the viewer's own preference, stored
   * in their browser and invisible to everybody else, so a member has exactly as
   * much right to it as an owner — and a DM has no roles at all.
   */
  it('⚠ keeps the quick emoji section outside every role check', () => {
    const section = read('components/quick-emoji-section.tsx');

    for (const gate of ['canManageConversation', 'canInviteToConversation', 'canArchiveConversation', 'roleOf']) {
      expect(section).not.toContain(gate);
    }
  });

  /**
   * ⚠ A SEPARATE KEY FROM READING. A role can hold `chat:read` without
   * `chat:start` — somebody who may follow conversations they are added to and
   * may not open new ones.
   */
  it('⚠ the conversation list gates New on chat:start', () => {
    const source = read('components/conversation-list.tsx');

    expect(source).toContain('useHoldsFeature(CHAT_FEATURE.start)');
    expect(source).toContain('{canStart ? (');
  });
});
