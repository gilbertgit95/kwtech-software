'use client';

import { cn } from '@kwtech/web-ui/react';
import { useId } from 'react';
import {
  STUDIO_BORDER_COLORS,
  STUDIO_BORDER_STYLES,
  type StudioBorder,
  type StudioBorderColor,
  type StudioBorderStyle,
} from '../../domain/layout.js';
import { INPUT_CLASS } from './controls.js';

/** The thicknesses on offer, in hundredths of a millimetre. A list, not a free field: nobody thinks in 0.37 mm. */
const WIDTHS: readonly { value: number; label: string }[] = [
  { value: 8, label: 'Hairline' },
  { value: 25, label: 'Thin — 0.25 mm' },
  { value: 50, label: 'Medium — 0.5 mm' },
  { value: 100, label: 'Thick — 1 mm' },
  { value: 200, label: 'Very thick — 2 mm' },
];

const STYLE_LABELS: Record<StudioBorderStyle, string> = { solid: 'Solid', dashed: 'Dashed' };
const COLOR_LABELS: Record<StudioBorderColor, string> = { grey: 'Grey', black: 'Black' };

/**
 * The border around each cell (the operator, 2026-10-05): whether there is
 * one, solid or dashed, how thick, and how dark. For knowing where to cut — a
 * pale design on white paper has no edge of its own.
 *
 * Used twice: in the layout editor, where it is saved with the layout, and on
 * the Print screen, where it can be changed for one print without touching the
 * layout.
 */
export function BorderControls({
  on,
  border,
  onOn,
  onBorder,
}: {
  on: boolean;
  border: StudioBorder;
  onOn: (on: boolean) => void;
  onBorder: (border: StudioBorder) => void;
}) {
  const widthId = useId();
  // A width saved by hand, or by a later version, that is not on the list still shows as itself.
  const widths = WIDTHS.some((option) => option.value === border.width)
    ? WIDTHS
    : [...WIDTHS, { value: border.width, label: `${border.width / 100} mm` }];
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={on}
          onChange={(event) => onOn(event.target.checked)}
        />
        Print a border around each cell
      </label>
      {on ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Choice
              label="Line"
              options={STUDIO_BORDER_STYLES.map((style) => ({ value: style, label: STYLE_LABELS[style] }))}
              value={border.style}
              onChange={(style) => onBorder({ ...border, style })}
            />
            <Choice
              label="Shade"
              options={STUDIO_BORDER_COLORS.map((color) => ({ value: color, label: COLOR_LABELS[color] }))}
              value={border.color}
              onChange={(color) => onBorder({ ...border, color })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={widthId} className="text-xs font-medium text-muted-foreground">
              Thickness
            </label>
            <select
              id={widthId}
              className={cn(INPUT_CLASS, 'h-9')}
              value={border.width}
              onChange={(event) => onBorder({ ...border, width: Number(event.target.value) })}
            >
              {widths.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            The line is centred on each cell’s edge: cut down the middle of it and the photo is its exact size.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            className={cn(
              'h-7 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              option.value === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** A border in a few words, for a folded card's summary: "Dashed, 0.5 mm, black". */
export function borderSummary(on: boolean, border: StudioBorder): string {
  if (!on) return 'No border';
  const width =
    WIDTHS.find((option) => option.value === border.width)?.label.split(' — ')[0] ?? `${border.width / 100} mm`;
  return `${STYLE_LABELS[border.style]}, ${width.toLowerCase()}, ${COLOR_LABELS[border.color].toLowerCase()}`;
}
