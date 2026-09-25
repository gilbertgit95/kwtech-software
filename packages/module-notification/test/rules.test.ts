import { shouldShowSystemPopup } from '../src/domain/browser-notify.js';
import { NOTIFICATION_BULK_MAX, prepareBulkIds } from '../src/domain/bulk.js';
import { floodWindowStart, isFlooded, NOTIFICATION_FLOOD_FLOOR, resolveFloodLimit } from '../src/domain/flood.js';
import { louderSeverity, overflowGroup, renderGroupTitle } from '../src/domain/grouping.js';
import { liveIndicator, nextIndicatorChangeIn } from '../src/domain/live-state.js';
import { missedSummaryText, planMissedToasts, toastDurationMs, toastPoliteness } from '../src/domain/toast.js';
import { badgeText, bellLabel, stripTabTitle, tabTitle } from '../src/domain/unread.js';

describe('the badge and the tab title', () => {
  it('shows nothing at zero, the number up to 99, then 99+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  it('⚠ tells a screen reader the whole number, never "99+"', () => {
    expect(bellLabel(1234)).toBe('Notifications, 1234 unread');
    expect(bellLabel(0)).toBe('Notifications');
  });

  it('⚠ never stacks its prefix, however often it is re-applied', () => {
    expect(tabTitle('kwtech', 3)).toBe('(3) kwtech');
    expect(tabTitle('(3) kwtech', 4)).toBe('(4) kwtech');
    expect(tabTitle('(99+) kwtech', 0)).toBe('kwtech');
    expect(stripTabTitle('(12) Roles · kwtech')).toBe('Roles · kwtech');
  });

  it('leaves a title that merely starts with a bracket alone', () => {
    expect(stripTabTitle('(Draft) Report')).toBe('(Draft) Report');
  });
});

describe('toasts', () => {
  it('⚠ keeps every toast short — a nudge, not the place to read it', () => {
    expect(toastDurationMs('info')).toBe(2_000);
    expect(toastDurationMs('success')).toBe(2_000);
    expect(toastDurationMs('warning')).toBe(3_000);
    expect(toastDurationMs('alert')).toBe(3_000);
  });

  it('announces only an alert assertively', () => {
    expect(toastPoliteness('alert')).toBe('assertive');
    expect(toastPoliteness('warning')).toBe('polite');
  });

  it('⚠ gives each missed alert its own toast and summarises the rest — even past what was fetched', () => {
    const missed = [
      { id: 'a', severity: 'alert' as const },
      { id: 'b', severity: 'info' as const },
      { id: 'c', severity: 'alert' as const },
    ];
    expect(planMissedToasts(missed, 120)).toEqual({ alerts: [missed[0], missed[2]], summaryCount: 118 });
    expect(planMissedToasts([], 0)).toEqual({ alerts: [], summaryCount: 0 });
    expect(missedSummaryText(1)).toBe('1 notification arrived while you were offline.');
    expect(missedSummaryText(3)).toBe('3 notifications arrived while you were offline.');
  });
});

describe('the connection dot', () => {
  const since = 1_000_000;

  it('shows nothing while live, idle, or with no socket at all', () => {
    expect(liveIndicator('live', since, since + 60_000)).toBe('none');
    expect(liveIndicator('idle', since, since + 60_000)).toBe('none');
    expect(liveIndicator(null, since, since + 60_000)).toBe('none');
  });

  it('⚠ waits three seconds before saying "reconnecting" — the routine reconnect must not flicker', () => {
    expect(liveIndicator('reconnecting', since, since + 2_999)).toBe('none');
    expect(liveIndicator('reconnecting', since, since + 3_000)).toBe('reconnecting');
  });

  it('says "paused" after thirty seconds', () => {
    expect(liveIndicator('reconnecting', since, since + 30_000)).toBe('paused');
  });

  it('⚠ says "paused" at once for a refused socket — nothing will retry it', () => {
    expect(liveIndicator('refused', since, since)).toBe('paused');
  });

  it('knows when it will next change by itself, so the screen sets one timer instead of polling', () => {
    expect(nextIndicatorChangeIn('reconnecting', since, since + 1_000)).toBe(2_000);
    expect(nextIndicatorChangeIn('reconnecting', since, since + 10_000)).toBe(20_000);
    expect(nextIndicatorChangeIn('reconnecting', since, since + 40_000)).toBeNull();
    expect(nextIndicatorChangeIn('live', since, since)).toBeNull();
  });
});

