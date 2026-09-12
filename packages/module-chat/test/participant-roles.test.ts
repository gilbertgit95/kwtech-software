import {
  type ActorAuthority,
  canArchiveConversation,
  canInviteToConversation,
  canManageConversation,
  refuseRoleChange,
  refuseRoleRemoval,
  roleOf,
  rolesApply,
  successorTo,
  transferOwnership,
} from '../src/domain/participant-roles.js';
import type { ChatParticipantRole, ParticipantStatus, ParticipantView } from '../src/types.js';

/**
 * Authority INSIDE one conversation, and the app level reaching down into it.
 *
 * Every rule is a function over a literal, so the ones that matter — the owner
 * who cannot be removed, the admins who cannot police each other, the platform
 * key that manages without reading — are settled here rather than in a browser.
 */

const person = (
  userId: string,
  role: ChatParticipantRole = 'member',
  status: ParticipantStatus = 'active',
): ParticipantView => ({ conversationId: 'c1', userId, status, role });

/** Somebody in the room. */
const inRoom = (participant: ParticipantView): ActorAuthority => ({ participant });
/** Somebody holding the app-level key, with no row at all. */
const fromAbove: ActorAuthority = { asPlatformAdmin: true };

describe('roleOf', () => {
  it('⚠ reads an absent role as `member`, never as `owner`', () => {
    // Every row written before the column existed has no value, and the safe
    // reading of "we do not know" is the one that grants nothing.
    expect(roleOf({ conversationId: 'c1', userId: 'ann', status: 'active' })).toBe('member');
    expect(roleOf(null)).toBe('member');
  });
});

describe('managing a conversation', () => {
  it('is the owner’s and the admin’s', () => {
    expect(canManageConversation(inRoom(person('ann', 'owner')))).toBe(true);
    expect(canManageConversation(inRoom(person('bob', 'admin')))).toBe(true);
  });

  it('⚠ is NOT every participant’s, which is what shipped', () => {
    // Renaming was bound to `chat:start` and therefore open to anybody in the
    // group. That was not a decision, it was the absence of one.
    expect(canManageConversation(inRoom(person('cat', 'member')))).toBe(false);
  });

  it('⚠ asks STATUS before role — a removed owner still carries `owner`', () => {
    // Nothing rewrites the column on the way out, and nothing should.
    expect(canManageConversation(inRoom(person('ann', 'owner', 'removed')))).toBe(false);
    expect(canManageConversation(inRoom(person('ann', 'owner', 'invited')))).toBe(false);
  });

  it('is refused to somebody with no row at all', () => {
    expect(canManageConversation({})).toBe(false);
  });
});

describe('archiving', () => {
  it('⚠ is the OWNER’s alone — an admin does not get it', () => {
    // It frees the creator's cap slot and takes the room off everybody's list.
    // A delegate who can add people should not be able to put the room away.
    expect(canArchiveConversation(inRoom(person('ann', 'owner')))).toBe(true);
    expect(canArchiveConversation(inRoom(person('bob', 'admin')))).toBe(false);
  });
});

describe('inviting', () => {
  it('is the owner’s and the admin’s — the delegate’s whole reason to exist', () => {
    expect(canInviteToConversation(inRoom(person('bob', 'admin')))).toBe(true);
    expect(canInviteToConversation(inRoom(person('cat', 'member')))).toBe(false);
  });
});

describe('the app level reaching down', () => {
  it('⚠ acts WITHOUT STANDING IN THE ROOM, which is the point', () => {
    // The same property every other level already has: support manages any
    // organization without belonging to it.
    expect(canManageConversation(fromAbove)).toBe(true);
    expect(canArchiveConversation(fromAbove)).toBe(true);
    expect(canInviteToConversation(fromAbove)).toBe(true);
  });

  it('removes a member and an admin', () => {
    expect(refuseRoleRemoval({ actor: fromAbove, target: person('cat', 'member') })).toBeNull();
    expect(refuseRoleRemoval({ actor: fromAbove, target: person('bob', 'admin') })).toBeNull();
  });

  it('⚠ still cannot remove the OWNER', () => {
    /*
     * Deliberate rather than an oversight. Every rule here leans on "a live
     * group has exactly one owner", and an exception would be the one path that
     * breaks it. Hand the group on first, remove second — two steps, one
     * invariant, and somebody in charge at every moment.
     */
    expect(refuseRoleRemoval({ actor: fromAbove, target: person('ann', 'owner') })).toBe('owner');
  });

  it('assigns roles, and is not subject to self-demotion having no row', () => {
    expect(refuseRoleChange({ actor: fromAbove, target: person('cat', 'member'), next: 'admin' })).toBeNull();
    expect(refuseRoleChange({ actor: fromAbove, target: person('cat', 'member'), next: 'owner' })).toBeNull();
  });
});

