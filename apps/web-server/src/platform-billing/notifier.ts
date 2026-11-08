import type { NotificationSender } from '@kwtech/module-notification/server';
import { PLATFORM_BILLING_FEATURE } from '@kwtech/module-platform-billing';
import type {
  ApproversDigestNotice,
  BillingReminderNotice,
  BillingRequestNotice,
  PlatformBillingNotifier,
} from '@kwtech/module-platform-billing/server';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * `module-platform-billing`'s notifier, spoken as notifications
 * (`module-notification`'s recipe). Billing says what happened (a due date
 * nears, access ended, a request was approved); this finds who to tell and
 * chooses the words, the severity and the source.
 *
 * WHO:
 * - an organization's notices go to the members whose organization role
 *   holds `platform-billing:read` (the owner and the admins, D8). The billing
 *   keys skip the plan filter (D13), so the role alone answers it, and an
 *   expired organization is still told;
 * - approvers' notices go to the holders of the app-level
 *   `platform-billing:approve`, with no organization context (`global`).
 *
 * ⚠ Each method answers whether the notice was delivered, or there was nobody
 * to tell: the daily check marks its row sent only then. `sendSafely` answers
 * null on a failure, which is `false` here.
 *
 * The button opens the organization's subscription page: the Billing page
 * replaces it in phase 6 (#96), and its link goes with it.
 */
export class PlatformBillingNotifierAdapter implements PlatformBillingNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: NotificationSender,
  ) {}

  /** A daily-check reminder, to the organization's owner and admins. */
  async reminder(notice: BillingReminderNotice): Promise<boolean> {
    const recipientIds = await this.billingHolders(notice.organizationId);
    if (recipientIds.length === 0) return true;
    const plan = await this.planLabel(notice.planKey);
    const words = reminderWords(notice, plan);
    const sent = await this.sender.sendSafely({
      recipientIds,
      severity: words.severity,
      title: words.title,
      body: words.body,
      source: notice.kind === 'no_payment_details' ? 'billing.request' : 'billing.reminder',
      context: { scope: 'organization', organizationId: notice.organizationId },
      actions: [
        { kind: 'link', key: 'open', label: 'Open billing', href: billingHref(notice.organizationId), target: 'self' },
      ],
    });
    return sent !== null;
  }

  /** The daily count of requests waiting more than a day, to billing approvers. */
  async approversDigest(notice: ApproversDigestNotice): Promise<boolean> {
    const recipientIds = await this.approvers();
    if (recipientIds.length === 0) return true;
    const many = notice.waiting === 1 ? 'A billing request has' : `${notice.waiting} billing requests have`;
    const sent = await this.sender.sendSafely({
      recipientIds,
      severity: 'warning',
      title: `${many} waited more than a day`,
      body: `The oldest was made on ${shortDay(notice.oldestRequestedOn)}. Check its payment and approve or reject it.`,
      source: 'billing.approvals',
      context: { scope: 'global' },
    });
    return sent !== null;
  }

  /** A request's step: what to check goes to approvers, a decision to the organization. */
  async requestChanged(notice: BillingRequestNotice): Promise<boolean> {
    const plan = await this.planLabel(notice.planKey);
    const toApprovers = notice.step === 'submitted' || notice.step === 'details_entered';
    const recipientIds = toApprovers ? await this.approvers() : await this.billingHolders(notice.organizationId);
    if (recipientIds.length === 0) return true;
    const words = requestWords(notice, plan);
    const sent = await this.sender.sendSafely({
      recipientIds,
      severity: words.severity,
      title: words.title,
      body: words.body,
      source: toApprovers ? 'billing.approvals' : 'billing.request',
      context: toApprovers ? { scope: 'global' } : { scope: 'organization', organizationId: notice.organizationId },
      ...(toApprovers
        ? {}
        : {
            actions: [
              {
                kind: 'link' as const,
                key: 'open',
                label: 'Open billing',
                href: billingHref(notice.organizationId),
                target: 'self' as const,
              },
            ],
          }),
      // A request's steps fold into one unread row per request.
      group: { key: `billing:request:${notice.requestId}`, title: `{count} updates on a billing request` },
    });
    return sent !== null;
  }

  /** The organization's members whose role holds billing: the owner and the admins (D8). */
  private async billingHolders(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.permMembership.findMany({
      where: {
        organizationId,
        status: 'active',
        roles: {
          some: { role: { disabledAt: null, features: { some: { featureKey: PLATFORM_BILLING_FEATURE.read } } } },
        },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId))];
  }

  /** The holders of the app-level approve key: billing approvers and whoever else is granted it. */
  private async approvers(): Promise<string[]> {
    const rows = await this.prisma.permUserRole.findMany({
      where: {
        role: {
          level: 'app',
          disabledAt: null,
          features: { some: { featureKey: PLATFORM_BILLING_FEATURE.approve } },
        },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId))];
  }

  /** A plan's label for the words, its key when it is gone. */
  private async planLabel(planKey: string | null): Promise<string> {
    if (!planKey) return 'your plan';
    const plan = await this.prisma.permPlan.findFirst({ where: { key: planKey }, select: { label: true } });
    return plan?.label ?? planKey;
  }
}

