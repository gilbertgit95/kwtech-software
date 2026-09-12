import {
  canAccessConversation,
  canSeeInvitation,
  isLiveParticipant,
  nextParticipantStatus,
  type ParticipantTransition,
} from '../src/domain/participation.js';
import {
  type ConversationView,
  PARTICIPANT_STATUSES,
  type ParticipantStatus,
  type ParticipantView,
} from '../src/types.js';

/**
 * PARTICIPATION IS NOT PERMISSION — tested before there is a screen, because
 * C1's exact failure was a helper that existed, was exported, was used by the
 * React layer, and was never called server-side.
 */

const participant = (status: ParticipantStatus, userId = 'u1'): ParticipantView => ({
  conversationId: 'c1',
  userId,
  status,
});

const conversation = (over: Partial<ConversationView> = {}): ConversationView => ({
  id: 'c1',
  directKey: null,
  createdById: 'creator',
  archivedAt: null,
  ...over,
});

describe('canAccessConversation', () => {
  it('admits an active participant and nobody else', () => {
    for (const status of PARTICIPANT_STATUSES) {
      expect(canAccessConversation(participant(status))).toBe(status === 'active');
    }
  });

  it('⚠ refuses somebody who LEFT or was REMOVED — this is how history leaks', () => {
    expect(canAccessConversation(participant('left'))).toBe(false);
    expect(canAccessConversation(participant('removed'))).toBe(false);
  });

  it('refuses when there is no row at all, which is every conversation that is not yours', () => {
    expect(canAccessConversation(undefined)).toBe(false);
    expect(canAccessConversation(null)).toBe(false);
  });

  it('⚠ does not admit an INVITED person — they see the invitation, never the messages', () => {
    expect(canAccessConversation(participant('invited'))).toBe(false);
    expect(canSeeInvitation(participant('invited'))).toBe(true);
    expect(isLiveParticipant(participant('invited'))).toBe(true);
  });

  it('does not admit a DECLINED row, which exists only to remember the refusal', () => {
    expect(canAccessConversation(participant('declined'))).toBe(false);
    expect(isLiveParticipant(participant('declined'))).toBe(false);
  });
});

describe('nextParticipantStatus', () => {
  const cases: [ParticipantStatus, ParticipantTransition, ParticipantStatus | null][] = [
    ['invited', 'accept', 'active'],
    ['invited', 'decline', 'declined'],
    ['invited', 'leave', 'left'],
    ['invited', 'remove', 'removed'],
    ['active', 'leave', 'left'],
    ['active', 'remove', 'removed'],
    ['declined', 'reinvite', 'invited'],
    ['left', 'reinvite', 'invited'],
    ['removed', 'reinvite', 'invited'],
  ];

  it.each(cases)('%s + %s -> %s', (from, transition, expected) => {
    expect(nextParticipantStatus(from, transition)).toBe(expected);
  });

  it('⚠ refuses to accept from REMOVED, which would re-admit somebody who was taken out', () => {
    expect(nextParticipantStatus('removed', 'accept')).toBeNull();
    expect(nextParticipantStatus('left', 'accept')).toBeNull();
    expect(nextParticipantStatus('declined', 'accept')).toBeNull();
  });

  it('refuses to leave or remove somebody who is already gone', () => {
    for (const status of ['declined', 'left', 'removed'] as const) {
      expect(nextParticipantStatus(status, 'leave')).toBeNull();
      expect(nextParticipantStatus(status, 'remove')).toBeNull();
    }
  });

  it('⚠ re-invites by flipping the EXISTING row, so the refusal is remembered', () => {
    // A second row would erase the memory, and "declining only lets them ask
    // again immediately" is the harassment vector this design already refused.
    expect(nextParticipantStatus('declined', 'reinvite')).toBe('invited');
    expect(nextParticipantStatus('active', 'reinvite')).toBeNull();
  });
});