describe('refuseRoleRemoval', () => {
  const owner = person('ann', 'owner');
  const admin = person('bob', 'admin');
  const other = person('dan', 'admin');
  const member = person('cat', 'member');

  it('⚠ NOBODY removes the owner', () => {
    expect(refuseRoleRemoval({ actor: inRoom(admin), target: owner })).toBe('owner');
    expect(refuseRoleRemoval({ actor: inRoom(member), target: owner })).toBe('owner');
  });

  it('lets the owner remove an admin and a member', () => {
    expect(refuseRoleRemoval({ actor: inRoom(owner), target: admin })).toBeNull();
    expect(refuseRoleRemoval({ actor: inRoom(owner), target: member })).toBeNull();
  });

  it('⚠ lets an admin remove a MEMBER and not another ADMIN', () => {
    // Two admins who can remove each other is a race whose winner is whoever
    // clicks first. Peers do not police peers.
    expect(refuseRoleRemoval({ actor: inRoom(admin), target: member })).toBeNull();
    expect(refuseRoleRemoval({ actor: inRoom(admin), target: other })).toBe('not_permitted');
  });

  it('lets a member remove nobody', () => {
    expect(refuseRoleRemoval({ actor: inRoom(member), target: person('eve', 'member') })).toBe('not_permitted');
  });

  it('answers `self_removal` rather than refusing — they wanted to leave', () => {
    expect(refuseRoleRemoval({ actor: inRoom(owner), target: owner })).toBe('self_removal');
  });

  it('refuses somebody who is not in the room, and a target who is not either', () => {
    expect(refuseRoleRemoval({ actor: inRoom(person('zoe', 'owner', 'left')), target: member })).toBe(
      'not_a_participant',
    );
    expect(refuseRoleRemoval({ actor: inRoom(owner), target: person('cat', 'member', 'invited') })).toBe(
      'target_not_present',
    );
  });
});

describe('refuseRoleChange', () => {
  const owner = person('ann', 'owner');

  it('is the owner’s alone', () => {
    expect(refuseRoleChange({ actor: inRoom(owner), target: person('cat'), next: 'admin' })).toBeNull();
    expect(refuseRoleChange({ actor: inRoom(person('bob', 'admin')), target: person('cat'), next: 'admin' })).toBe(
      'not_permitted',
    );
  });

  it('⚠ refuses an owner demoting THEMSELVES', () => {
    // A group with no owner is one nobody can archive or hand on — a dead end
    // reachable in one click. Handing it to somebody else is the way out.
    expect(refuseRoleChange({ actor: inRoom(owner), target: owner, next: 'member' })).toBe('self_demotion');
  });
});

describe('transferOwnership', () => {
  it('⚠ promotes and demotes in ONE act, so there are never two owners', () => {
    // Written as two statements at a call site, the second is the one a
    // refactor loses.
    const changes = transferOwnership([person('ann', 'owner'), person('bob', 'admin'), person('cat')], 'cat');

    expect(changes).toEqual([
      { userId: 'ann', role: 'admin' },
      { userId: 'cat', role: 'owner' },
    ]);
  });

  it('⚠ leaves the outgoing owner an ADMIN, not a member', () => {
    // They built the room; dropping them to the floor in the act of handing it
    // over is a punishment nobody asked for.
    const changes = transferOwnership([person('ann', 'owner'), person('bob')], 'bob');
    expect(changes.find((one) => one.userId === 'ann')?.role).toBe('admin');
  });

  it('does nothing when the target already owns it', () => {
    expect(transferOwnership([person('ann', 'owner')], 'ann')).toEqual([]);
  });
});

describe('successorTo', () => {
  const joined = (order: Record<string, number>) => (one: ParticipantView) => order[one.userId] ?? 0;

  it('⚠ prefers an ADMIN over a member', () => {
    const successor = successorTo(
      [person('ann', 'owner'), person('cat', 'member'), person('bob', 'admin')],
      'ann',
      joined({ ann: 1, cat: 2, bob: 3 }),
    );

    // Even though the member has been there longer.
    expect(successor).toBe('bob');
  });

  it('takes the LONGEST-STANDING of them', () => {
    // "Whoever joined last" hands a group to its newest arrival.
    const successor = successorTo(
      [person('ann', 'owner'), person('bob', 'admin'), person('dan', 'admin')],
      'ann',
      joined({ ann: 1, bob: 3, dan: 2 }),
    );

    expect(successor).toBe('dan');
  });

  it('falls back to a member when there is no admin', () => {
    expect(successorTo([person('ann', 'owner'), person('cat')], 'ann', joined({ ann: 1, cat: 2 }))).toBe('cat');
  });

  it('⚠ ignores anybody who is not ACTIVE — an invitation is not a successor', () => {
    const successor = successorTo(
      [person('ann', 'owner'), person('bob', 'admin', 'invited'), person('cat', 'member', 'left')],
      'ann',
      joined({}),
    );

    expect(successor).toBeUndefined();
  });

  it('is undefined when the owner is the last one there', () => {
    expect(successorTo([person('ann', 'owner')], 'ann', joined({}))).toBeUndefined();
  });
});

describe('rolesApply', () => {
  it('⚠ says NO for a direct chat', () => {
    // Two people are equal in it, and every act a role governs is refused
    // anyway: it cannot be renamed, cannot take a third person, and is not one
    // person's to archive on the other's behalf.
    expect(rolesApply({ directKey: 'ann:bob' })).toBe(false);
    expect(rolesApply({ directKey: null })).toBe(true);
  });
});
