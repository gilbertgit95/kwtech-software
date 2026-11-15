import type { ProcessRunContext } from '@kwtech/module-kit';
import { FILE_PROCESS_REGISTRY } from '../src/processes.js';
import { ANA, harness, SCOPE, uploadAs } from './harness.js';

const DECLARED = FILE_PROCESS_REGISTRY[0];

function context(now: Date, overrides: Partial<ProcessRunContext> = {}): ProcessRunContext {
  if (!DECLARED) throw new Error('file.cleanup is not declared');
  return {
    now,
    schedule: DECLARED.defaultSchedule,
    maxItems: DECLARED.maxItemsPerRun,
    tooLateAfterMinutes: DECLARED.tooLateAfterMinutes,
    signal: new AbortController().signal,
    async workspaces() {
      return { workspaces: [{ ...SCOPE, timeZone: 'Asia/Manila' }], nextCursor: null };
    },
    async organizations() {
      return { organizations: [], nextCursor: null };
    },
    ...overrides,
  } as ProcessRunContext;
}

/** Monday 16 Nov 2026, 21:00 in Manila. */
const MONDAY_9PM = new Date('2026-11-16T13:00:00.000Z');
/** The clean-ups, 22:00 Manila, and a sweep a few minutes after each. */
const MONDAY_10PM = new Date('2026-11-16T14:05:00.000Z');
const TUESDAY_10PM = new Date('2026-11-17T14:05:00.000Z');

describe('the nightly clean-up', () => {
  it('keeps a file uploaded at 9 PM on Monday that night, and deletes it at 10 PM on Tuesday', async () => {
    const h = harness();
    h.client.now = MONDAY_9PM;
    await uploadAs(h, ANA, 'monday.txt', 'x');

    expect(await h.cleanup.run(context(MONDAY_10PM))).toMatchObject({ handled: 0 });
    expect(h.client.state.fileEntry).toHaveLength(1);

    expect(await h.cleanup.run(context(TUESDAY_10PM))).toMatchObject({ handled: 1 });
    expect(h.client.state.fileEntry).toEqual([]);
    expect(h.store.bytes.size).toBe(0);
  });

  it('does nothing before 10 PM, however old the file', async () => {
    const h = harness();
    h.client.now = new Date('2026-11-10T00:00:00.000Z');
    await uploadAs(h, ANA, 'old.txt', 'x');
    const tuesdayNoon = new Date('2026-11-17T04:00:00.000Z');
    expect(await h.cleanup.run(context(tuesdayNoon))).toMatchObject({ handled: 0 });
    expect(h.client.state.fileEntry).toHaveLength(1);
  });

  it('⚠ deletes the same files on a late sweep: measured from 10 PM, not from when it ran', async () => {
    const h = harness();
    // Tuesday 22:30 Manila: older than 24 hours by 11:30 PM, but not by 10 PM.
    h.client.now = new Date('2026-11-16T14:30:00.000Z');
    await uploadAs(h, ANA, 'late-monday.txt', 'x');
    const tuesdayAt1130 = new Date('2026-11-17T15:30:00.000Z');
    expect(await h.cleanup.run(context(tuesdayAt1130))).toMatchObject({ handled: 0 });
    expect(h.client.state.fileEntry).toHaveLength(1);
  });

  it('runs twice and the second does nothing', async () => {
    const h = harness();
    h.client.now = MONDAY_9PM;
    await uploadAs(h, ANA, 'monday.txt', 'x');
    await h.cleanup.run(context(TUESDAY_10PM));
    expect(await h.cleanup.run(context(TUESDAY_10PM))).toMatchObject({ handled: 0 });
  });

  it('stops at its item limit, and the next sweep finishes', async () => {
    const h = harness();
    h.client.now = MONDAY_9PM;
    for (const name of ['a', 'b', 'c']) await uploadAs(h, ANA, `${name}.txt`, 'x');

    expect(await h.cleanup.run(context(TUESDAY_10PM, { maxItems: 2 }))).toMatchObject({ handled: 2, leftForNext: 1 });
    expect(await h.cleanup.run(context(TUESDAY_10PM, { maxItems: 2 }))).toMatchObject({ handled: 1, leftForNext: 0 });
    expect(h.client.state.fileEntry).toEqual([]);
  });

  it('follows the workspace’s setting', async () => {
    const h = harness();
    await h.writes.setSettings(SCOPE, ANA, 48);
    h.client.now = MONDAY_9PM;
    await uploadAs(h, ANA, 'monday.txt', 'x');
    await h.cleanup.run(context(TUESDAY_10PM));
    expect(h.client.state.fileEntry).toHaveLength(1);
  });

  it('removes bytes with no row once they are an hour old, and never a file’s own', async () => {
    const h = harness();
    h.client.now = TUESDAY_10PM;
    const kept = await uploadAs(h, ANA, 'kept.txt', 'x');
    const stray = 'f'.repeat(32);
    h.store.bytes.set(`${SCOPE.workspaceId}/${stray}`, Buffer.from('lost'));
    h.store.touched.set(`${SCOPE.workspaceId}/${stray}`, new Date('2026-11-17T10:00:00.000Z'));
    h.store.touched.set(`${SCOPE.workspaceId}/${kept.file.storageKey}`, new Date('2026-11-17T10:00:00.000Z'));

    expect(await h.cleanup.run(context(TUESDAY_10PM))).toMatchObject({ handled: 1 });
    expect(h.store.bytes.has(`${SCOPE.workspaceId}/${stray}`)).toBe(false);
    expect(h.store.bytes.has(`${SCOPE.workspaceId}/${kept.file.storageKey}`)).toBe(true);
  });

  it('follows each workspace’s own 10 PM: one instant, one zone due and one not', async () => {
    const h = harness();
    h.client.now = new Date('2026-11-15T00:00:00.000Z');
    await uploadAs(h, ANA, 'old.txt', 'x');
    // 14:05Z is 22:05 in Manila and 14:05 in London.
    const inLondon = context(TUESDAY_10PM, {
      async workspaces() {
        return { workspaces: [{ ...SCOPE, timeZone: 'Europe/London' }], nextCursor: null };
      },
    });
    expect(await h.cleanup.run(inLondon)).toMatchObject({ handled: 0 });
    expect(await h.cleanup.run(context(TUESDAY_10PM))).toMatchObject({ handled: 1 });
  });

  it('declares every limit', () => {
    expect(DECLARED).toMatchObject({
      key: 'file.cleanup',
      serves: 'file:read',
      defaultSchedule: { kind: 'daily', times: ['22:00'] },
    });
  });
});
