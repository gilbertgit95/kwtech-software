import { STUDIO_CALIBRATION_NAME_MAX } from '../domain/calibration.js';
import { STUDIO_CELLS_MAX, STUDIO_LAYOUT_NAME_MAX } from '../domain/layout.js';
import { STUDIO_LAYOUT_TAG_MAX } from '../domain/tags.js';
import type { StudioRefusal } from '../types.js';

/**
 * ⚠ ONE MESSAGE for a layout that does not exist, is in another workspace, or
 * is somebody else's private layout. Any difference — even in wording — tells a
 * prober which of the three it hit. Exported because the app compares it:
 * production strips error reasons, so the message is all a client sees.
 */
export const STUDIO_NOT_FOUND_MESSAGE = 'That layout is not here — it may have been deleted or is no longer shared';

/** What a stale save is told. The app compares it to offer "load the newer one". */
export const STUDIO_CONFLICT_MESSAGE = 'This layout was changed somewhere else since you opened it';

/**
 * One error type for every refusal a studio operation makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence gets it wrong on the first rewording.
 */
export class StudioWriteError extends Error {
  constructor(
    readonly reason: StudioRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StudioWriteError';
  }
}

export function layoutNotFound(): StudioWriteError {
  return new StudioWriteError('not_found', STUDIO_NOT_FOUND_MESSAGE);
}

/** The sentence for each refusal a domain check can return. */
export function refusalError(reason: StudioRefusal): StudioWriteError {
  return new StudioWriteError(reason, REFUSAL_MESSAGES[reason]);
}

const REFUSAL_MESSAGES: Record<StudioRefusal, string> = {
  not_found: STUDIO_NOT_FOUND_MESSAGE,
  not_permitted: 'You cannot do that here',
  not_owner: 'Only the person who made this layout can change who sees it',
  conflict: STUDIO_CONFLICT_MESSAGE,
  limit_reached: 'You have reached the most layouts you can keep here',
  invalid_name: `A name is needed, of at most ${STUDIO_LAYOUT_NAME_MAX} characters for a layout and ${STUDIO_CALIBRATION_NAME_MAX} for a calibration profile`,
  invalid_tag: `A tag is one line of at most ${STUDIO_LAYOUT_TAG_MAX} characters`,
  duplicate_name: 'You already have a calibration profile with that name',
  invalid_visibility: 'A layout is either private or shared with the workspace',
  invalid_spec: 'That layout could not be read — reload the page and try again',
  invalid_paper: 'That paper size is not one the studio can use',
  invalid_margins: 'Those margins are not valid',
  no_printable_area: 'Those margins leave nothing to print on',
  too_many_cells: `A layout can have at most ${STUDIO_CELLS_MAX} cells`,
  cell_too_small: 'A cell is too small to hold a photo',
  cell_outside: 'A cell reaches outside the printable area',
  cell_overlap: 'Two cells overlap',
  invalid_calibration:
    'That calibration is too far from 100% to be a printer’s tolerance — check that the page was printed at actual size',
  invalid_log: 'That print could not be recorded',
  invalid_keymap: 'Those shortcut keys cannot be saved',
};
