'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { DatePicker } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PLATFORM_BILLING_PAYMENT_METHODS } from '../../domain/payments.js';
import { PLATFORM_BILLING_FEATURE } from '../../feature-keys.js';
import {
  type BillingAdminClient,
  type BillingPlanEntryView,
  type BillingPriceRowView,
  type BillingSettingsView,
  createBillingAdminClient,
} from '../billing-admin-client.js';
import { buttonClass, ErrorLine, Field, inputClass, Reason, Section } from '../components/ui.js';
import { BILLING_ADMIN_ROUTE } from '../routes.js';
import {
  checkPriceDraft,
  checkSettingsDraft,
  type PriceDraft,
  type PriceDraftErrors,
  type SettingsDraft,
  type SettingsDraftErrors,
  settingsChange,
  settingsDraft,
} from '../view/admin-view.js';
import { billingDayOf, formatDay, formatMoney, paymentMethodLabel } from '../view/billing-view.js';
import { parseAmount } from '../view/payment-form.js';

export interface AdminSettingsPageProps {
  client?: BillingAdminClient;
}

/**
 * `/admin/billing/settings` (phase 7): what every bill and receipt is
 * written from. The currency and the time zone (fixed once anything is
 * billed, D16), the grace, the issuer printed on documents, the accounts an
 * organization pays into; and each plan's monthly price from a day on.
 *
 * Read with `queue_read`; changing anything needs `manage_settings`, which
 * the server checks again.
 */
