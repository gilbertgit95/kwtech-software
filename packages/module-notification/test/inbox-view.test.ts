import {
  buttonOpensNewTab,
  composeButton,
  counter,
  EMPTY_COMPOSE_DRAFT,
  initialsOf,
  moveHighlight,
  readShare,
  recipientSummary,
  severityHint,
  validateComposeDraft,
} from '../src/react/view/compose-view.js';
import {
  activeFilterCount,
  DEFAULT_INBOX_STATE,
  emptyInboxCopy,
  groupByDay,
  inboxRequest,
  isLongBody,
  mergeLive,
  newestOccurredAt,
  organizationsIn,
  pagerLabel,
  parseInboxState,
  serializeInboxState,
  withFilter,
} from '../src/react/view/inbox-view.js';
import { severityLook } from '../src/react/view/severity-view.js';
import { dismissToast, EMPTY_TOAST_QUEUE, newestToast, pushToast } from '../src/react/view/toast-queue.js';

describe('the inbox state in the URL', () => {
  it('round-trips, leaving defaults out of the URL', () => {
    const state = {
      ...DEFAULT_INBOX_STATE,
      tab: 'unread' as const,
      order: 'newest' as const,
      size: 50,
      page: 3,
      after: 'abc',
    };
    expect(parseInboxState(serializeInboxState(state))).toEqual(state);
    expect(serializeInboxState(DEFAULT_INBOX_STATE)).toBe('');
  });

  it('falls back to defaults for anything unrecognised — a stale link opens the inbox, not an error', () => {
    expect(parseInboxState('?tab=everything&order=random&size=7&page=-2&severity=loud')).toEqual(DEFAULT_INBOX_STATE);
  });

  it('keeps `after` and drops `before` when a link carries both', () => {
    expect(parseInboxState('?after=a&before=b')).toMatchObject({ after: 'a', before: null });
  });

  it('⚠ goes back to page 1 when a filter changes — the old cursor points into a different list', () => {
    const deep = { ...DEFAULT_INBOX_STATE, page: 4, after: 'cursor' };
    expect(withFilter(deep, { severity: 'alert' })).toMatchObject({
      page: 1,
      after: null,
      before: null,
      severity: 'alert',
    });
  });

  it('asks for global-only or one organization, never both', () => {
    expect(inboxRequest({ ...DEFAULT_INBOX_STATE, from: 'global' })).toMatchObject({
      globalOnly: true,
      organizationId: null,
    });
    expect(inboxRequest({ ...DEFAULT_INBOX_STATE, from: 'org-1' })).toMatchObject({
      globalOnly: false,
      organizationId: 'org-1',
    });
    expect(inboxRequest({ ...DEFAULT_INBOX_STATE, tab: 'archived' })).toMatchObject({
      archived: true,
      unreadOnly: false,
    });
  });
});

describe('pagerLabel', () => {
  it('says where you are in the whole list', () => {
    expect(pagerLabel(3, 20, 20, 1284)).toBe('41–60 of 1,284');
    expect(pagerLabel(1, 20, 7, 7)).toBe('1–7 of 7');
    expect(pagerLabel(1, 20, 0, 0)).toBe('No notifications');
  });
});

describe('day groups', () => {
  const now = new Date(2026, 8, 25, 15, 0);

  it('labels today and yesterday, and keeps the order given', () => {
    const items = [
      { id: 'a', occurredAt: new Date(2026, 8, 25, 9).toISOString() },
      { id: 'b', occurredAt: new Date(2026, 8, 24, 9).toISOString() },
    ];
    expect(groupByDay(items, now).map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ['Today', ['a']],
      ['Yesterday', ['b']],
    ]);
  });

  it('⚠ lets a day appear twice in unread-first order rather than pulling a read item up among the unread', () => {
    const today = new Date(2026, 8, 25, 9).toISOString();
    const yesterday = new Date(2026, 8, 24, 9).toISOString();
    const items = [
      { id: 'unread', occurredAt: today },
      { id: 'read-old', occurredAt: yesterday },
      { id: 'read-today', occurredAt: today },
    ];
    expect(groupByDay(items, now).map((group) => group.label)).toEqual(['Today', 'Yesterday', 'Today']);
  });
});

