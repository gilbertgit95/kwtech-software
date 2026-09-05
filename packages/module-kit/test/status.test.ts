import {
  compareStatus,
  createStatusStore,
  INERT_STATUS_STORE,
  STATUS_PRIORITY,
  type StatusMessage,
  selectPrimaryStatus,
  sortStatuses,
} from '../src/index.js';

const message = (id: string, level: StatusMessage['level'], extra: Partial<StatusMessage> = {}): StatusMessage => ({
  id,
  level,
  text: `${id} text`,
  ...extra,
});

describe('severity ordering', () => {
  it('ranks error above warning above success above info', () => {
    expect(STATUS_PRIORITY.error).toBeGreaterThan(STATUS_PRIORITY.warning);
    expect(STATUS_PRIORITY.warning).toBeGreaterThan(STATUS_PRIORITY.success);
    expect(STATUS_PRIORITY.success).toBeGreaterThan(STATUS_PRIORITY.info);
  });

  it('sorts most severe first', () => {
    const sorted = sortStatuses([message('a', 'info'), message('b', 'error'), message('c', 'warning')]);
    expect(sorted.map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  /**
   * The property the bar depends on: two warnings from one page keep the order
   * they were published in rather than swapping on a re-sort.
   */
  it('keeps publication order within a level', () => {
    const sorted = sortStatuses([message('first', 'warning'), message('second', 'warning')]);
    expect(sorted.map((m) => m.id)).toEqual(['first', 'second']);
  });

  it('does not mutate its input', () => {
    const input = [message('a', 'info'), message('b', 'error')];
    sortStatuses(input);
    expect(input.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('compares by level and nothing else', () => {
    expect(compareStatus(message('a', 'error'), message('b', 'info'))).toBeLessThan(0);
    expect(compareStatus(message('a', 'info'), message('b', 'info'))).toBe(0);
  });
});

describe('selectPrimaryStatus', () => {
  it('is undefined when there is nothing to say', () => {
    expect(selectPrimaryStatus([])).toBeUndefined();
  });

  /**
   * The case the whole priority rule exists for: a page reporting a failed save
   * must not sit above the unreachable server that caused it.
   */
  it('picks the most severe, not the most recent', () => {
    const primary = selectPrimaryStatus([message('save', 'warning'), message('offline', 'error')]);
    expect(primary?.id).toBe('offline');
  });

  it('keeps the first of an equal-severity tie', () => {
    expect(selectPrimaryStatus([message('first', 'info'), message('second', 'info')])?.id).toBe('first');
  });
});

describe('createStatusStore', () => {
  it('starts empty', () => {
    expect(createStatusStore().getSnapshot()).toEqual([]);
  });

  it('publishes and retracts', () => {
    const store = createStatusStore();
    store.publish(message('a', 'info'));
    expect(store.getSnapshot()).toHaveLength(1);

    store.retract('a');
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('ignores a retraction of something it never held', () => {
    const store = createStatusStore();
    expect(() => store.retract('nothing')).not.toThrow();
  });

  /**
   * `useSyncExternalStore` compares snapshots by IDENTITY. A fresh array per
   * call is an infinite render loop, so this is the assertion that keeps the
   * bar from hanging the app.
   */
  it('returns a stable snapshot reference between mutations', () => {
    const store = createStatusStore();
    expect(store.getSnapshot()).toBe(store.getSnapshot());

    store.publish(message('a', 'info'));
    const afterPublish = store.getSnapshot();
    expect(store.getSnapshot()).toBe(afterPublish);

    store.publish(message('b', 'error'));
    expect(store.getSnapshot()).not.toBe(afterPublish);
  });

  it('does not notify or churn the snapshot on a no-op retraction', () => {
    const store = createStatusStore();
    store.publish(message('a', 'info'));
    const before = store.getSnapshot();

    const listener = jest.fn();
    store.subscribe(listener);
    store.retract('absent');

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
  });

  /**
   * What makes a poller reporting its state every few seconds occupy one line
   * instead of accumulating a pile of them.
   */
  it('replaces a message that reuses an id', () => {
    const store = createStatusStore();
    store.publish(message('conn', 'error', { text: 'Unreachable' }));
    store.publish(message('conn', 'success', { text: 'Reconnected' }));

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.text).toBe('Reconnected');
  });

  /** Replaced IN PLACE: a republish must not reshuffle the bar under the reader. */
  it('keeps a replaced message in its original position', () => {
    const store = createStatusStore();
    store.publish(message('first', 'info'));
    store.publish(message('second', 'info'));
    store.publish(message('first', 'info', { text: 'updated' }));

    expect(store.getSnapshot().map((m) => m.id)).toEqual(['first', 'second']);
  });

  it('clears transient messages and keeps sticky ones', () => {
    const store = createStatusStore();
    store.publish(message('page', 'warning'));
    store.publish(message('conn', 'error', { sticky: true }));

    store.clearTransient();

    expect(store.getSnapshot().map((m) => m.id)).toEqual(['conn']);
  });

  it('does not notify when a clear removes nothing', () => {
    const store = createStatusStore();
    store.publish(message('conn', 'error', { sticky: true }));

    const listener = jest.fn();
    store.subscribe(listener);
    store.clearTransient();

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies subscribers until they unsubscribe', () => {
    const store = createStatusStore();
    const listener = jest.fn();

    const unsubscribe = store.subscribe(listener);
    store.publish(message('a', 'info'));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.publish(message('b', 'info'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

/**
 * The fallback a module page gets in an app that never mounted a provider.
 * Adopting a module must not require adopting the status bar.
 */
describe('INERT_STATUS_STORE', () => {
  it('accepts everything and remembers nothing', () => {
    INERT_STATUS_STORE.publish(message('a', 'error'));
    expect(INERT_STATUS_STORE.getSnapshot()).toEqual([]);
  });

  it('hands back an unsubscribe that does not throw', () => {
    expect(() => INERT_STATUS_STORE.subscribe(() => {})()).not.toThrow();
  });
});