export function AdminSettingsPage({ client }: AdminSettingsPageProps) {
  const api = useMemo(() => client ?? createBillingAdminClient(), [client]);
  const canManage = useHoldsFeature(PLATFORM_BILLING_FEATURE.manageSettings);
  const [settings, setSettings] = useState<BillingSettingsView | null>(null);
  const [plans, setPlans] = useState<BillingPlanEntryView[]>([]);
  const [prices, setPrices] = useState<BillingPriceRowView[]>([]);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [errors, setErrors] = useState<SettingsDraftErrors>({});
  const [price, setPrice] = useState<PriceDraft>({ planKey: '', amount: '', effectiveFrom: '' });
  const [priceErrors, setPriceErrors] = useState<PriceDraftErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Reads the settings, the plans and the prices again, and resets the forms to them. */
  const load = useCallback(async () => {
    try {
      const [nextSettings, nextPlans, nextPrices] = await Promise.all([api.settings(), api.planList(), api.prices()]);
      setSettings(nextSettings);
      setPlans(nextPlans);
      setPrices(nextPrices);
      setDraft(settingsDraft(nextSettings));
      setPrice((current) => ({
        planKey: current.planKey || (nextPlans[0]?.key ?? ''),
        amount: current.amount,
        effectiveFrom: current.effectiveFrom || billingDayOf(new Date(), nextSettings.timeZone),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the billing settings.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one change, then reads everything again whatever happened. */
  async function run(action: () => Promise<unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the settings.');
      return false;
    } finally {
      // ⚠ Busy until the re-read lands: enabled earlier, a second save would diff against the settings as they were and could undo the first.
      await load();
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!draft || !settings) return;
    const found = checkSettingsDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const change = settingsChange(draft, settings);
    if (Object.keys(change).length === 0) {
      setNotice('Nothing changed.');
      return;
    }
    await run(() => api.setSettings(change), 'Saved.');
  }

  async function savePrice() {
    const found = checkPriceDraft(price);
    setPriceErrors(found);
    if (Object.keys(found).length > 0) return;
    const monthly = parseAmount(price.amount);
    if (monthly === null) return;
    const saved = await run(
      () => api.setPrice(price.planKey, monthly, price.effectiveFrom),
      `Saved: the price applies to bills issued from ${formatDay(price.effectiveFrom)}.`,
    );
    if (saved) setPrice((current) => ({ ...current, amount: '' }));
  }

  const edit = (patch: Partial<SettingsDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const currency = settings?.currency ?? 'PHP';
  const disabled = !canManage || busy;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <a href={BILLING_ADMIN_ROUTE} className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to the billing queue
      </a>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What every bill and receipt is written from. A document keeps what it said when it was issued, so a change
          here reaches only documents issued after it.
        </p>
      </header>
      {error ? <ErrorLine message={error} onDismiss={() => setError(null)} onReload={() => void load()} /> : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {canManage ? null : <Reason>Changing these needs the billing settings key; you can read them.</Reason>}

      {!settings || !draft ? (
        error ? null : (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        )
      ) : (
        <>
          <Section title="Settings">
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveSettings();
              }}
            >
              <Field
                label="Currency"
                error={errors.currency}
                hint={settings.locked ? 'Fixed: bills have been issued in it.' : 'Three letters, like PHP.'}
              >
                {(id, note) => (
                  <input
                    id={id}
                    value={draft.currency}
                    disabled={disabled || settings.locked}
                    aria-invalid={errors.currency ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ currency: event.target.value.toUpperCase() })}
                    className={inputClass(Boolean(errors.currency))}
                  />
                )}
              </Field>
              <Field
                label="Time zone"
                error={errors.timeZone}
                hint={
                  settings.locked
                    ? 'Fixed: billed periods are counted in it.'
                    : 'Every billing day is counted in it, like Asia/Manila.'
                }
              >
                {(id, note) => (
                  <input
                    id={id}
                    value={draft.timeZone}
                    disabled={disabled || settings.locked}
                    aria-invalid={errors.timeZone ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ timeZone: event.target.value })}
                    className={inputClass(Boolean(errors.timeZone))}
                  />
                )}
              </Field>
              <Field
                label="Grace days"
                error={errors.graceDays}
                hint="Days after a period ends before access stops. A change reaches periods written after it."
              >
                {(id, note) => (
                  <input
                    id={id}
                    inputMode="numeric"
                    value={draft.graceDays}
                    disabled={disabled}
                    aria-invalid={errors.graceDays ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ graceDays: event.target.value })}
                    className={inputClass(Boolean(errors.graceDays))}
                  />
                )}
              </Field>
              <Field label="Issuer name" error={errors.issuerName} hint="Printed at the top of every bill and receipt.">
                {(id, note) => (
                  <input
                    id={id}
                    value={draft.issuerName}
                    disabled={disabled}
                    aria-invalid={errors.issuerName ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ issuerName: event.target.value })}
                    className={inputClass(Boolean(errors.issuerName))}
                  />
                )}
              </Field>
              <div className="md:col-span-2">
                <Field
                  label="Issuer details"
                  error={errors.issuerDetails}
                  hint="Address, tax number: printed under the name."
                >
                  {(id, note) => (
                    <textarea
                      id={id}
                      rows={3}
                      value={draft.issuerDetails}
                      disabled={disabled}
                      aria-invalid={errors.issuerDetails ? true : undefined}
                      aria-describedby={note}
                      onChange={(event) => edit({ issuerDetails: event.target.value })}
                      className={inputClass(Boolean(errors.issuerDetails))}
                    />
                  )}
                </Field>
              </div>

              <fieldset className="md:col-span-2">
                <legend className="text-sm font-medium">Where organizations pay</legend>
                <p className="text-xs text-muted-foreground">
                  Shown to an organization with its bill: the account name and number for each way to pay.
                </p>
                {draft.paymentAccounts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">No accounts yet: organizations see only cash.</p>
                ) : null}
                <ul className="mt-2 space-y-2">
                  {draft.paymentAccounts.map((account, index) => (
                    <li
                      key={account.key}
                      className="grid gap-2 rounded-md border border-border p-2 md:grid-cols-[10rem_1fr_1fr_auto]"
                    >
                      <select
                        aria-label={`Account ${index + 1}: method`}
                        value={account.method}
                        disabled={disabled}
                        onChange={(event) =>
                          edit({
                            paymentAccounts: replaceAt(draft.paymentAccounts, index, { method: event.target.value }),
                          })
                        }
                        className={inputClass()}
                      >
                        {PLATFORM_BILLING_PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {paymentMethodLabel(method)}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Account ${index + 1}: label`}
                        placeholder="GCash, BDO savings…"
                        value={account.label}
                        disabled={disabled}
                        onChange={(event) =>
                          edit({
                            paymentAccounts: replaceAt(draft.paymentAccounts, index, { label: event.target.value }),
                          })
                        }
                        className={inputClass()}
                      />
                      <input
                        aria-label={`Account ${index + 1}: details`}
                        placeholder="Account name and number"
                        value={account.details}
                        disabled={disabled}
                        onChange={(event) =>
                          edit({
                            paymentAccounts: replaceAt(draft.paymentAccounts, index, { details: event.target.value }),
                          })
                        }
                        className={inputClass()}
                      />
                      <button
                        type="button"
                        className={buttonClass()}
                        disabled={disabled}
                        onClick={() => edit({ paymentAccounts: draft.paymentAccounts.filter((_, at) => at !== index) })}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                {errors.paymentAccounts ? (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {errors.paymentAccounts}
                  </p>
                ) : null}
                <button
                  type="button"
                  className={`${buttonClass()} mt-2`}
                  disabled={disabled}
                  onClick={() =>
                    edit({
                      paymentAccounts: [
                        ...draft.paymentAccounts,
                        { key: crypto.randomUUID(), method: 'e_wallet', label: '', details: '' },
                      ],
                    })
                  }
                >
                  Add an account
                </button>
              </fieldset>

              <div className="md:col-span-2">
                <button type="submit" className={buttonClass('primary')} disabled={disabled}>
                  {busy ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            </form>
          </Section>

          <Section title="Plan prices">
            <p className="text-sm text-muted-foreground">
              A plan with no price cannot be subscribed to. A new price applies to bills issued from its day on; a bill
              already issued keeps its own.
            </p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1 font-medium">Plan</th>
                  <th className="py-1 font-medium">Today</th>
                  <th className="py-1 font-medium">Price history</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.key} className="border-b border-border align-top">
                    <td className="py-2">
                      {plan.label}
                      <span className="block text-xs text-muted-foreground">
                        {plan.archived ? 'Archived' : plan.isPublic ? 'On sale' : 'Not on sale'}
                      </span>
                    </td>
                    <td className="py-2 tabular-nums">
                      {plan.monthly === null ? 'No price' : `${formatMoney(plan.monthly, currency)} a month`}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {prices
                        .filter((row) => row.planKey === plan.key)
                        .map((row) => `${formatMoney(row.monthly, currency)} from ${formatDay(row.effectiveFrom)}`)
                        .join('; ') || 'None'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {canManage ? (
              <form
                className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  void savePrice();
                }}
              >
                <Field label="Plan" error={priceErrors.planKey}>
                  {(id, note) => (
                    <select
                      id={id}
                      value={price.planKey}
                      aria-invalid={priceErrors.planKey ? true : undefined}
                      aria-describedby={note}
                      onChange={(event) => setPrice({ ...price, planKey: event.target.value })}
                      className={inputClass(Boolean(priceErrors.planKey))}
                    >
                      {plans.map((plan) => (
                        <option key={plan.key} value={plan.key}>
                          {plan.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Monthly price" error={priceErrors.amount} hint={`In ${currency}.`}>
                  {(id, note) => (
                    <input
                      id={id}
                      inputMode="decimal"
                      value={price.amount}
                      aria-invalid={priceErrors.amount ? true : undefined}
                      aria-describedby={note}
                      onChange={(event) => setPrice({ ...price, amount: event.target.value })}
                      className={inputClass(Boolean(priceErrors.amount))}
                    />
                  )}
                </Field>
                <Field label="From" error={priceErrors.effectiveFrom}>
                  {(id, note) => (
                    <DatePicker
                      id={id}
                      value={price.effectiveFrom || null}
                      today={billingDayOf(new Date(), settings.timeZone)}
                      clearable={false}
                      className="w-full"
                      aria-invalid={priceErrors.effectiveFrom ? true : undefined}
                      aria-describedby={note}
                      onChange={(day) => setPrice({ ...price, effectiveFrom: day ?? price.effectiveFrom })}
                    />
                  )}
                </Field>
                <button type="submit" className={buttonClass('primary')} disabled={busy}>
                  {busy ? 'Saving…' : 'Set price'}
                </button>
              </form>
            ) : null}
          </Section>
        </>
      )}
    </div>
  );
}

/** `rows` with the one at `index` patched: a new array, the input untouched. */
function replaceAt<T>(rows: readonly T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, at) => (at === index ? { ...row, ...patch } : row));
}
