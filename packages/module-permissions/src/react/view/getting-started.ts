import type { OrganizationDetailView } from '../permissions-client.js';

/**
 * THE ORGANIZATION'S "GETTING STARTED" CHECKLIST (#133 P0a), as pure rules.
 *
 * After first setup (#206) the owner has an organization, a workspace and a
 * few people, and the rest is done on the normal pages: more workspaces,
 * staff, roles. This only puts those pages IN ORDER, each step ticked off by
 * what is already true, so nothing here writes anything a page could not.
 *
 * The step that matters most is the last: a member with no role in any
 * workspace sees the organization and cannot open one app in it, which reads
 * as a broken install rather than a missing role (#99: say why).
 */

/** Which section of the organization a step's link opens. */
export type GettingStartedSection = 'workspaces' | 'members';

export interface GettingStartedStep {
  key: 'workspaces' | 'people' | 'roles';
  title: string;
  /** Where things stand, in a sentence: what is done, or what is missing and why it matters. */
  detail: string;
  done: boolean;
  section: GettingStartedSection;
  /** The link's words. */
  action: string;
}

function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`;
}

/** The three steps for `detail`, in the order they are done. */
export function gettingStartedSteps(
  detail: Pick<OrganizationDetailView, 'workspaces' | 'members' | 'invitations'>,
): GettingStartedStep[] {
  const workspaces = detail.workspaces.filter((workspace) => !workspace.archived);
  const active = detail.members.filter((member) => member.status === 'active');
  const invited = detail.invitations.filter((invitation) => invitation.state === 'pending').length;

  // Who holds a role in at least one live workspace: the ones who can open its apps.
  const withWorkspaceRole = new Set<string>();
  for (const workspace of workspaces) {
    for (const member of workspace.members) {
      if (member.roles.length > 0) withWorkspaceRole.add(member.userId);
    }
  }
  const withoutApps = active.filter((member) => !withWorkspaceRole.has(member.userId)).length;

  return [
    {
      key: 'workspaces',
      title: 'Workspaces for where work happens',
      detail:
        workspaces.length === 0
          ? 'There is no workspace yet, so there is nowhere to use the apps. Add one for each place work happens: a counter, a kitchen, a branch.'
          : `${workspaces.map((workspace) => workspace.name).join(', ')}. Add one for each other place work happens, if any.`,
      done: workspaces.length > 0,
      section: 'workspaces',
      action: workspaces.length === 0 ? 'Add a workspace' : 'Open workspaces',
    },
    {
      key: 'people',
      title: 'Your staff',
      detail:
        active.length + invited > 1
          ? `${people(active.length)} in the organization${invited ? `, ${people(invited)} invited` : ''}.`
          : 'Only you so far. Invite each person who will use the app, so each signs in as themselves.',
      done: active.length + invited > 1,
      section: 'members',
      action: 'Open members',
    },
    {
      key: 'roles',
      title: 'A role in a workspace for each person',
      detail:
        withoutApps === 0
          ? 'Everyone has a role in a workspace, so each can open its apps.'
          : `${people(withoutApps)} ${withoutApps === 1 ? 'has' : 'have'} no role in any workspace yet, so they cannot open any app. Add them to a workspace and choose their role there.`,
      done: withoutApps === 0,
      section: 'workspaces',
      action: 'Give roles',
    },
  ];
}

/** True when every step is done: the checklist then stays out of the way. */
export function isGettingStartedDone(steps: readonly Pick<GettingStartedStep, 'done'>[]): boolean {
  return steps.every((step) => step.done);
}
