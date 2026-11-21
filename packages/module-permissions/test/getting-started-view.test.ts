import { gettingStartedSteps, isGettingStartedDone } from '../src/react/view/getting-started.js';

/** #133 P0a: the organization's checklist after first setup. */

type Detail = Parameters<typeof gettingStartedSteps>[0];

function member(userId: string, status = 'active') {
  return {
    membershipId: `m-${userId}`,
    userId,
    status,
    roles: [],
    joinedAt: '2026-11-21',
    workspaceIds: [],
  } as unknown as Detail['members'][number];
}
function workspace(name: string, members: Array<{ userId: string; role: boolean }>, archived = false) {
  return {
    id: name,
    key: name.toLowerCase(),
    name,
    archived,
    members: members.map(({ userId, role }) => ({
      workspaceMemberId: `wm-${userId}`,
      membershipId: `m-${userId}`,
      userId,
      roles: role ? [{ id: 'r', key: 'workspace-user', label: 'Staff', level: 'workspace', icon: null }] : [],
    })),
  } as unknown as Detail['workspaces'][number];
}
function invitation(state: string) {
  return { state } as unknown as Detail['invitations'][number];
}

describe('the getting-started checklist', () => {
  it('right after first setup with only the owner: workspaces done, staff and roles not', () => {
    const steps = gettingStartedSteps({
      workspaces: [workspace('Counter', [{ userId: 'owner', role: true }])],
      members: [member('owner')],
      invitations: [],
    });
    expect(steps.map((step) => [step.key, step.done])).toEqual([
      ['workspaces', true],
      ['people', false],
      ['roles', true],
    ]);
    expect(steps[0]?.detail).toMatch(/^Counter\./);
    expect(steps[1]?.detail).toMatch(/^Only you so far/);
    expect(isGettingStartedDone(steps)).toBe(false);
  });

  it('⚠ names the people who cannot open any app, and why', () => {
    const steps = gettingStartedSteps({
      workspaces: [
        workspace('Counter', [
          { userId: 'owner', role: true },
          { userId: 'cara', role: false },
        ]),
      ],
      members: [member('owner'), member('cara'), member('dan')],
      invitations: [],
    });
    const roles = steps.find((step) => step.key === 'roles');
    expect(roles?.done).toBe(false);
    expect(roles?.detail).toBe(
      '2 people have no role in any workspace yet, so they cannot open any app. Add them to a workspace and choose their role there.',
    );
  });

  it('counts invitations as staff, and ignores archived workspaces and inactive members', () => {
    const steps = gettingStartedSteps({
      workspaces: [workspace('Old', [{ userId: 'owner', role: true }], true)],
      members: [member('owner'), member('gone', 'suspended')],
      invitations: [invitation('pending'), invitation('revoked')],
    });
    expect(steps.find((step) => step.key === 'workspaces')?.done).toBe(false);
    expect(steps.find((step) => step.key === 'people')).toMatchObject({
      done: true,
      detail: '1 person in the organization, 1 person invited.',
    });
    expect(steps.find((step) => step.key === 'roles')?.detail).toMatch(/^1 person has no role/);
  });

  it('is done, and out of the way, once every step is', () => {
    const steps = gettingStartedSteps({
      workspaces: [
        workspace('Counter', [
          { userId: 'owner', role: true },
          { userId: 'cara', role: true },
        ]),
      ],
      members: [member('owner'), member('cara')],
      invitations: [],
    });
    expect(isGettingStartedDone(steps)).toBe(true);
  });
});
