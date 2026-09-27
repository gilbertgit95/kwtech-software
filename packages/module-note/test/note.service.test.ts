import { ANA, BEN, harness, OTHER_WORKSPACE, SCOPE } from './harness.js';

/**
 * Reading. Every query starts from what the viewer may see, so every test here
 * seeds somebody ELSE's private note and checks it never comes back.
 */

async function seeded() {
  const h = harness();
  const mine = await h.writes.create(SCOPE, ANA, { title: 'Mine', body: 'till float 100% sure', tags: ['ops'] });
  const secret = await h.writes.create(SCOPE, BEN, { title: 'Ben private', body: 'salary', tags: ['salary-review'] });
  const team = await h.writes.create(SCOPE, BEN, {
    title: 'Team',
    body: 'a_b roster',
    tags: ['ops', 'rota'],
    visibility: 'workspace',
  });
  const elsewhere = await h.writes.create(OTHER_WORKSPACE, ANA, { title: 'Other workspace', visibility: 'workspace' });
  return { ...h, mine, secret, team, elsewhere };
}

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id).sort();

describe('the index', () => {
  it('⚠ shows your notes and shared ones — never somebody else’s private note, never another workspace', async () => {
    const { reads, mine, team } = await seeded();
    const result = await reads.list(SCOPE, ANA, { view: 'all' });
    expect(ids(result.notes)).toEqual(ids([mine, team]));
  });

  it('splits the tabs: mine, shared, and the trash', async () => {
    const { reads, writes, mine, team } = await seeded();
    expect(ids((await reads.list(SCOPE, ANA, { view: 'mine' })).notes)).toEqual([mine.id]);
    expect(ids((await reads.list(SCOPE, ANA, { view: 'shared' })).notes)).toEqual([team.id]);

    await writes.trash(SCOPE, ANA, mine.id);
    expect(ids((await reads.list(SCOPE, ANA, { view: 'trash' })).notes)).toEqual([mine.id]);
    expect(ids((await reads.list(SCOPE, ANA, { view: 'all' })).notes)).toEqual([team.id]);
  });

  it('⚠ keeps somebody else’s private note out of the trash tab too', async () => {
    const { reads, writes, secret } = await seeded();
    await writes.trash(SCOPE, BEN, secret.id);
    expect((await reads.list(SCOPE, ANA, { view: 'trash' })).notes).toEqual([]);
  });

  it('never carries a body — the index reads the preview', async () => {
    const { reads } = await seeded();
    const result = await reads.list(SCOPE, ANA, { view: 'all' });
    for (const note of result.notes) expect(note).not.toHaveProperty('body');
  });
});

describe('search', () => {
  it('⚠ finds only what the viewer can see, however well the term matches', async () => {
    const { reads } = await seeded();
    expect((await reads.list(SCOPE, ANA, { view: 'all', search: 'salary' })).notes).toEqual([]);
  });

  it('matches title or body, ignoring case', async () => {
    const { reads, mine, team } = await seeded();
    expect(ids((await reads.list(SCOPE, ANA, { view: 'all', search: 'TILL' })).notes)).toEqual([mine.id]);
    expect(ids((await reads.list(SCOPE, ANA, { view: 'all', search: 'team' })).notes)).toEqual([team.id]);
  });

  it('⚠ treats % and _ as the characters typed, not wildcards', async () => {
    const { reads, writes, mine, team } = await seeded();
    await writes.create(SCOPE, ANA, { body: '100 apples and axb' });

    expect(ids((await reads.list(SCOPE, ANA, { view: 'all', search: '100%' })).notes)).toEqual([mine.id]);
    expect(ids((await reads.list(SCOPE, ANA, { view: 'all', search: 'a_b' })).notes)).toEqual([team.id]);
  });
});

