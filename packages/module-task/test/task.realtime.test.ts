import { ANA, BEN, boardOf, harness, SCOPE } from './harness.js';

async function take<T>(iterator: AsyncIterableIterator<T>, count: number): Promise<T[]> {
  const out: T[] = [];
  while (out.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

describe('taskEvents', () => {
  it('sends sync first, then ids — never content', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const stream = h.resolver.taskEvents({ req: BEN }, SCOPE.organizationId, SCOPE.workspaceId);
    const pending = take(stream, 2);
    await new Promise((resolve) => setImmediate(resolve));
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'Secret plans' });
    const events = await pending;
    await stream.return?.();
    expect(events).toEqual([
      { kind: 'sync', boardId: null, taskId: null, actorId: null },
      { kind: 'changed', boardId: board.id, taskId: task.id, actorId: ANA },
    ]);
  });

  it('⚠ never tells anybody but the owner about a private board', async () => {
    const h = harness();
    const secret = await boardOf(h, ANA, 'private');
    const shared = await boardOf(h, ANA);
    const stream = h.resolver.taskEvents({ req: BEN }, SCOPE.organizationId, SCOPE.workspaceId);
    const pending = take(stream, 2);
    await new Promise((resolve) => setImmediate(resolve));
    await h.writes.create(SCOPE, ANA, secret.board.id, { title: 'Private' });
    await h.writes.create(SCOPE, ANA, shared.board.id, { title: 'Shared' });
    const events = await pending;
    await stream.return?.();
    expect(events.map((event) => event.boardId)).toEqual([null, shared.board.id]);
  });
});
