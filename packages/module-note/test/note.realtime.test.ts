import type { NoteEventType } from '../src/server/graphql/note.types.js';
import { ANA, BEN, harness, SCOPE } from './harness.js';

/**
 * The realtime half, through the real resolver: what each subscriber receives.
 *
 * ⚠ A subscription is authorised ONCE. So the question this suite asks — is
 * this event any of THIS viewer's business — is re-answered on every publish,
 * and a private note's changes must reach its author and nobody else.
 *
 * "Received nothing" cannot be awaited, so those tests publish a MARKER the
 * viewer is sure to receive, afterwards, and assert it is the next thing they
 * get: anything filtered wrongly would arrive first.
 */

function subscribe(resolver: ReturnType<typeof harness>['resolver'], viewer: string) {
  return resolver.noteEvents({ req: viewer }, SCOPE.organizationId, SCOPE.workspaceId);
}

async function next(stream: AsyncIterableIterator<NoteEventType>): Promise<NoteEventType> {
  const result = await stream.next();
  if (result.done) throw new Error('the stream ended');
  return result.value;
}

describe('noteEvents', () => {
  it('⚠ opens with sync on every subscribe — the engine has no replay', async () => {
    const { resolver } = harness();
    const stream = subscribe(resolver, ANA);
    expect(await next(stream)).toEqual({ kind: 'sync', noteId: null, version: null, actorId: null });
    await stream.return?.();
  });

  it('⚠ tells nobody but the author about a private note', async () => {
    const { resolver, writes } = harness();
    const ana = subscribe(resolver, ANA);
    const ben = subscribe(resolver, BEN);
    await next(ana);
    await next(ben);

    const note = await writes.create(SCOPE, ANA, { body: 'secret' });
    await writes.update(SCOPE, ANA, note.id, note.version, { body: 'still secret' });
    const marker = await writes.create(SCOPE, BEN, { visibility: 'workspace' });

    expect(await next(ben)).toEqual(expect.objectContaining({ kind: 'changed', noteId: marker.id }));
    expect(await next(ana)).toEqual(expect.objectContaining({ kind: 'changed', noteId: note.id }));
    expect(await next(ana)).toEqual(expect.objectContaining({ kind: 'changed', noteId: note.id }));
    await Promise.all([ana.return?.(), ben.return?.()]);
  });

  it('tells everyone about a shared note, with the version so the saver knows its own echo', async () => {
    const { resolver, writes } = harness();
    const note = await writes.create(SCOPE, ANA, {});
    const ben = subscribe(resolver, BEN);
    await next(ben);

    const shared = await writes.setVisibility(SCOPE, ANA, note.id, 'workspace');
    const saved = await writes.update(SCOPE, ANA, note.id, shared.version, { body: 'hello' });

    expect(await next(ben)).toEqual({ kind: 'changed', noteId: note.id, version: shared.version, actorId: ANA });
    expect(await next(ben)).toEqual({ kind: 'changed', noteId: note.id, version: saved.version, actorId: ANA });
    await ben.return?.();
  });

  it('⚠ tells the others when a note is unshared, and then nothing more about it', async () => {
    const { resolver, writes } = harness();
    const note = await writes.create(SCOPE, ANA, { visibility: 'workspace' });
    const ben = subscribe(resolver, BEN);
    await next(ben);

    const unshared = await writes.setVisibility(SCOPE, ANA, note.id, 'private');
    await writes.update(SCOPE, ANA, note.id, unshared.version, { body: 'now private' });
    const marker = await writes.create(SCOPE, BEN, { visibility: 'workspace' });

    expect(await next(ben)).toEqual({ kind: 'removed', noteId: note.id, version: unshared.version, actorId: ANA });
    expect(await next(ben)).toEqual(expect.objectContaining({ noteId: marker.id }));
    await ben.return?.();
  });

  it('⚠ carries no content — ids and versions only', async () => {
    const { resolver, writes, pubsub } = harness();
    const ana = subscribe(resolver, ANA);
    await next(ana);
    await writes.create(SCOPE, ANA, { title: 'Title here', body: 'Body here', tags: ['tag-here'] });
    const event = await next(ana);
    await ana.return?.();

    expect(JSON.stringify([...pubsub.sent, event])).not.toMatch(/Title here|Body here|tag-here/);
  });

  it('refuses a socket with nobody on it, at subscribe', () => {
    const { resolver } = harness();
    expect(() => resolver.noteEvents({ req: undefined }, SCOPE.organizationId, SCOPE.workspaceId)).toThrow(
      'Not signed in',
    );
  });
});