describe('grouping', () => {
  it('⚠ shows a group of one under its own title, never "1 people joined"', () => {
    expect(renderGroupTitle('{count} people joined', 1, 'Ana joined')).toBe('Ana joined');
    expect(renderGroupTitle('{count} people joined', 5, 'Ana joined')).toBe('5 people joined');
  });

  it('files a flood under one overflow group per source', () => {
    expect(overflowGroup({ key: 'queue.session', label: 'Queue' })).toEqual({
      key: 'overflow:queue.session',
      title: '{count} more notifications from Queue',
    });
  });

  it('⚠ keeps a group as loud as its loudest member', () => {
    expect(louderSeverity('info', 'alert')).toBe('alert');
    expect(louderSeverity('alert', 'info')).toBe('alert');
    expect(louderSeverity('success', 'warning')).toBe('warning');
  });
});

describe('the flood rule', () => {
  it('⚠ falls back to the floor for a missing or nonsense limit — never "unlimited"', () => {
    expect(resolveFloodLimit(undefined)).toBe(NOTIFICATION_FLOOD_FLOOR);
    expect(resolveFloodLimit(0)).toBe(NOTIFICATION_FLOOD_FLOOR);
    expect(resolveFloodLimit(-5)).toBe(NOTIFICATION_FLOOD_FLOOR);
    expect(resolveFloodLimit(2.5)).toBe(NOTIFICATION_FLOOD_FLOOR);
    expect(resolveFloodLimit(50)).toBe(50);
  });

  it('is flooded AT the limit, so the limit-th item is the last one written', () => {
    expect(isFlooded(19, 20)).toBe(false);
    expect(isFlooded(20, 20)).toBe(true);
  });

  it('counts the last minute', () => {
    expect(floodWindowStart(new Date('2026-09-25T09:01:00Z')).toISOString()).toBe('2026-09-25T09:00:00.000Z');
  });
});

describe('bulk ids', () => {
  it('de-duplicates, and refuses past the cap rather than truncating', () => {
    expect(prepareBulkIds(['a', 'b', 'a', ''])).toEqual(['a', 'b']);
    expect(prepareBulkIds(Array.from({ length: NOTIFICATION_BULK_MAX + 1 }, (_, i) => `n${i}`))).toBeNull();
  });
});

describe('system pop-ups', () => {
  const self = { tabId: 'b', visible: false, seenAt: 1000 };
  const input = { enabled: true, permission: 'granted' as const, self, others: [], now: 1000 };

  it('pops up from a hidden tab when it is the only one', () => {
    expect(shouldShowSystemPopup(input)).toBe(true);
  });

  it('never without the setting or the permission', () => {
    expect(shouldShowSystemPopup({ ...input, enabled: false })).toBe(false);
    expect(shouldShowSystemPopup({ ...input, permission: 'default' })).toBe(false);
  });

  it('⚠ stays quiet when ANY tab is visible — its toast already told them', () => {
    expect(shouldShowSystemPopup({ ...input, self: { ...self, visible: true } })).toBe(false);
    expect(shouldShowSystemPopup({ ...input, others: [{ tabId: 'z', visible: true, seenAt: 999 }] })).toBe(false);
  });

  it('⚠ lets only the lowest-id hidden tab speak, so two tabs are one pop-up', () => {
    const others = [{ tabId: 'a', visible: false, seenAt: 999 }];
    expect(shouldShowSystemPopup({ ...input, others })).toBe(false);
    expect(shouldShowSystemPopup({ ...input, self: { ...self, tabId: 'a' }, others: [{ ...self, tabId: 'b' }] })).toBe(
      true,
    );
  });

  it('ignores a tab it has not heard from in a while — it was closed without saying so', () => {
    const stale = [{ tabId: 'a', visible: true, seenAt: 1000 - 60_000 }];
    expect(shouldShowSystemPopup({ ...input, others: stale })).toBe(true);
  });
});
