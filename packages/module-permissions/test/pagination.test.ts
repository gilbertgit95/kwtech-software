import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PAGE_SIZES, paginate, resolvePageArgs } from '../src/domain/pagination.js';

const rows = Array.from({ length: 250 }, (_, index) => index);

describe('the constants agree with each other', () => {
  it('offers 10, 50 and 100', () => {
    expect(PAGE_SIZES).toEqual([10, 50, 100]);
  });

  /** The API must never return more than a person could ask for through the UI. */
  it('caps at the largest page the UI offers', () => {
    expect(MAX_PAGE_SIZE).toBe(Math.max(...PAGE_SIZES));
  });

  it('defaults to the cap, so limit can only narrow', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(MAX_PAGE_SIZE);
  });
});

describe('resolvePageArgs', () => {
  it('defaults when nothing is asked for', () => {
    expect(resolvePageArgs()).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  /** The whole point: a default alone leaves ?limit=100000 unbounded. */
  it('clamps a limit above the cap rather than honouring it', () => {
    expect(resolvePageArgs({ limit: 100_000 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it('clamps a limit below one', () => {
    expect(resolvePageArgs({ limit: 0 }).limit).toBe(1);
    expect(resolvePageArgs({ limit: -5 }).limit).toBe(1);
  });

  it('clamps a negative offset to zero', () => {
    expect(resolvePageArgs({ offset: -1 }).offset).toBe(0);
  });

  /** A fraction is a client bug; answering 1 would make it look like it works. */
  it.each([[1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])('falls back for %p', (limit) => {
    expect(resolvePageArgs({ limit }).limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it('treats null and undefined as absent', () => {
    expect(resolvePageArgs({ limit: null, offset: undefined })).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });
});

describe('paginate', () => {
  it('returns at most the cap even for a huge list', () => {
    expect(paginate(rows).items).toHaveLength(MAX_PAGE_SIZE);
  });

  it('reports the total before paging', () => {
    expect(paginate(rows, { limit: 10 }).total).toBe(250);
  });

  it('echoes the limit actually applied', () => {
    expect(paginate(rows, { limit: 100_000 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it('walks the list', () => {
    expect(paginate(rows, { limit: 10, offset: 0 }).items[0]).toBe(0);
    expect(paginate(rows, { limit: 10, offset: 10 }).items[0]).toBe(10);
  });

  it('is an empty page past the end, not an error', () => {
    const page = paginate(rows, { limit: 10, offset: 1000 });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  /** Computed from the total: a last page exactly `limit` long must not claim more. */
  it('does not claim more on an exactly-full final page', () => {
    const page = paginate(Array.from({ length: 20 }), { limit: 10, offset: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(false);
  });

  it('claims more when there is more', () => {
    expect(paginate(rows, { limit: 10, offset: 0 }).hasMore).toBe(true);
  });

  it('handles an empty list', () => {
    expect(paginate([])).toEqual({ items: [], total: 0, limit: DEFAULT_PAGE_SIZE, offset: 0, hasMore: false });
  });
});