describe('tags', () => {
  it('filters by one tag, normalised as it is stored', async () => {
    const { reads, mine, team } = await seeded();
    expect(ids((await reads.list(SCOPE, ANA, { view: 'all', tag: '#OPS' })).notes)).toEqual(ids([mine, team]));
  });

  it('⚠ lists only tags on notes the viewer can see — a private note’s tag never leaks', async () => {
    const { reads } = await seeded();
    const result = await reads.list(SCOPE, ANA, { view: 'all' });
    expect(result.tags).toEqual(['ops', 'rota']);
    expect(result.tags).not.toContain('salary-review');
  });
});

describe('pins', () => {
  it('lifts the viewer’s pinned notes above the list, and leaves them out of it', async () => {
    const { reads, writes, team, mine } = await seeded();
    await writes.setPinned(SCOPE, ANA, team.id, true);

    const result = await reads.list(SCOPE, ANA, { view: 'all' });
    expect(ids(result.pinned)).toEqual([team.id]);
    expect(ids(result.notes)).toEqual([mine.id]);
    expect([...result.pinnedIds]).toEqual([team.id]);
  });

  it('are nobody else’s business', async () => {
    const { reads, writes, team } = await seeded();
    await writes.setPinned(SCOPE, ANA, team.id, true);
    expect((await reads.list(SCOPE, BEN, { view: 'all' })).pinned).toEqual([]);
  });

  it('⚠ a pin on a note later unshared shows nothing', async () => {
    const { reads, writes, team } = await seeded();
    await writes.setPinned(SCOPE, ANA, team.id, true);
    await writes.setVisibility(SCOPE, BEN, team.id, 'private');
    const result = await reads.list(SCOPE, ANA, { view: 'all' });
    expect(result.pinned).toEqual([]);
    expect(ids(result.notes)).not.toContain(team.id);
  });
});

describe('paging', () => {
  it('walks every visible note exactly once, newest first', async () => {
    const { reads, writes } = harness();
    for (let i = 0; i < 7; i += 1) await writes.create(SCOPE, ANA, { title: `n${i}` });

    const seen: string[] = [];
    let cursor: { updatedAt: Date; id: string } | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await reads.list(SCOPE, ANA, { view: 'all', limit: 3, cursor });
      seen.push(...result.notes.map((note) => note.title));
      if (page > 0) expect(result.tags).toBeNull();
      if (!result.next) break;
      cursor = result.next;
    }
    expect(seen).toEqual(['n6', 'n5', 'n4', 'n3', 'n2', 'n1', 'n0']);
  });
});

describe('one note', () => {
  it('comes back with its body when the viewer may see it', async () => {
    const { reads, team } = await seeded();
    expect((await reads.get(SCOPE, ANA, team.id))?.note.body).toBe('a_b roster');
  });

  it('⚠ is null for somebody else’s private note, a missing one and another workspace’s alike', async () => {
    const { reads, secret, elsewhere } = await seeded();
    expect(await reads.get(SCOPE, ANA, secret.id)).toBeNull();
    expect(await reads.get(SCOPE, ANA, 'no-such-note')).toBeNull();
    expect(await reads.get(SCOPE, ANA, elsewhere.id)).toBeNull();
  });

  it('⚠ has no revisions to show anybody who cannot see it', async () => {
    const { reads, secret } = await seeded();
    expect(await reads.revisions(SCOPE, ANA, secret.id)).toBeNull();
  });
});

describe('settings and names', () => {
  it('reads no row as the defaults', async () => {
    const { reads } = harness();
    expect(await reads.settings(SCOPE, ANA)).toEqual({ look: 'notebook', font: 'hand', defaultColor: 'default' });
  });

  it('names nobody with no directory bound, and only the known with one', async () => {
    expect((await harness().reads.names([ANA])).size).toBe(0);
    const { reads } = harness({ directory: { describe: async () => [{ userId: ANA, displayName: 'Ana' }] } });
    expect([...(await reads.names([ANA, BEN, ANA]))]).toEqual([[ANA, 'Ana']]);
  });
});
