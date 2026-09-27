import type { LimitChecker } from '@kwtech/module-kit';
import { NOTE_REVISIONS_KEPT } from '../src/domain/access.js';
import { NOTE_CONFLICT_MESSAGE, NOTE_NOT_FOUND_MESSAGE } from '../src/domain/notes.js';
import { NOTE_LIMIT, NOTE_LIMIT_REGISTRY } from '../src/feature-keys.js';
import { ANA, BEN, CAL, harness, OTHER_WORKSPACE, SCOPE } from './harness.js';

/**
 * The write service against a fake client. Most of this suite is the review in
 * NOTE-PLAN §9, as tests: the cross-workspace id, the existence oracle, the
 * stale save, the vandalised shared note, the cap nobody can clear.
 */

describe('creating a note', () => {
  it('is private by default, with a preview and the author as its last editor', async () => {
    const { writes, pubsub } = harness();
    const note = await writes.create(SCOPE, ANA, { title: 'Ideas', body: '# Loyalty\n- a **card**' });

    expect(note).toEqual(
      expect.objectContaining({
        visibility: 'private',
        authorId: ANA,
        updatedById: ANA,
        preview: 'Loyalty a card',
        version: 1,
      }),
    );
    expect(pubsub.sent).toEqual([expect.objectContaining({ noteId: note.id, change: 'created', actorId: ANA })]);
  });

  it('starts in the author’s default colour, and refuses a colour not on offer', async () => {
    const { writes } = harness();
    await writes.setSettings(SCOPE, ANA, { look: 'sticky', font: 'hand', defaultColor: 'yellow' });

    expect((await writes.create(SCOPE, ANA, {})).color).toBe('yellow');
    await expect(writes.create(SCOPE, ANA, { color: '#ff0000' })).rejects.toMatchObject({ reason: 'invalid_color' });
  });

  it('refuses a visibility that is not one', async () => {
    const { writes } = harness();
    await expect(writes.create(SCOPE, ANA, { visibility: 'public' })).rejects.toMatchObject({
      reason: 'invalid_visibility',
    });
  });

  it('refuses a title with invisible formatting, naming the field', async () => {
    const { writes } = harness();
    await expect(writes.create(SCOPE, ANA, { title: 'a‮b' })).rejects.toMatchObject({ reason: 'invalid_title' });
  });
});

describe('the per-person cap', () => {
  const capOf = (limit: number): LimitChecker => ({
    async check({ current }) {
      return { allowed: current < limit, limit, current, remaining: Math.max(limit - current, 0) };
    },
  });

  it('⚠ counts per PERSON — somebody else’s notes never use up your places', async () => {
    const { writes } = harness({ limits: capOf(2) });
    await writes.create(SCOPE, BEN, {});
    await writes.create(SCOPE, BEN, {});

    await expect(writes.create(SCOPE, ANA, {})).resolves.toBeDefined();
    await expect(writes.create(SCOPE, BEN, {})).rejects.toMatchObject({ reason: 'limit_reached' });
  });

  it('⚠ counts the trash — only deleting forever frees a place', async () => {
    const { writes } = harness({ limits: capOf(1) });
    const note = await writes.create(SCOPE, ANA, {});
    await writes.trash(SCOPE, ANA, note.id);
    await expect(writes.create(SCOPE, ANA, {})).rejects.toMatchObject({ reason: 'limit_reached' });

    await writes.deleteForever(SCOPE, ANA, note.id);
    await expect(writes.create(SCOPE, ANA, {})).resolves.toBeDefined();
  });

  it('asks the checker for note:notes with the count and the workspace', async () => {
    const check = jest.fn(capOf(10).check);
    const { writes } = harness({ limits: { check } });
    await writes.create(SCOPE, ANA, {});

    expect(check).toHaveBeenCalledWith({ actorId: ANA, key: NOTE_LIMIT.notes, current: 0, ...SCOPE });
  });

  it('⚠ with no checker bound, holds the DECLARED DEFAULT — never unlimited', async () => {
    const { writes, prisma } = harness();
    const cap = NOTE_LIMIT_REGISTRY[0]?.defaultValue ?? 0;
    for (let i = 0; i < cap; i += 1) {
      prisma.state.note.push({ ...SCOPE, id: `seeded-${i}`, authorId: ANA, visibility: 'private', trashedAt: null });
    }
    await expect(writes.create(SCOPE, ANA, {})).rejects.toMatchObject({ reason: 'limit_reached' });
  });
});

