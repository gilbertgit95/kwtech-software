'use client';

import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import { Download, Pencil, Plus, Printer, Ruler, Trash2 } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import {
  NO_CALIBRATION,
  prepareCalibrationName,
  rulerLengthFor,
  SCALE_ONE,
  STUDIO_OFFSET_MAX,
  scaleFromMeasurement,
} from '../../domain/calibration.js';
import { printableArea, type StudioLayoutPaper, type StudioOrientation } from '../../domain/layout.js';
import { mm } from '../../domain/units.js';
import { downloadResult, printResult } from '../render/result.js';
import { makeRulerResult } from '../render/ruler.js';
import type { StudioCalibrationView } from '../studio-client.js';
import type { StudioAppState } from '../studio-state.js';
import { useStudioAction, useStudioData } from '../use-studio-data.js';
import { lengthText, parseLength, scaleText } from '../view/lengths.js';
import { buttonClass, Field, FORM_FOOTER_CLASS, INPUT_CLASS, Modal } from './controls.js';
import { Alert, Empty, EmptyState } from './layout.js';
import { defaultPaper, PaperPicker } from './paper-fields.js';

/** The margin the ruler page keeps: 5 mm, inside what any printer reaches. */
const RULER_MARGIN = mm(5);

/**
 * Calibration (PRINT-STUDIO-PLAN decision 21): making up for a printer that
 * does not print at exactly 100%.
 *
 * Three steps, said on the screen: print the ruler page, measure its two lines
 * with a real ruler, type what you read. The studio then draws a touch larger
 * or smaller for that printer, and a 1 × 1 measures one inch.
 *
 * A profile is its maker's own — it describes the printer on THEIR desk — and
 * is picked beside "Make the result" on the Print screen.
 */
