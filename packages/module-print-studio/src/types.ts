/**
 * The shapes the domain decides over. Plain data, no framework, so the server
 * half and the web half hold the same rules.
 */

/**
 * Who may see a layout.
 *
 *   private   — its owner, and nobody else, whatever keys they hold.
 *   workspace — every member of the workspace holding `studio:read`.
 */
export type StudioVisibility = 'private' | 'workspace';

/** The facts every access decision needs, and no more. */
export interface StudioLayoutFacts {
  ownerId: string;
  visibility: StudioVisibility;
}

/**
 * Why a studio operation was refused. One union for the module, carried by its
 * one error class at the service boundary.
 *
 * ⚠ `not_found` ALSO MEANS "somebody else's private layout" and "a layout in
 * another workspace". Answering those differently would let anyone probe ids
 * and learn that a private layout exists (PRINT-STUDIO-PLAN decision 16).
 */
export type StudioRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'not_owner'
  | 'conflict'
  | 'limit_reached'
  | 'invalid_name'
  | 'invalid_tag'
  | 'duplicate_name'
  | 'invalid_visibility'
  | 'invalid_spec'
  | 'invalid_paper'
  | 'invalid_margins'
  | 'no_printable_area'
  | 'too_many_cells'
  | 'cell_too_small'
  | 'cell_outside'
  | 'cell_overlap'
  | 'invalid_calibration'
  | 'invalid_log'
  | 'invalid_keymap';
