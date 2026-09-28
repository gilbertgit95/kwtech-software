import { draftChanges, onStoredTask, parseLabels } from '../src/react/view/editing.js';

const stored = { title: 'Fix the sink', description: 'Kitchen, left tap' };

describe('draftChanges', () => {
  it('sends only what differs, by the server’s own normalising', () => {
    expect(draftChanges(stored, { ...stored })).toBeNull();
    // Trailing space is not a change once "Fix the sink" is stored — or autosave resends it forever.
    expect(draftChanges(stored, { ...stored, title: 'Fix the sink ' })).toBeNull();
    expect(draftChanges(stored, { ...stored, description: 'Kitchen, right tap' })).toEqual({
      description: 'Kitchen, right tap',
    });
  });

  it('never sends an empty title — a card needs one', () => {
    expect(draftChanges(stored, { ...stored, title: '   ' })).toBeNull();
  });
});

describe('onStoredTask', () => {
  it('⚠ never replaces unsaved typing', () => {
    expect(onStoredTask(false, 3, 4)).toBe('adopt');
    expect(onStoredTask(true, 3, 3)).toBe('keep');
    expect(onStoredTask(true, 3, 4)).toBe('warn');
  });
});

describe('parseLabels', () => {
  it('splits on commas and drops empties', () => {
    expect(parseLabels(' kitchen, , urgent ,')).toEqual(['kitchen', 'urgent']);
  });
});
