import {
  checkAddColumn,
  checkColumnNameFree,
  checkRemoveColumn,
  checkSetColumnDone,
  columnNameKey,
  prepareBoardName,
  prepareColumnName,
  prepareInitialColumns,
  TASK_COLUMNS_MAX,
  TASK_DEFAULT_COLUMNS,
} from '../src/domain/boards.js';

const columns = [
  { id: 'todo', done: false },
  { id: 'doing', done: false },
  { id: 'done', done: true },
];

describe('board and column names', () => {
  it('collapses whitespace and refuses empty or invisible names', () => {
    expect(prepareBoardName('  Front   desk ')).toEqual({ name: 'Front desk' });
    expect(prepareBoardName('   ')).toEqual({ refused: 'invalid_name' });
    expect(prepareColumnName('Do‮ne')).toEqual({ refused: 'invalid_column' });
  });

  it('⚠ treats names differing only in case or spacing as the same column', () => {
    expect(columnNameKey(' Done ')).toBe(columnNameKey('done'));
    expect(checkColumnNameFree([{ id: 'a', name: 'Done' }], 'done', null)).toBe('duplicate_column');
    expect(checkColumnNameFree([{ id: 'a', name: 'Done' }], 'DONE', 'a')).toBeNull();
  });
});

describe('prepareInitialColumns', () => {
  it('accepts the defaults, and whatever the creator made of them', () => {
    expect(prepareInitialColumns(TASK_DEFAULT_COLUMNS)).toEqual({ columns: TASK_DEFAULT_COLUMNS });
    expect(prepareInitialColumns([{ name: 'Backlog', done: false }])).toEqual({
      columns: [{ name: 'Backlog', done: false }],
    });
  });

  it('refuses none, too many, and duplicates', () => {
    expect(prepareInitialColumns([])).toEqual({ refused: 'last_column' });
    const many = Array.from({ length: TASK_COLUMNS_MAX + 1 }, (_, i) => ({ name: `c${i}`, done: false }));
    expect(prepareInitialColumns(many)).toEqual({ refused: 'too_many_columns' });
    expect(
      prepareInitialColumns([
        { name: 'Done', done: true },
        { name: 'done', done: false },
      ]),
    ).toEqual({ refused: 'duplicate_column' });
  });
});

describe('adding and removing columns', () => {
  it('caps the board', () => {
    const full = Array.from({ length: TASK_COLUMNS_MAX }, (_, i) => ({ name: `c${i}` }));
    expect(checkAddColumn(full, 'one more')).toBe('too_many_columns');
    expect(checkAddColumn([{ name: 'To do' }], 'Review')).toBeNull();
  });

  it('⚠ never removes the last column, or the last done column', () => {
    expect(checkRemoveColumn([{ id: 'only', done: false }], 'only', null, 0)).toBe('last_column');
    expect(checkRemoveColumn(columns, 'done', 'todo', 0)).toBe('last_done_column');
    expect(checkSetColumnDone(columns, 'done', false)).toBe('last_done_column');
    expect(checkSetColumnDone(columns, 'todo', true)).toBeNull();
  });

  it('needs a destination on the same board only when the column has tasks', () => {
    expect(checkRemoveColumn(columns, 'doing', null, 0)).toBeNull();
    expect(checkRemoveColumn(columns, 'doing', null, 3)).toBe('invalid_destination');
    expect(checkRemoveColumn(columns, 'doing', 'doing', 3)).toBe('invalid_destination');
    expect(checkRemoveColumn(columns, 'doing', 'elsewhere', 3)).toBe('invalid_destination');
    expect(checkRemoveColumn(columns, 'doing', 'todo', 3)).toBeNull();
    expect(checkRemoveColumn(columns, 'missing', 'todo', 3)).toBe('not_found');
  });
});