export function CalibrationSection({ state }: { state: StudioAppState }) {
  const load = useCallback(() => state.client.calibrations(state.scope), [state.client, state.scope]);
  const profiles = useStudioData(load, 'Could not load the calibration profiles.');
  const act = useStudioAction('Could not change the calibration profile.');
  const [paper, setPaper] = useState<StudioLayoutPaper>(() => defaultPaper('a4'));
  const [orientation, setOrientation] = useState<StudioOrientation>('portrait');
  const [editing, setEditing] = useState<StudioCalibrationView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<StudioCalibrationView | null>(null);
  const [rulerBusy, setRulerBusy] = useState(false);
  const [rulerError, setRulerError] = useState<string | null>(null);

  const rulerSpec = useMemo(
    () => ({
      paper,
      orientation,
      margins: { top: RULER_MARGIN, right: RULER_MARGIN, bottom: RULER_MARGIN, left: RULER_MARGIN },
    }),
    [paper, orientation],
  );
  const expected = rulerLengthFor(printableArea(rulerSpec));

  async function ruler(output: 'download' | 'print') {
    setRulerBusy(true);
    setRulerError(null);
    try {
      const result = await makeRulerResult(rulerSpec);
      if (output === 'download') downloadResult(result, 'ruler-page.pdf');
      else printResult(result);
    } catch (caught) {
      setRulerError(caught instanceof Error ? caught.message : 'Could not make the ruler page.');
    } finally {
      setRulerBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <Alert message={profiles.error ?? act.error ?? rulerError} onDismiss={act.error ? act.dismissError : undefined} />

      <div>
        <h2 className="text-lg font-semibold tracking-tight">Calibration</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Only needed if your prints come out slightly too large, too small or off to one side. Print a ruler page,
          measure it, and the studio makes up the difference for that printer from then on.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
        <h3 className="text-sm font-semibold">1. Print the ruler page</h3>
        <p className="text-xs text-muted-foreground">
          Print it on the printer and paper you want to check, at 100% (“actual size”). It has two lines, each{' '}
          {lengthText(expected, 'mm')} mm long on this paper.
        </p>
        <div className="max-w-md">
          <PaperPicker paper={paper} orientation={orientation} onPaper={setPaper} onOrientation={setOrientation} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass('primary', 'sm')}
            disabled={rulerBusy}
            onClick={() => void ruler('download')}
          >
            <Download aria-hidden="true" className="size-3.5" />
            {rulerBusy ? 'Making…' : 'Download the ruler page'}
          </button>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            disabled={rulerBusy}
            onClick={() => void ruler('print')}
          >
            <Printer aria-hidden="true" className="size-3.5" />
            Print it
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">2. Measure it, and save what you read</h3>
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" className="size-3.5" />
            New profile
          </button>
        </div>
        {profiles.loading && !profiles.data ? <Empty>Loading…</Empty> : null}
        {profiles.data && profiles.data.length === 0 ? (
          <EmptyState icon={Ruler} title="No calibration profiles yet">
            Without one the studio prints as drawn, which is right for a printer that prints at exactly 100%.
          </EmptyState>
        ) : null}
        <ul className="flex flex-col gap-2">
          {(profiles.data ?? []).map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{profile.name}</p>
                <p className="text-xs text-muted-foreground">
                  Across {scaleText(profile.scaleX)}%, down {scaleText(profile.scaleY)}% · shifted{' '}
                  {lengthText(profile.offsetX, 'mm')} mm right, {lengthText(profile.offsetY, 'mm')} mm down
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  disabled={act.busy}
                  onClick={() => setEditing(profile)}
                >
                  <Pencil aria-hidden="true" className="size-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  className={cn(buttonClass('ghost', 'sm'), 'text-destructive')}
                  disabled={act.busy}
                  onClick={() => setDeleting(profile)}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {editing ? (
        <ProfileDialog
          state={state}
          profile={editing === 'new' ? null : editing}
          expected={expected}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void profiles.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        pending={act.busy}
        title="Delete this calibration profile?"
        description={`“${deleting?.name ?? ''}” will be deleted. Results made with it afterwards print as drawn.`}
        confirmLabel="Delete profile"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const profile = deleting;
          if (!profile) return;
          void act
            .run(() => state.client.deleteCalibration(state.scope, profile.id))
            .then(async (done) => {
              setDeleting(null);
              if (done) await profiles.reload();
            });
        }}
      />
    </div>
  );
}

/**
 * A profile, made from what the ruler measured.
 *
 * The person types the two lengths they read; the scale is worked out from
 * them (`scaleFromMeasurement`) and never typed, so nobody has to know that a
 * line measuring 99 mm means "draw at 101.01%". The shift is typed directly:
 * it is what the ruler says the page is off by.
 */
function ProfileDialog({
  state,
  profile,
  expected,
  onClose,
  onSaved,
}: {
  state: StudioAppState;
  profile: StudioCalibrationView | null;
  /** The length the ruler page's lines were drawn at, in units. */
  expected: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = profile ?? NO_CALIBRATION;
  const [name, setName] = useState(profile?.name ?? '');
  // What a line of `expected` would have measured under the profile's scale: the inverse of the correction.
  const [across, setAcross] = useState(lengthText(Math.round((expected * SCALE_ONE) / start.scaleX), 'mm'));
  const [down, setDown] = useState(lengthText(Math.round((expected * SCALE_ONE) / start.scaleY), 'mm'));
  const [right, setRight] = useState(signedText(start.offsetX));
  const [lower, setLower] = useState(signedText(start.offsetY));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useStudioAction('Could not save the calibration profile.');
  const formId = useId();

  async function submit() {
    const next: Record<string, string> = {};
    const prepared = prepareCalibrationName(name);
    if ('refused' in prepared) next.name = 'Give the profile a name, such as the printer and paper.';

    const scaleX = scaleFromMeasurement(expected, parseLength(across, 'mm') ?? 0);
    const scaleY = scaleFromMeasurement(expected, parseLength(down, 'mm') ?? 0);
    const far = 'That is more than 10% off. Check the page was printed at actual size, not “fit to page”.';
    if (scaleX === null) next.across = far;
    if (scaleY === null) next.down = far;

    const offsetX = parseSigned(right);
    const offsetY = parseSigned(lower);
    const shift = 'Type a shift of at most 10 mm; use a minus sign for left or up.';
    if (offsetX === null) next.right = shift;
    if (offsetY === null) next.lower = shift;

    setErrors(next);
    if ('refused' in prepared || scaleX === null || scaleY === null || offsetX === null || offsetY === null) return;

    const done = await save.run(() =>
      state.client.saveCalibration(state.scope, {
        ...(profile ? { id: profile.id } : {}),
        name: prepared.name,
        scaleX,
        scaleY,
        offsetX,
        offsetY,
      }),
    );
    if (done) onSaved();
  }

  const expectedText = `${lengthText(expected, 'mm')} mm`;
  return (
    <Modal open title={profile ? 'Edit calibration profile' : 'New calibration profile'} onClose={onClose}>
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Alert message={save.error} onDismiss={save.dismissError} />
        <Field label="Name" hint="The printer and the paper, so you can pick it later." error={errors.name ?? null}>
          {(id, describedBy) => (
            <input
              id={id}
              // biome-ignore lint/a11y/noAutofocus: the form opens on its first field, not on Close.
              autoFocus
              aria-describedby={describedBy}
              aria-invalid={errors.name ? true : undefined}
              className={INPUT_CLASS}
              value={name}
              placeholder="Epson L3210, 4R"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="The line across measured (mm)" hint={`Drawn as ${expectedText}.`} error={errors.across ?? null}>
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="decimal"
                aria-describedby={describedBy}
                aria-invalid={errors.across ? true : undefined}
                className={INPUT_CLASS}
                value={across}
                onChange={(event) => setAcross(event.target.value)}
              />
            )}
          </Field>
          <Field label="The line down measured (mm)" hint={`Drawn as ${expectedText}.`} error={errors.down ?? null}>
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="decimal"
                aria-describedby={describedBy}
                aria-invalid={errors.down ? true : undefined}
                className={INPUT_CLASS}
                value={down}
                onChange={(event) => setDown(event.target.value)}
              />
            )}
          </Field>
          <Field label="Move everything right (mm)" hint="Minus moves it left." error={errors.right ?? null}>
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="decimal"
                aria-describedby={describedBy}
                aria-invalid={errors.right ? true : undefined}
                className={INPUT_CLASS}
                value={right}
                onChange={(event) => setRight(event.target.value)}
              />
            )}
          </Field>
          <Field label="Move everything down (mm)" hint="Minus moves it up." error={errors.lower ?? null}>
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="decimal"
                aria-describedby={describedBy}
                aria-invalid={errors.lower ? true : undefined}
                className={INPUT_CLASS}
                value={lower}
                onChange={(event) => setLower(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={buttonClass('ghost')} disabled={save.busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={save.busy}>
            {save.busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A shift in units as the text of its field, in millimetres, with its sign. */
function signedText(units: number): string {
  return `${units < 0 ? '-' : ''}${lengthText(Math.abs(units), 'mm')}`;
}

/** A typed shift in millimetres as units, or null when it is not one or is past the limit. */
function parseSigned(text: string): number | null {
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-');
  const size = parseLength(negative ? trimmed.slice(1) : trimmed, 'mm');
  if (size === null || size > STUDIO_OFFSET_MAX) return null;
  return negative ? -size : size;
}