type Severity = 'info' | 'success' | 'warning' | 'alert';

/** The words of a reminder: what is due, and what to do about it. */
export function reminderWords(
  notice: Pick<BillingReminderNotice, 'kind' | 'daysLeft' | 'periodEnd' | 'accessUntil'>,
  plan: string,
): { severity: Severity; title: string; body: string } {
  const due = notice.periodEnd ? shortDay(notice.periodEnd) : 'soon';
  const days = (count: number) => (count === 1 ? '1 day' : `${count} days`);
  switch (notice.kind) {
    case 'due_in_7':
    case 'due_in_3':
    case 'due_in_1':
      return {
        severity: 'info',
        title: `${plan} renews in ${days(notice.daysLeft)}`,
        body: `It is due on ${due}. Renew it from the Billing page, then add your payment details.`,
      };
    case 'due_today':
      return {
        severity: 'warning',
        title: `${plan} is due today`,
        body: 'Renew it from the Billing page and add your payment details, so it can be approved.',
      };
    case 'overdue':
      return {
        severity: 'warning',
        title: `${plan} is overdue: ${days(notice.daysLeft)} of access left`,
        body: `It was due on ${due}. Renew it and add your payment details before access ends.`,
      };
    case 'last_warning':
      return {
        severity: 'alert',
        title: `Last day of access to ${plan}`,
        body: 'Access ends tomorrow. Renew it and add your payment details today to keep it.',
      };
    case 'expired':
      return {
        severity: 'alert',
        title: `${plan} has ended`,
        body: 'Its paid features are paused and nothing was deleted. Billing stays open so you can renew.',
      };
    case 'no_payment_details':
      return {
        severity: 'warning',
        title: 'A billing request is waiting for its payment details',
        body: 'Nothing can be approved until they are entered. Add how and when you paid on the Billing page.',
      };
  }
}

/** The words of a request's step. */
export function requestWords(
  notice: Pick<BillingRequestNotice, 'step' | 'reason'>,
  plan: string,
): { severity: Severity; title: string; body: string } {
  const because = notice.reason ? ` Reason: ${notice.reason}` : '';
  switch (notice.step) {
    case 'submitted':
      return { severity: 'info', title: `New billing request: ${plan}`, body: 'It waits for its payment details.' };
    case 'details_entered':
      return {
        severity: 'info',
        title: `Payment details entered: ${plan}`,
        body: 'Check the payment and approve or reject the request.',
      };
    case 'approved':
      return {
        severity: 'success',
        title: `${plan} approved`,
        body: 'Your payment was confirmed and the plan applied.',
      };
    case 'rejected':
      return { severity: 'warning', title: `Billing request rejected: ${plan}`, body: `Nothing changed.${because}` };
    case 'withdrawn':
      return { severity: 'info', title: `Billing request withdrawn: ${plan}`, body: `Nothing changed.${because}` };
    case 'voided':
      return {
        severity: 'alert',
        title: `An approval was reversed: ${plan}`,
        body: `Its receipt was voided and the plan put back as it was.${because}`,
      };
    case 'closed_as_credit':
      return {
        severity: 'info',
        title: `Payment kept as credit: ${plan}`,
        body: `The request could not be applied, so the payment was added to your credit. Request again to use it.${because}`,
      };
    case 'cancelled':
      return {
        severity: 'info',
        title: `${plan} will end at the close of its period`,
        body: 'No more renewals will be asked for. Renew it to keep it after all.',
      };
  }
}

/** "1 Dec 2026", for a day key: a calendar day has no zone, so it is formatted in UTC. */
function shortDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', dateStyle: 'medium' });
}

/** The organization's subscription page, until the Billing page (#96) replaces it. */
function billingHref(organizationId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}/subscription`;
}
