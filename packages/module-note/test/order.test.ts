import { moveInOrder, orderNotes } from '../src/domain/order.js';

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 9, minute));
const note = (id: string, minute: number) => ({ id, createdAt: at(minute) });

describe('orderNotes', () => {
  it('shows notes not yet placed at the top, newest first, then the placed ones in order', () => {
    const notes = [note('a', 1), note('b', 2), note('new', 9), note('newer', 10)];
    expect(orderNotes(notes, ['b', 'a']).map((n) => n.id)).toEqual(['newer', 'new', 'b', 'a']);
  });

  it('skips ids in the order that are no longer in the list', () => {
    expect(orderNotes([note('a', 1)], ['gone', 'a']).map((n) => n.id)).toEqual(['a']);
  });

  it('with no order at all, is newest first', () => {
    expect(orderNotes([note('a', 1), note('b', 2)], []).map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('moveInOrder', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves a note to just after another', () => {
    expect(moveInOrder(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveInOrder(ids, 'd', 'a')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a note to the very top', () => {
    expect(moveInOrder(ids, 'c', null)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('⚠ lands next to its neighbour even when the move was made in a filtered list', () => {
    // Filtered to b and d, the person drops d under b: d goes right after b in the whole list.
    expect(moveInOrder(ids, 'd', 'b')).toEqual(['a', 'b', 'd', 'c']);
  });

  it('leaves the order alone for a neighbour that is not there, or is the note itself', () => {
    expect(moveInOrder(ids, 'a', 'gone')).toEqual(ids);
    expect(moveInOrder(ids, 'a', 'a')).toEqual(ids);
  });
});
