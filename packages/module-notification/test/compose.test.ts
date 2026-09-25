import { NOTIFICATION_TITLE_MAX, type NotificationSendInput, prepareSend } from '../src/domain/compose.js';
import { prepareContext, readContext } from '../src/domain/context.js';
import { composeSources, NOTIFICATION_PLATFORM_SOURCE } from '../src/domain/sources.js';

const rules = {
  sources: composeSources([{ key: 'queue.session', label: 'Queue', mutable: true }]),
  maxRecipients: 3,
  hrefPolicy: { allowHttp: false },
};

const base: NotificationSendInput = { recipientIds: ['u1'], title: 'Hello', source: 'queue.session' };

describe('prepareSend', () => {
  it('fills the defaults: info, global, no buttons, the system as sender', () => {
    const result = prepareSend(base, rules);
    expect(result).toMatchObject({
      recipientIds: ['u1'],
      severity: 'info',
      title: 'Hello',
      body: null,
      organizationId: null,
      workspaceId: null,
      actions: [],
      group: null,
      senderId: null,
    });
  });

  it('⚠ de-duplicates recipients rather than refusing — two rows would be two toasts for one event', () => {
    const result = prepareSend({ ...base, recipientIds: ['u1', 'u2', 'u1', ' '] }, rules);
    expect('recipientIds' in result ? result.recipientIds : null).toEqual(['u1', 'u2']);
  });

  it('refuses no recipients, too many recipients, and an undeclared source — each with its reason', () => {
    expect(prepareSend({ ...base, recipientIds: [] }, rules)).toMatchObject({ refused: 'no_recipients' });
    expect(prepareSend({ ...base, recipientIds: ['a', 'b', 'c', 'd'] }, rules)).toMatchObject({
      refused: 'too_many_recipients',
    });
    expect(prepareSend({ ...base, source: 'made.up' }, rules)).toMatchObject({ refused: 'unknown_source' });
  });

  it('accepts the platform source the module always declares', () => {
    expect(prepareSend({ ...base, source: NOTIFICATION_PLATFORM_SOURCE.key }, rules)).toMatchObject({
      source: NOTIFICATION_PLATFORM_SOURCE,
    });
  });

  it('refuses an empty or overlong title', () => {
    expect(prepareSend({ ...base, title: '   ' }, rules)).toMatchObject({ refused: 'invalid' });
    expect(prepareSend({ ...base, title: 'x'.repeat(NOTIFICATION_TITLE_MAX + 1) }, rules)).toMatchObject({
      refused: 'invalid',
    });
  });

  it('⚠ refuses a notification that is both deduped and grouped — a group would count a re-send', () => {
    expect(prepareSend({ ...base, dedupeKey: 'k', group: { key: 'g', title: '{count} things' } }, rules)).toMatchObject(
      { refused: 'invalid' },
    );
  });

  it('refuses a group title that would overflow the column once the count grows', () => {
    const title = `{count}${'x'.repeat(NOTIFICATION_TITLE_MAX - 3)}`;
    expect(prepareSend({ ...base, group: { key: 'g', title } }, rules)).toMatchObject({ refused: 'invalid' });
  });
});

describe('context — global, organization or workspace, and nothing else', () => {
  it('maps each shape to the two columns and back', () => {
    expect(prepareContext(undefined)).toEqual({ organizationId: null, workspaceId: null, contextLabel: null });
    expect(prepareContext({ scope: 'organization', organizationId: 'o1', label: 'Acme' })).toEqual({
      organizationId: 'o1',
      workspaceId: null,
      contextLabel: 'Acme',
    });
    expect(prepareContext({ scope: 'workspace', organizationId: 'o1', workspaceId: 'w1' })).toEqual({
      organizationId: 'o1',
      workspaceId: 'w1',
      contextLabel: null,
    });
    expect(readContext({ organizationId: null, workspaceId: null })).toEqual({ scope: 'global' });
    expect(readContext({ organizationId: 'o1', workspaceId: 'w1' })).toEqual({
      scope: 'workspace',
      organizationId: 'o1',
      workspaceId: 'w1',
    });
  });

  it('⚠ reads a workspace with no organization as NOTHING, so it is dropped rather than drawn', () => {
    expect(readContext({ organizationId: null, workspaceId: 'w1' })).toBeNull();
  });

  it('refuses a workspace context missing its workspace, and a missing organization', () => {
    expect(prepareContext({ scope: 'workspace', organizationId: 'o1', workspaceId: '' })).toHaveProperty('refused');
    expect(prepareContext({ scope: 'organization', organizationId: '' })).toHaveProperty('refused');
  });
});

describe('composeSources', () => {
  it('puts the platform source first, then the app’s', () => {
    expect(composeSources([{ key: 'queue', label: 'Queue', mutable: true }]).map((source) => source.key)).toEqual([
      'platform',
      'queue',
    ]);
  });

  it('⚠ throws at boot on a duplicate key — muting one would otherwise mute the other', () => {
    expect(() => composeSources([{ key: 'platform', label: 'Mine', mutable: true }])).toThrow(/declared twice/);
  });

  it('throws on a malformed key or an empty label', () => {
    expect(() => composeSources([{ key: 'Has Spaces', label: 'X', mutable: true }])).toThrow(/not a valid key/);
    expect(() => composeSources([{ key: 'ok', label: ' ', mutable: true }])).toThrow(/needs a label/);
  });
});
