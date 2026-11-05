'use client';

import { cn } from '@kwtech/web-ui/react';
import { Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  effectiveAlertTones,
  POS_ALERT_TONE_IDS,
  type PosAlertMoment,
  type PosAlertSound,
  type PosAlertTones,
} from '../../domain/alert-tones.js';
import { createTonePlayer, type PosTonePlayer } from '../tone-player.js';
import type { TillState } from '../use-till.js';
import { POS_TONES } from '../view/tone-notes.js';
import { buttonClass, INPUT_CLASS, Modal } from './controls.js';

const MOMENTS: readonly { moment: PosAlertMoment; label: string; hint: string }[] = [
  { moment: 'newOrder', label: 'New order', hint: 'A seller holds an order for the cashier.' },
  { moment: 'updatedOrder', label: 'Order updated', hint: 'A seller adds to, or changes, an order already waiting.' },
];

/**
 * Plays a tone from a Play button. Its own player, so the editor works on the
 * Settings tab too, where no Cashier screen is open; the click itself is the
 * tap the browser wants before it allows sound.
 */
function usePreview(): (sound: PosAlertSound) => void {
  const player = useRef<PosTonePlayer | null>(null);
  useEffect(() => {
    player.current = createTonePlayer();
    return () => {
      player.current?.close();
      player.current = null;
    };
  }, []);
  return (sound) => {
    const current = player.current;
    if (!current) return;
    void current.unlock().then(() => current.play(sound.tone, sound.volume));
  };
}

/**
 * The order sounds, both moments (issue #68): on or off, which tone, how
 * loud, and Play to hear it. Controlled: the caller saves.
 */
export function AlertTonesEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: PosAlertTones;
  onChange: (next: PosAlertTones) => void;
  disabled?: boolean;
}) {
  const play = usePreview();
  return (
    <div className="flex flex-col gap-3">
      {MOMENTS.map(({ moment, label, hint }) => (
        <SoundRow
          key={moment}
          label={label}
          hint={hint}
          sound={value[moment]}
          disabled={disabled}
          onChange={(sound) => onChange({ ...value, [moment]: sound })}
          onPlay={() => play(value[moment])}
        />
      ))}
    </div>
  );
}

/** The speaker drawn beside a sound's slider: crossed out when it would make no sound. */
function volumeIcon(sound: Pick<PosAlertSound, 'on' | 'volume'>) {
  if (!sound.on || sound.volume === 0) return VolumeX;
  if (sound.volume < 50) return Volume1;
  return Volume2;
}