describe('saving', () => {
  it('lands an edit from the current version and moves the version on', async () => {
    const { writes } = harness();
    const note = await writes.create(SCOPE, ANA, { body: 'one' });
    const saved = await writes.update(SCOPE, ANA, note.id, note.version, { body: 'two' });

    expect(saved).toEqual(expect.objectContaining({ body: 'two', preview: 'two', version: note.version + 1 }));
  });

  it('⚠ refuses a stale save with the one message the app matches', async () => {
    const { writes } = harness();
    const note = await writes.create(SCOPE, ANA, { body: 'one' });
    await writes.update(SCOPE, ANA, note.id, note.version, { body: 'two' });

    await expect(writes.update(SCOPE, ANA, note.id, note.version, { body: 'stale' })).rejects.toMatchObject({
      reason: 'conflict',
      message: NOTE_CONFLICT_MESSAGE,
    });
  });

  it('⚠ does not bump the version for a save that changes nothing — an idle autosave must not cause a conflict', async () => {
    const { writes, pubsub } = harness();
    const note = await writes.create(SCOPE, ANA, { title: 'Same', body: 'text', tags: ['ops'] });
    pubsub.sent.length = 0;

    const saved = await writes.update(SCOPE, ANA, note.id, note.version, {
      title: ' Same ',
      body: 'text',
      tags: ['#OPS'],
    });
    expect(saved.version).toBe(note.version);
    expect(pubsub.sent).toEqual([]);
  });

  it('⚠ refuses the loser of a race between read and write, and leaves no revision behind', async () => {
    const { writes, prisma } = harness();
    const note = await writes.create(SCOPE, ANA, { body: 'one' });
    await writes.setVisibility(SCOPE, ANA, note.id, 'workspace');
    const shared = await writes.update(SCOPE, ANA, note.id, note.version + 1, { body: 'ana' });

    // Somebody else's save lands between Ben's read and Ben's write.
    prisma.beforeNextNoteWrite(() => {
      const row = prisma.state.note.find((candidate) => candidate.id === note.id);
      if (row) row.version = (row.version as number) + 1;
    });
    await expect(writes.update(SCOPE, BEN, note.id, shared.version, { body: 'ben' })).rejects.toMatchObject({
      reason: 'conflict',
    });
    expect(prisma.state.noteRevision).toEqual([]);
  });
});

/**
 * ⚠ THE ORACLE, END TO END. Whatever is true of somebody else's private note —
 * stale version, in the trash, anything — every act on it answers exactly what
 * a note that does not exist answers.
 */
describe('somebody else’s private note is indistinguishable from no note at all', () => {
  async function setup() {
    const h = harness({ managers: [BEN] });
    const secret = await h.writes.create(SCOPE, ANA, { title: 'Salary review', body: 'private' });
    return { ...h, secret };
  }

  const expectNotFound = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({ reason: 'not_found', message: NOTE_NOT_FOUND_MESSAGE });

  it('for every act, with any version', async () => {
    const { writes, secret } = await setup();
    await expectNotFound(writes.update(SCOPE, BEN, secret.id, 999, { body: 'x' }));
    await expectNotFound(writes.update(SCOPE, BEN, secret.id, secret.version, { body: 'x' }));
    await expectNotFound(writes.setVisibility(SCOPE, BEN, secret.id, 'workspace'));
    await expectNotFound(writes.trash(SCOPE, BEN, secret.id));
    await expectNotFound(writes.setPinned(SCOPE, BEN, secret.id, true));
    await expectNotFound(writes.restoreRevision(SCOPE, BEN, secret.id, 'any', secret.version));
    await expectNotFound(writes.update(SCOPE, BEN, 'no-such-note', 1, { body: 'x' }));
  });

  it('⚠ and never asks whether the actor holds manage_all — the key cannot even learn it exists', async () => {
    const { writes, secret, accessCalls } = await setup();
    await expectNotFound(writes.trash(SCOPE, BEN, secret.id));
    expect(accessCalls).toEqual([]);
  });

  it('⚠ a note id from ANOTHER WORKSPACE is not found, even to its own author', async () => {
    const { writes, secret } = await setup();
    await expectNotFound(writes.update(OTHER_WORKSPACE, ANA, secret.id, secret.version, { body: 'x' }));
    await expectNotFound(writes.trash(OTHER_WORKSPACE, ANA, secret.id));
    await expectNotFound(writes.setPinned(OTHER_WORKSPACE, ANA, secret.id, true));
  });
});

