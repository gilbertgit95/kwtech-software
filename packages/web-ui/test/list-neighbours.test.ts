import { listNeighbours } from '../src/react/list-neighbours.js';

/** The rows either side of the open one: what a drawer's Previous and Next open. */
describe('listNeighbours', () => {
  const ids = ['a', 'b', 'c'];

  it('gives the rows either side and the place in the list', () => {
    expect(listNeighbours(ids, 'b')).toEqual({ previous: 'a', next: 'c', position: '2 of 3' });
  });

  it('has no previous at the top and no next at the bottom', () => {
    expect(listNeighbours(ids, 'a')).toEqual({ previous: null, next: 'b', position: '1 of 3' });
    expect(listNeighbours(ids, 'c')).toEqual({ previous: 'b', next: null, position: '3 of 3' });
  });

  it('steps nowhere from something that is not in the list', () => {
    const nowhere = { previous: null, next: null, position: null };
    expect(listNeighbours(ids, 'new')).toEqual(nowhere);
    expect(listNeighbours(ids, null)).toEqual(nowhere);
    expect(listNeighbours([], 'a')).toEqual(nowhere);
  });
});
