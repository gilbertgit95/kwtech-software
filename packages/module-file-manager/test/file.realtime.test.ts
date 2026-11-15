import { fileEventReaches } from '../src/domain/events.js';
import { ANA, BEN, CAL, harness, SCOPE, uploadAs } from './harness.js';

const viewer = (userId: string) => ({ userId, ...SCOPE });

describe('who hears about a file', () => {
  it('⚠ tells nobody but the owner about a private upload', async () => {
    const h = harness();
    await uploadAs(h, ANA, 'mine.txt', 'x');
    const [event] = h.pubsub.sent;
    expect(event ? [ANA, BEN].map((id) => fileEventReaches(event, viewer(id))) : null).toEqual([true, false]);
  });

  it('tells the people who LOST a file that it changed, so their list drops it', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.txt', 'x', { visibility: 'people', sharedWith: [BEN] });
    await h.writes.setSharing(SCOPE, ANA, saved.file.id, { visibility: 'private', sharedWith: [] });
    const last = h.pubsub.sent.at(-1);
    expect(last ? [BEN, CAL].map((id) => fileEventReaches(last, viewer(id))) : null).toEqual([true, false]);
  });

  it('carries no file name and no size', async () => {
    const h = harness();
    await uploadAs(h, ANA, 'secret-plans.txt', 'x', { visibility: 'workspace' });
    expect(JSON.stringify(h.pubsub.sent)).not.toContain('secret-plans');
  });

  it('tells everybody in the workspace about a settings change, and nobody elsewhere', async () => {
    const h = harness();
    await h.writes.setSettings(SCOPE, ANA, 12);
    const [event] = h.pubsub.sent;
    expect(event ? fileEventReaches(event, viewer(CAL)) : null).toBe(true);
    expect(event ? fileEventReaches(event, { userId: CAL, organizationId: 'org-1', workspaceId: 'ws-2' }) : null).toBe(
      false,
    );
  });
});