describe('shared notes and their revisions', () => {
  async function shared() {
    const h = harness();
    const created = await h.writes.create(SCOPE, ANA, { title: 'Checklist', body: 'Lights' });
    const note = await h.writes.setVisibility(SCOPE, ANA, created.id, 'workspace');
    return { ...h, note };
  }

  it('lets another member edit a shared note', async () => {
    const { writes, note } = await shared();
    const saved = await writes.update(SCOPE, BEN, note.id, note.version, { body: 'Lights, till' });
    expect(saved).toEqual(expect.objectContaining({ body: 'Lights, till', updatedById: BEN, authorId: ANA }));
  });

  it('⚠ keeps what somebody else wrote when a different person saves over it', async () => {
    const { writes, prisma, note } = await shared();
    await writes.update(SCOPE, BEN, note.id, note.version, { body: '' });

    expect(prisma.state.noteRevision).toEqual([
      expect.objectContaining({ noteId: note.id, title: 'Checklist', body: 'Lights', editedById: ANA }),
    ]);
  });

  it('keeps none while one person autosaves their own typing', async () => {
    const { writes, prisma, note } = await shared();
    const first = await writes.update(SCOPE, BEN, note.id, note.version, { body: 'a' });
    await writes.update(SCOPE, BEN, note.id, first.version, { body: 'ab' });
    expect(prisma.state.noteRevision).toHaveLength(1);
  });

  it('keeps none for a colour or a tag — only text is somebody’s work', async () => {
    const { writes, prisma, note } = await shared();
    await writes.update(SCOPE, BEN, note.id, note.version, { color: 'pink', tags: ['ops'] });
    expect(prisma.state.noteRevision).toEqual([]);
  });

  it(`keeps the newest ${NOTE_REVISIONS_KEPT}`, async () => {
    const { writes, prisma, note } = await shared();
    let version = note.version;
    for (let i = 0; i < NOTE_REVISIONS_KEPT + 5; i += 1) {
      const editor = i % 2 === 0 ? BEN : CAL;
      version = (await writes.update(SCOPE, editor, note.id, version, { body: `edit ${i}` })).version;
    }
    expect(prisma.state.noteRevision).toHaveLength(NOTE_REVISIONS_KEPT);
  });

  it('restores a revision as an edit — keeping the text it replaces', async () => {
    const { writes, prisma, note } = await shared();
    const blanked = await writes.update(SCOPE, BEN, note.id, note.version, { body: '' });
    const revisionId = prisma.state.noteRevision[0]?.id as string;

    const restored = await writes.restoreRevision(SCOPE, ANA, note.id, revisionId, blanked.version);
    expect(restored.body).toBe('Lights');
    expect(prisma.state.noteRevision.map((row) => row.body)).toEqual(['Lights', '']);
  });

  it('⚠ lets only the author unshare, and tells everyone else it went', async () => {
    const { writes, pubsub, note } = await shared();
    await expect(writes.setVisibility(SCOPE, BEN, note.id, 'private')).rejects.toMatchObject({ reason: 'not_author' });

    pubsub.sent.length = 0;
    await writes.setVisibility(SCOPE, ANA, note.id, 'private');
    expect(pubsub.sent).toEqual([expect.objectContaining({ change: 'unshared', visibility: 'private' })]);
  });

  it('does not move the last editor when sharing — sharing writes no text', async () => {
    const { writes, note } = await shared();
    const edited = await writes.update(SCOPE, BEN, note.id, note.version, { body: 'x' });
    const unshared = await writes.setVisibility(SCOPE, ANA, note.id, 'private');
    expect(unshared.updatedById).toBe(edited.updatedById);
  });
});

