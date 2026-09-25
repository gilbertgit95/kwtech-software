import { featureSpecOf } from '../src/react/permissions-client.js';

/**
 * The Features page, the role editor and the plan editor all read the feature
 * list from the API — every module's keys — and run the registry's own rules
 * over it. This is the one conversion they share.
 */
describe('featureSpecOf', () => {
  it('keeps another module’s key whole: level, tags and where it is enforced', () => {
    expect(
      featureSpecOf({
        key: 'notification:send',
        module: 'notification',
        label: 'Send notifications',
        description: 'Send as the platform.',
        isPrivileged: true,
        level: 'app',
        tags: ['notification'],
        bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.sendNotification' }],
      }),
    ).toEqual({
      key: 'notification:send',
      module: 'notification',
      label: 'Send notifications',
      description: 'Send as the platform.',
      isPrivileged: true,
      level: 'app',
      tags: ['notification'],
      bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.sendNotification' }],
    });
  });
});
