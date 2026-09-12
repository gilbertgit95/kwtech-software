import { groupByMoment } from '../src/react/pages/defaults-page.js';
import type { DefaultView } from '../src/react/permissions-client.js';

/**
 * ── THE SECTIONS THE DEFAULTS SCREEN DRAWS ─────────────────────────────────
 *
 * ⚠ This replaced a `MOMENTS` const in the page — six headings the page owned,
 * which it filtered the defaults into. That was correct exactly as long as
 * `module-permissions` was the only module with defaults: a CONTRIBUTED
 * default's moment was not among them, so it had no section and never
 * rendered. Declared, composed, validated, settable through the API, and
 * invisible on the only screen anybody sets it from.
 *
 * So the sections are built from the ROWS, which arrive ordered and carrying
 * their heading. These assert the two properties that matter: the server's
 * order is reproduced without a second opinion here, and a row whose moment
 * nobody named still gets a section.
 */

const row = (key: string, moment: string, momentTitle: string | null): DefaultView =>
  ({
    key,
    moment,
    momentTitle,
    momentBlurb: momentTitle ? 'b' : null,
    momentOrder: 10,
    kind: 'choice',
    label: key,
    description: 'x',
    whenUnset: 'x',
    value: null,
    choices: [],
    updatedAt: null,
    updatedByUserId: null,
    targetLabel: null,
    targetIcon: null,
    targetUnavailable: false,
  }) as DefaultView;

describe('groupByMoment', () => {
  it('collects consecutive rows of one moment into a single section', () => {
    const groups = groupByMoment([
      row('organization.founder_role', 'organization_created', 'When an organization is created'),
      row('organization.plan', 'organization_created', 'When an organization is created'),
      row('chat.member_role', 'chat_participant_added', 'When somebody is added to a group'),
    ]);

    expect(groups.map((one) => [one.moment, one.rows.length])).toEqual([
      ['organization_created', 2],
      ['chat_participant_added', 1],
    ]);
  });

  /*
   * ⚠ ORDER COMES FROM THE ROWS. `listDefaults` sorts by the contributed
   * `momentOrder`, so walking the array in order is what reproduces it — the UI
   * holds no opinion about where a module's section belongs.
   */
  it('keeps the order the server sent, and does not merge a moment that recurs', () => {
    const groups = groupByMoment([
      row('b', 'second', 'Second'),
      row('a', 'first', 'First'),
      row('c', 'second', 'Second'),
    ]);

    expect(groups.map((one) => one.moment)).toEqual(['second', 'first', 'second']);
  });

  /**
   * ⚠ THE FAILURE THIS WHOLE SEAM EXISTS TO MAKE VISIBLE. A module that
   * declared a default and forgot the heading gets a section with no title —
   * the page falls back to the raw moment key, which an operator can act on —
   * rather than no section and no row at all.
   */
  it('⚠ still makes a section for a moment nobody declared', () => {
    const groups = groupByMoment([row('chat.member_role', 'chat_participant_added', null)]);

    expect(groups).toEqual([
      {
        moment: 'chat_participant_added',
        title: null,
        blurb: null,
        rows: [expect.objectContaining({ key: 'chat.member_role' })],
      },
    ]);
  });

  it('draws nothing at all for no defaults', () => {
    expect(groupByMoment([])).toEqual([]);
  });
});
