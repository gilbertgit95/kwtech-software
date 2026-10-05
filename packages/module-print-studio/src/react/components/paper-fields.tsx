'use client';

import { cn } from '@kwtech/web-ui/react';
import { useId } from 'react';
import type { StudioLayoutPaper, StudioOrientation } from '../../domain/layout.js';
import { findStudioPaper, STUDIO_PAPERS } from '../../domain/papers.js';
import { formatSize } from '../../domain/units.js';
import { INPUT_CLASS } from './controls.js';

/**
 * Picking one of the built-in papers and which way round it is — for printing
 * a document and for the ruler page, where a typed size is not needed.
 * (The layout editor has its own, which also takes a custom size.)
 */
export function PaperPicker({
  paper,
  orientation,
  onPaper,
  onOrientation,
}: {
  paper: StudioLayoutPaper;
  orientation: StudioOrientation;
  onPaper: (paper: StudioLayoutPaper) => void;
  onOrientation: (orientation: StudioOrientation) => void;
}) {
  const paperId = useId();
  const orientationId = useId();
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={paperId} className="text-xs font-medium text-muted-foreground">
          Paper
        </label>
        <select
          id={paperId}
          className={cn(INPUT_CLASS, 'h-9')}
          value={paper.key ?? ''}
          onChange={(event) => {
            const chosen = findStudioPaper(event.target.value);
            if (chosen) onPaper({ key: chosen.key, label: chosen.label, width: chosen.width, height: chosen.height });
          }}
        >
          {STUDIO_PAPERS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.alias ? `${option.label} / ${option.alias}` : option.label} —{' '}
              {formatSize(option.width, option.height, option.unit)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={orientationId} className="text-xs font-medium text-muted-foreground">
          Orientation
        </label>
        <select
          id={orientationId}
          className={cn(INPUT_CLASS, 'h-9')}
          value={orientation}
          onChange={(event) => onOrientation(event.target.value === 'landscape' ? 'landscape' : 'portrait')}
        >
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </div>
    </div>
  );
}

/** The paper a document or a ruler page starts on: A4, the office default here. */
export function defaultPaper(key: string): StudioLayoutPaper {
  const paper = findStudioPaper(key) ?? STUDIO_PAPERS[0];
  if (!paper) throw new Error('STUDIO_PAPERS is empty.');
  return { key: paper.key, label: paper.label, width: paper.width, height: paper.height };
}
