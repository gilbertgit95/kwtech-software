import type { BillingQueueFlagsView, BillingQueueItemView } from '../src/react/billing-admin-client.js';
import type { BillingRequestView } from '../src/react/billing-client.js';
import { platformBillingWebModule } from '../src/react/module.js';
import {
  approvalDraft,
  checkDecisionReason,
  checkPriceDraft,
  checkSettingsDraft,
  isReadyToCheck,
  queueChecks,
  type SettingsDraft,
  settingsChange,
  settingsDraft,
  sortQueue,
} from '../src/react/view/admin-view.js';
import { billingDayOf } from '../src/react/view/billing-view.js';

const QUIET: BillingQueueFlagsView = {
  referenceUsedOn: [],
  amount: 'exact',
  amountDifference: 0,
  missingDetails: false,
  holdInForce: false,
  selfRequest: false,
  viewerIsMember: false,
};

/** A queue item with only the fields the rules read. */
function item(id: string, requestedAt: string, coveredOn: string | null): BillingQueueItemView {
  return {
    request: { id, requestedAt, coveredOn, state: 'pending' } as BillingRequestView,
    organizationName: null,
    flags: QUIET,
  };
}

describe('queueChecks: what each check says', () => {
  it('says nothing when nothing flags', () => {
    expect(queueChecks(QUIET, 'PHP')).toEqual([]);
  });

  it('names what triggered each check, warnings for what needs a closer look', () => {
    const checks = queueChecks(
      { ...QUIET, amount: 'short', amountDifference: 25_000, referenceUsedOn: ['r2', 'r3'], selfRequest: true },
      'PHP',
    );
    expect(checks.map((check) => check.tone)).toEqual(['warning', 'warning', 'info']);
    expect(checks[0]?.text).toContain('250.00 short');
    expect(checks[1]?.text).toContain('2 other requests');
    expect(checks[2]?.text).toContain('self-approval');
  });

  it('reads an overpayment as credit to come, not a problem', () => {
    expect(queueChecks({ ...QUIET, amount: 'over', amountDifference: 100 }, 'PHP')).toEqual([
      { tone: 'info', text: expect.stringContaining('becomes credit') },
    ]);
  });
});

describe('the queue order', () => {
  it('puts the requests ready to check first, then the oldest first', () => {
    const sorted = sortQueue([
      item('new-uncovered', '2026-11-03T00:00:00.000Z', null),
      item('old-uncovered', '2026-11-01T00:00:00.000Z', null),
      item('covered', '2026-11-02T00:00:00.000Z', '2026-11-02'),
    ]);
    expect(sorted.map((one) => one.request.id)).toEqual(['covered', 'old-uncovered', 'new-uncovered']);
  });

  it('counts only a waiting request as ready', () => {
    expect(isReadyToCheck({ state: 'approved', coveredOn: '2026-11-02' })).toBe(false);
    expect(isReadyToCheck({ state: 'pending', coveredOn: '2026-11-02' })).toBe(true);
  });
});

describe('approvalDraft: the approval starts from what the owner said', () => {
  it('copies the latest details', () => {
    const draft = approvalDraft(
      {
        bill: null,
        payments: [
          { method: 'cash', amount: 1, paidOn: '2026-11-01', reference: null, sender: null },
          { method: 'e_wallet', amount: 120_050, paidOn: '2026-11-02', reference: 'GC1', sender: 'Ana' },
        ] as BillingRequestView['payments'],
      },
      '2026-11-08',
    );
    expect(draft).toEqual({
      method: 'e_wallet',
      amount: '1200.50',
      paidOn: '2026-11-02',
      reference: 'GC1',
      sender: 'Ana',
      note: '',
    });
  });

  it('falls back to the bill and the billing day when nothing was entered', () => {
    const draft = approvalDraft({ payments: [], bill: { total: 100_000 } as BillingRequestView['bill'] }, '2026-11-08');
    expect(draft).toMatchObject({ method: 'cash', amount: '1000.00', paidOn: '2026-11-08' });
  });
});

describe('a decision reason', () => {
  it('is required for a rejection or a void, optional for a close', () => {
    expect(checkDecisionReason('  ', true)).toContain('Say why');
    expect(checkDecisionReason('  ', false)).toBeNull();
    expect(checkDecisionReason('Wrong reference', true)).toBeNull();
    expect(checkDecisionReason('x'.repeat(501), false)).toContain('500');
  });
});

describe('the settings form', () => {
  const settings = {
    currency: 'PHP',
    timeZone: 'Asia/Manila',
    graceDays: 7,
    issuerName: 'KW Tech',
    issuerDetails: '',
    paymentAccounts: [{ method: 'e_wallet', label: 'GCash', details: '0917' }],
    locked: true,
  };

  it('sends nothing when nothing changed, so a locked currency is never refused', () => {
    expect(settingsChange(settingsDraft(settings), settings)).toEqual({});
  });

  it('sends only what changed, the accounts trimmed and without their row keys', () => {
    const draft: SettingsDraft = {
      ...settingsDraft(settings),
      graceDays: '3',
      paymentAccounts: [{ key: 'saved-0', method: 'e_wallet', label: ' GCash ', details: '0918 ' }],
    };
    expect(settingsChange(draft, settings)).toEqual({
      graceDays: 3,
      paymentAccounts: [{ method: 'e_wallet', label: 'GCash', details: '0918' }],
    });
  });

  it('says what the server would refuse', () => {
    const errors = checkSettingsDraft({
      ...settingsDraft(settings),
      currency: 'peso',
      graceDays: '32',
      paymentAccounts: [{ key: 'k', method: 'cash', label: ' ', details: '' }],
    });
    expect(Object.keys(errors).sort()).toEqual(['currency', 'graceDays', 'paymentAccounts']);
    expect(errors.graceDays).toContain('0 to 31');
    expect(checkSettingsDraft({ ...settingsDraft(settings), graceDays: '1.5' }).graceDays).toBeDefined();
  });
});

describe('the price form', () => {
  it('needs a plan, an amount and a real day', () => {
    expect(checkPriceDraft({ planKey: 'basic', amount: '1,000', effectiveFrom: '2026-12-01' })).toEqual({});
    expect(Object.keys(checkPriceDraft({ planKey: '', amount: 'ten', effectiveFrom: '2026-02-30' })).sort()).toEqual([
      'amount',
      'effectiveFrom',
      'planKey',
    ]);
  });
});

describe('the billing day', () => {
  it('is the billing zone’s day, not UTC’s, and an unknown zone falls back to Manila', () => {
    const evening = new Date('2026-11-08T17:00:00.000Z');
    expect(billingDayOf(evening, 'Asia/Manila')).toBe('2026-11-09');
    expect(billingDayOf(evening, 'Europe/London')).toBe('2026-11-08');
    expect(billingDayOf(evening, 'Not/AZone')).toBe('2026-11-09');
  });
});

describe('the platform pages in the descriptor', () => {
  it('declares each with the queue key, the print page without the app frame', () => {
    const admin = (platformBillingWebModule.routes ?? []).filter((route) => route.path.startsWith('/admin/billing'));
    expect(admin.map((route) => route.path)).toEqual([
      '/admin/billing',
      '/admin/billing/requests/:requestId',
      '/admin/billing/requests/:requestId/document',
      '/admin/billing/organizations',
      '/admin/billing/reports',
      '/admin/billing/settings',
    ]);
    expect(new Set(admin.map((route) => route.feature))).toEqual(new Set(['platform-billing:queue_read']));
    expect(admin.find((route) => route.path.endsWith('/document'))?.chrome).toBe('fullscreen');
  });
});