function SoundRow({
  label,
  hint,
  sound,
  disabled,
  onChange,
  onPlay,
}: {
  label: string;
  hint: string;
  sound: PosAlertSound;
  disabled: boolean;
  onChange: (sound: PosAlertSound) => void;
  onPlay: () => void;
}) {
  const id = useId();
  const VolumeIcon = volumeIcon(sound);
  return (
    <fieldset
      disabled={disabled}
      className={cn('flex flex-col gap-3 rounded-xl border border-border p-3', sound.on ? null : 'bg-muted/40')}
    >
      <legend className="sr-only">{label}</legend>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold" id={`${id}-label`}>
            {label}
          </span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        {/* A switch: one tap turns the sound on or off, and says which it is. */}
        <button
          type="button"
          role="switch"
          aria-checked={sound.on}
          aria-labelledby={`${id}-label`}
          onClick={() => onChange({ ...sound, on: !sound.on })}
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none',
            sound.on ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-block size-6 rounded-full bg-background shadow transition-transform motion-reduce:transition-none',
              sound.on ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      {sound.on ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`${id}-tone`}>
              {label}: tone
            </label>
            <select
              id={`${id}-tone`}
              value={sound.tone}
              onChange={(event) => {
                const tone = POS_ALERT_TONE_IDS.find((one) => one === event.target.value);
                if (tone) onChange({ ...sound, tone });
              }}
              className={cn(INPUT_CLASS, 'h-11 min-w-0 flex-1 rounded-xl')}
            >
              {POS_ALERT_TONE_IDS.map((tone) => (
                <option key={tone} value={tone}>
                  {POS_TONES[tone].label} — {POS_TONES[tone].description}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onPlay}
              className={cn(buttonClass('secondary'), 'h-11 shrink-0 rounded-xl')}
              aria-label={`Play the ${label.toLowerCase()} sound`}
            >
              <Play aria-hidden="true" className="size-4" />
              Play
            </button>
          </div>
          <div className="flex items-center gap-3">
            <VolumeIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <label className="sr-only" htmlFor={`${id}-volume`}>
              {label}: volume
            </label>
            <input
              id={`${id}-volume`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={sound.volume}
              onChange={(event) => onChange({ ...sound, volume: Number(event.target.value) })}
              className="h-11 min-w-0 flex-1 accent-primary"
            />
            <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{sound.volume}%</span>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * MY SOUNDS (issue #68): the Cashier screen's own choice, for this person
 * alone. Starts from what plays now; Save keeps it as theirs, and "Use the
 * store's sounds" lets the store's defaults play again.
 */
export function MySoundsDialog({ open, state, onClose }: { open: boolean; state: TillState; onClose: () => void }) {
  const { store, mine } = state.alertTones;
  const [draft, setDraft] = useState<PosAlertTones>(effectiveAlertTones(store, mine));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each opening starts from what plays now, not from a draft left behind.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening is the trigger; a live re-read while it is open must not overwrite what is being chosen.
  useEffect(() => {
    if (!open) return;
    setDraft(effectiveAlertTones(store, mine));
    setError(null);
  }, [open]);

  const save = async (tones: PosAlertTones | null) => {
    setSaving(true);
    setError(null);
    try {
      // Saved, the till re-reads its settings at once (`pos-local-events.ts`): what plays changes with no reload.
      await state.client.saveMyAlertTones(state.scope, tones ? JSON.stringify(tones) : null);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your sounds.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="My order sounds" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {mine
            ? 'You use your own sounds. They play only on your Cashier screen.'
            : 'You use the store’s sounds. Change them here to keep your own — only on your Cashier screen.'}
        </p>
        <AlertTonesEditor value={draft} onChange={setDraft} disabled={saving} />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {mine ? (
            <button
              type="button"
              disabled={saving}
              className={cn(buttonClass('ghost'), 'h-11')}
              onClick={() => void save(null)}
            >
              Use the store’s sounds
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={saving}
            className={cn(buttonClass('primary'), 'h-11 min-w-32 rounded-xl')}
            onClick={() => void save(draft)}
          >
            {saving ? 'Saving…' : 'Save my sounds'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The store's order sounds on the Settings tab (`pos:manage_settings`): the defaults every Cashier plays. */
export function StoreSoundsSettings({ state }: { state: TillState }) {
  const [draft, setDraft] = useState<PosAlertTones>(state.alertTones.store);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * A save elsewhere (another manager, another tab) arrives through the till's
   * live re-read. ⚠ COMPARED BY VALUE: every re-read — on focus, on any
   * settings event — builds a new object, and resetting on identity wiped a
   * draft half chosen whenever the window came back (CodeRabbit on #71).
   */
  const storedText = JSON.stringify(state.alertTones.store);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stored VALUE is the trigger; the object behind it changes on every read.
  useEffect(() => setDraft(state.alertTones.store), [storedText]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await state.client.saveAlertTones(state.scope, JSON.stringify(draft));
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the order sounds.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Order sounds" className="flex max-w-xl flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="text-base font-semibold">Order sounds</h2>
      <p className="text-sm text-muted-foreground">
        What the Cashier screen plays when an order arrives or changes — only while Cashier is the screen showing. Each
        cashier may keep their own instead, from the Cashier screen’s sound button.
      </p>
      <AlertTonesEditor
        value={draft}
        onChange={(next) => {
          setDraft(next);
          setSaved(false);
        }}
        disabled={saving}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved. Open Cashier screens play the new sounds on their own.
        </p>
      ) : null}
      <button
        type="button"
        disabled={saving}
        className={cn(buttonClass('primary'), 'w-fit')}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save order sounds'}
      </button>
    </section>
  );
}
