'use client';

import { cn } from '@kwtech/web-ui/react';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  effectiveKeymap,
  POS_DEFAULT_KEYMAP,
  type PosKeyAction,
  type PosKeymap,
  validateKeymap,
} from '../../domain/keymap.js';
import type { PosCatalogueView } from '../pos-client.js';
import { usePosData } from '../use-pos-data.js';
import type { TillState } from '../use-till.js';
import { keyOfPress } from '../view/keys.js';
import { actionsByZone, itemKeyTarget, KEY_ZONE_LABELS } from '../view/manage.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { Alert, Empty, Tabs } from './layout.js';

type SettingsTab = 'store' | 'keys';

/** Settings (D23): the store, and its hot keys. Behind `pos:manage_settings`. */
export function SettingsSection({ state }: { state: TillState }) {
  const [tab, setTab] = useState<SettingsTab>('store');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <Tabs
        label="Which settings"
        tabs={[
          { key: 'store', label: 'Store' },
          { key: 'keys', label: 'Hot keys' },
        ]}
        current={tab}
        onChange={setTab}
      />
      {tab === 'store' ? <StoreSettings state={state} /> : <KeySettings state={state} />}
    </div>
  );
}

/**
 * The store's time zone, READ ONLY here: it is the WORKSPACE's (PLAN §13,
 * 2026-09-29), shared with every other app in it, so it is changed where the
 * workspace is — never twice in two places that could disagree.
 */
function StoreSettings({ state }: { state: TillState }) {
  return (
    <section aria-label="Store" className="flex max-w-xl flex-col gap-2 rounded-lg border border-border p-4">
      <h2 className="text-base font-semibold">Time zone</h2>
      <p className="text-2xl font-semibold tabular-nums">{state.timeZone}</p>
      <p className="text-sm text-muted-foreground">
        Which day a sale belongs to, when “today” starts, and the time on receipts. It is the workspace’s time zone,
        shared with its other apps: change it in the workspace’s settings, under Administration.
      </p>
    </section>
  );
}

/**
 * The store's keymap (D18): every action's key, and item keys that ring up
 * one item or variant in a press. Checked by the same `validateKeymap` the
 * server runs before anything is saved, so every problem shows at once.
 *
 * A key is set by PRESSING it in the field (the same `keyOfPress` the till
 * reads keys with), so what is stored is exactly what the till will match.
 */