describe('live rows and the filter list', () => {
  it('puts a new row on top and replaces one already shown', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(mergeLive(items, { id: 'c' }).map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(mergeLive(items, { id: 'b' }).map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('finds the newest time, and the organizations seen', () => {
    expect(newestOccurredAt([{ occurredAt: '2026-01-02' }, { occurredAt: '2026-01-03' }])).toBe('2026-01-03');
    expect(newestOccurredAt([])).toBeNull();
    expect(
      organizationsIn([
        { organizationId: 'o1', contextLabel: 'Acme · Front desk' },
        { organizationId: 'o1', contextLabel: 'Acme' },
        { organizationId: null, contextLabel: null },
        { organizationId: 'o2', contextLabel: null },
      ]),
    ).toEqual([
      { id: 'o1', label: 'Acme' },
      { id: 'o2', label: 'An organization' },
    ]);
  });
});

describe('the toast queue', () => {
  const toast = (id: string) => ({
    id,
    severity: 'info',
    title: id,
    body: null,
    sourceLabel: 'Queue',
    contextLabel: null,
    href: null,
    hrefTarget: null,
  });

  it('shows two and queues the rest, letting the next one in when one leaves', () => {
    let queue = EMPTY_TOAST_QUEUE;
    for (const id of ['a', 'b', 'c', 'd']) queue = pushToast(queue, toast(id));
    expect(queue.visible.map((item) => item.id)).toEqual(['a', 'b']);
    expect(queue.waiting.map((item) => item.id)).toEqual(['c', 'd']);
    queue = dismissToast(queue, 'a');
    expect(queue.visible.map((item) => item.id)).toEqual(['b', 'c']);
    expect(newestToast(queue)?.id).toBe('c');
  });

  it('⚠ replaces a toast for the same row in place and bumps its version, so a growing group is one toast', () => {
    let queue = pushToast(EMPTY_TOAST_QUEUE, toast('a'));
    queue = pushToast(queue, { ...toast('a'), title: '2 people joined' });
    expect(queue.visible).toEqual([expect.objectContaining({ id: 'a', title: '2 people joined', version: 1 })]);
  });
});

describe('severityLook', () => {
  it('uses theme status tokens, and draws an unknown severity as info rather than nothing', () => {
    expect(severityLook('alert').chip).toContain('bg-status-error');
    expect(severityLook('something-new').label).toBe('Info');
  });
});

describe('the compose screen', () => {
  const person = { userId: 'u1', displayName: 'Ana Reyes', email: 'ana@example.com' };
  const ready = { ...EMPTY_COMPOSE_DRAFT, recipients: [person], title: 'Maintenance tonight' };

  it('needs a recipient and a title, and nothing else', () => {
    expect(validateComposeDraft(EMPTY_COMPOSE_DRAFT)).toEqual({
      recipients: 'Add at least one person.',
      title: 'Give it a title.',
    });
    expect(validateComposeDraft(ready)).toEqual({});
  });

  it('⚠ ignores the button’s fields while the button is off, and requires a safe link when it is on', () => {
    expect(validateComposeDraft({ ...ready, linkHref: 'javascript:alert(1)' })).toEqual({});
    expect(composeButton({ ...ready, linkHref: '/x' })).toEqual({ linkLabel: null, linkHref: null });
    expect(validateComposeDraft({ ...ready, withButton: true })).toHaveProperty('linkHref');
    expect(validateComposeDraft({ ...ready, withButton: true, linkHref: 'javascript:alert(1)' })).toHaveProperty(
      'linkHref',
    );
    expect(composeButton({ ...ready, withButton: true, linkHref: ' /queue ', linkLabel: '' })).toEqual({
      linkLabel: null,
      linkHref: '/queue',
    });
  });

  it('says whether the button leaves the app', () => {
    expect(buttonOpensNewTab('https://example.com')).toBe(true);
    expect(buttonOpensNewTab('/admin')).toBe(false);
    expect(buttonOpensNewTab('  ')).toBe(false);
  });

  it('counts characters and warns near the limit', () => {
    expect(counter('abc', 10)).toEqual({ text: '3 / 10', near: false, over: false });
    expect(counter('x'.repeat(9), 10)).toMatchObject({ near: true, over: false });
    expect(counter('x'.repeat(11), 10)).toMatchObject({ over: true });
  });

  it('makes two-letter initials from a name or an email', () => {
    expect(initialsOf('Ana Reyes')).toBe('AR');
    expect(initialsOf('ana.reyes@example.com')).toBe('AR');
    expect(initialsOf('Cher')).toBe('CH');
    expect(initialsOf('')).toBe('?');
  });

  it('summarises who a send goes to', () => {
    expect(recipientSummary(0)).toBe('No recipients yet');
    expect(recipientSummary(1)).toBe('Sending to 1 person as Platform');
    expect(recipientSummary(1200)).toBe('Sending to 1,200 people as Platform');
  });

  it('draws the read bar, and never past 100%', () => {
    expect(readShare(3, 4)).toEqual({ percent: 75, label: '3 of 4 read' });
    expect(readShare(0, 0)).toEqual({ percent: 0, label: 'Nobody to read it' });
    expect(readShare(9, 4).percent).toBe(100);
  });

  it('wraps the highlighted match at both ends of the list', () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0);
    expect(moveHighlight(-1, -1, 3)).toBe(2);
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
    expect(moveHighlight(0, 1, 0)).toBe(-1);
  });

  it('describes every severity', () => {
    expect(severityHint('alert')).toMatch(/3 seconds/);
    expect(severityHint('info')).toMatch(/2 seconds/);
  });
});

describe('the inbox page’s filters and empty states', () => {
  it('counts only real filters — not the tab or the order', () => {
    expect(activeFilterCount({ ...DEFAULT_INBOX_STATE, tab: 'unread', order: 'newest' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_INBOX_STATE, severity: 'alert', from: 'global' })).toBe(2);
  });

  it('says why the list is empty, filters first', () => {
    expect(emptyInboxCopy({ ...DEFAULT_INBOX_STATE, tab: 'unread', severity: 'alert' }).title).toBe(
      'Nothing matches these filters',
    );
    expect(emptyInboxCopy({ ...DEFAULT_INBOX_STATE, tab: 'unread' }).title).toBe('You’re all caught up');
    expect(emptyInboxCopy({ ...DEFAULT_INBOX_STATE, tab: 'archived' }).title).toBe('Nothing archived');
    expect(emptyInboxCopy(DEFAULT_INBOX_STATE).title).toBe('No notifications yet');
  });

  it('folds a body that is long or runs past three lines', () => {
    expect(isLongBody(null)).toBe(false);
    expect(isLongBody('short')).toBe(false);
    expect(isLongBody('x'.repeat(221))).toBe(true);
    expect(isLongBody('a\nb\nc\nd')).toBe(true);
  });
});