describe('the trash', () => {
  it('lets the author bin, restore and delete forever — only from the trash', async () => {
    const { writes, prisma } = harness();
    const note = await writes.create(SCOPE, ANA, {});

    await expect(writes.deleteForever(SCOPE, ANA, note.id)).rejects.toMatchObject({ reason: 'not_in_trash' });
    expect((await writes.trash(SCOPE, ANA, note.id)).trashedAt).toBeInstanceOf(Date);
    await expect(writes.update(SCOPE, ANA, note.id, note.version + 1, { body: 'x' })).rejects.toMatchObject({
      reason: 'in_trash',
    });
    expect((await writes.restore(SCOPE, ANA, note.id)).trashedAt).toBeNull();

    await writes.trash(SCOPE, ANA, note.id);
    await writes.deleteForever(SCOPE, ANA, note.id);
    expect(prisma.state.note).toEqual([]);
  });

  it('takes pins and revisions with a note deleted forever', async () => {
    const { writes, prisma } = harness();
    const note = await writes.create(SCOPE, ANA, { body: 'a' });
    const shared = await writes.setVisibility(SCOPE, ANA, note.id, 'workspace');
    await writes.update(SCOPE, BEN, note.id, shared.version, { body: 'b' });
    await writes.setPinned(SCOPE, BEN, note.id, true);

    await writes.trash(SCOPE, ANA, note.id);
    await writes.deleteForever(SCOPE, ANA, note.id);
    expect(prisma.state.notePin).toEqual([]);
    expect(prisma.state.noteRevision).toEqual([]);
  });

  describe('somebody else’s SHARED note', () => {
    async function sharedBy(managers?: readonly string[]) {
      const h = harness(managers ? { managers } : {});
      const created = await h.writes.create(SCOPE, ANA, {});
      await h.writes.setVisibility(SCOPE, ANA, created.id, 'workspace');
      return { ...h, noteId: created.id };
    }

    it('⚠ is refused when the access port is UNBOUND — fail closed', async () => {
      const { writes, noteId } = await sharedBy();
      await expect(writes.trash(SCOPE, BEN, noteId)).rejects.toMatchObject({ reason: 'not_permitted' });
    });

    it('is refused without manage_all, and allowed with it', async () => {
      const { writes, noteId, accessCalls } = await sharedBy([CAL]);
      await expect(writes.trash(SCOPE, BEN, noteId)).rejects.toMatchObject({ reason: 'not_permitted' });
      await expect(writes.trash(SCOPE, CAL, noteId)).resolves.toBeDefined();
      expect(accessCalls).toEqual([BEN, CAL]);
    });

    it('never asks the port about the author’s own note', async () => {
      const { writes, noteId, accessCalls } = await sharedBy([CAL]);
      await writes.trash(SCOPE, ANA, noteId);
      expect(accessCalls).toEqual([]);
    });
  });
});

describe('pins and settings', () => {
  it('pins for the person alone, and unpins', async () => {
    const { writes, prisma } = harness();
    const note = await writes.create(SCOPE, ANA, {});
    await writes.setPinned(SCOPE, ANA, note.id, true);
    await writes.setPinned(SCOPE, ANA, note.id, true);
    expect(prisma.state.notePin).toEqual([expect.objectContaining({ userId: ANA, noteId: note.id, ...SCOPE })]);

    await writes.setPinned(SCOPE, ANA, note.id, false);
    expect(prisma.state.notePin).toEqual([]);
  });

  it('refuses settings that are not on offer, and saves ones that are', async () => {
    const { writes } = harness();
    await expect(
      writes.setSettings(SCOPE, ANA, { look: 'scroll', font: 'hand', defaultColor: 'default' }),
    ).rejects.toMatchObject({ reason: 'invalid_settings' });
    await expect(
      writes.setSettings(SCOPE, ANA, { look: 'grid', font: 'serif', defaultColor: 'blue' }),
    ).resolves.toEqual({
      look: 'grid',
      font: 'serif',
      defaultColor: 'blue',
    });
  });
});