function KeySettings({ state }: { state: TillState }) {
  const { client, scope } = state;
  const loadSettings = useCallback(() => client.settings(scope), [client, scope]);
  const settings = usePosData(scope, loadSettings, ['settings'], 'Could not load the settings.');
  const loadCatalogue = useCallback(() => client.catalogue(scope, true), [client, scope]);
  const catalogue = usePosData(scope, loadCatalogue, ['catalogue'], 'Could not load the items.');
  const [draft, setDraft] = useState<PosKeymap | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // The saved keymap becomes the draft once, and again after each save.
  const savedText = settings.data?.keymap ?? null;
  useEffect(() => {
    if (savedText === null) return;
    try {
      setDraft(effectiveKeymap(JSON.parse(savedText) as Partial<PosKeymap>));
    } catch {
      setDraft(POS_DEFAULT_KEYMAP);
    }
  }, [savedText]);

  if (!draft) {
    return settings.error ? <Alert message={settings.error} /> : <Empty>Loading…</Empty>;
  }

  const change = (next: PosKeymap) => {
    setDraft(next);
    setProblems([]);
    setSaved(false);
  };
  const setAction = (action: PosKeyAction, key: string) =>
    change({ ...draft, actions: { ...draft.actions, [action]: key } });

  const save = async (keymap: PosKeymap) => {
    const checked = validateKeymap(keymap);
    if ('refused' in checked) {
      setProblems(checked.refused);
      return;
    }
    setSaving(true);
    try {
      await client.saveSettings(scope, JSON.stringify(checked.keymap));
      setError(null);
      setProblems([]);
      setSaved(true);
      await settings.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the hot keys.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Hot keys" className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Click a field and press the key. Enter, Esc, Tab and the arrows are fixed, and keys the browser needs (F5, F11,
        F12, Ctrl+P …) cannot be used. Every till in the store uses these.
      </p>
      {actionsByZone().map(({ zone, actions }) => (
        <div key={zone} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
          <h3 className="text-sm font-medium">{KEY_ZONE_LABELS[zone]}</h3>
          <ul className="grid gap-1.5 @lg:grid-cols-2">
            {actions.map(({ action, label }) => (
              <li key={action} className="flex items-center justify-between gap-2 text-sm">
                <label htmlFor={`key-${action}`}>{label}</label>
                <KeyInput
                  id={`key-${action}`}
                  value={draft.actions[action]}
                  onChange={(key) => setAction(action, key)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      <ItemKeys draft={draft} catalogue={catalogue.data} onChange={change} />

      {problems.length > 0 ? (
        <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">These keys cannot be saved:</p>
          <ul className="list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Alert message={error} onDismiss={() => setError(null)} />
      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved. Open tills pick up the new keys on their own.
        </p>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          disabled={saving}
          className={buttonClass('ghost')}
          onClick={() => change({ actions: POS_DEFAULT_KEYMAP.actions, items: draft.items })}
        >
          Reset actions to the defaults
        </button>
        <button type="button" disabled={saving} className={buttonClass('primary')} onClick={() => void save(draft)}>
          {saving ? 'Saving…' : 'Save hot keys'}
        </button>
      </div>
    </section>
  );
}

/** A field that records the key pressed in it, rather than the text typed. Backspace alone is a key too. */
function KeyInput({ id, value, onChange }: { id: string; value: string; onChange: (key: string) => void }) {
  return (
    <input
      id={id}
      readOnly
      className={cn(INPUT_CLASS, 'w-32 cursor-pointer text-center font-mono caret-transparent')}
      value={value}
      onKeyDown={(event) => {
        // Tab still moves focus: a keyboard user must be able to leave the field.
        if (event.key === 'Tab') return;
        event.preventDefault();
        const key = keyOfPress(event);
        if (key) onChange(key);
      }}
    />
  );
}

/** Item keys (D18): a function key that rings up one item or variant at the till. */
function ItemKeys({
  draft,
  catalogue,
  onChange,
}: {
  draft: PosKeymap;
  catalogue: PosCatalogueView | null;
  onChange: (next: PosKeymap) => void;
}) {
  const items = catalogue?.items ?? [];
  const live = items.filter((item) => item.archivedAt === null);
  const entries = Object.entries(draft.items);

  const setEntry = (oldKey: string, key: string, target: { itemId: string; variantId: string | null }) => {
    const next: Record<string, { itemId: string; variantId: string | null }> = {};
    for (const [existing, value] of entries) next[existing === oldKey ? key : existing] = value;
    next[key] = target;
    onChange({ ...draft, items: next });
  };
  const remove = (key: string) =>
    onChange({ ...draft, items: Object.fromEntries(entries.filter(([existing]) => existing !== key)) });
  const firstFree = () => {
    for (let n = 1; n <= 12; n += 1) {
      const key = `Shift+F${n}`;
      if (!(key in draft.items)) return key;
    }
    return 'Shift+F1';
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Item keys</h3>
        <button
          type="button"
          disabled={live.length === 0}
          className={buttonClass('secondary', 'sm')}
          onClick={() => {
            const first = live[0];
            if (!first) return;
            // An item with variants has no option of its own in the picker: its first variant, then.
            const variant = first.variants.find((candidate) => candidate.archivedAt === null);
            setEntry('', firstFree(), { itemId: first.id, variantId: variant?.id ?? null });
          }}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add item key
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        One press rings up the item, anywhere at the till. Function keys only, such as Shift+F1 to Shift+F12.
      </p>
      {entries.length === 0 ? <Empty>No item keys yet.</Empty> : null}
      <ul className="flex flex-col gap-1.5">
        {entries.map(([key, target]) => {
          const current = itemKeyTarget(target, items);
          const value = `${target.itemId}:${target.variantId ?? ''}`;
          return (
            <li key={key} className="flex flex-wrap items-center gap-2 text-sm">
              <KeyInput id={`item-key-${key}`} value={key} onChange={(next) => setEntry(key, next, target)} />
              <label htmlFor={`item-target-${key}`} className="sr-only">
                What {key} rings up
              </label>
              <select
                id={`item-target-${key}`}
                className={cn(INPUT_CLASS, 'min-w-0 flex-1', current.broken && 'border-destructive')}
                value={value}
                onChange={(event) => {
                  const [itemId = '', variantId = ''] = event.target.value.split(':');
                  setEntry(key, key, { itemId, variantId: variantId === '' ? null : variantId });
                }}
              >
                {current.broken ? <option value={value}>{current.label} — broken</option> : null}
                {live.map((item) => {
                  const variants = item.variants.filter((variant) => variant.archivedAt === null);
                  if (variants.length === 0) {
                    return (
                      <option key={item.id} value={`${item.id}:`}>
                        {item.name}
                      </option>
                    );
                  }
                  return (
                    <optgroup key={item.id} label={item.name}>
                      {variants.map((variant) => (
                        <option key={variant.id} value={`${item.id}:${variant.id}`}>
                          {item.name} — {variant.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <button
                type="button"
                aria-label={`Remove item key ${key}`}
                className={buttonClass('ghost', 'sm')}
                onClick={() => remove(key)}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
      {entries.some(([, target]) => itemKeyTarget(target, items).broken) ? (
        <p className="text-xs text-destructive">
          A broken key points at an archived or removed item and does nothing at the till. Pick another item or remove
          it.
        </p>
      ) : null}
    </div>
  );
}
