import type { AccessLine } from '../src/domain/access-explanation.js';
import { accessSummary, groupAccessLines, memberAccessHref, moduleHeading } from '../src/react/view/access-view.js';

/** The Access page's view rules (#173): filtering, grouping, the summary and the link. */
const line = (key: string, module: string, verdict: AccessLine['verdict']): AccessLine => ({
  key,
  label: key,
  description: '',
  module,
  level: 'workspace',
  verdict,
  grantedBy: [],
  viaPlatformRole: false,
  inPlans: [],
  holders: [],
});

const LINES = [
  line('pos:refund', 'pos', 'granted'),
  line('pos:settings', 'pos', 'not_granted'),
  line('stock:read', 'stock', 'not_entitled'),
];

describe('groupAccessLines', () => {
  it('groups by module in order', () => {
    expect(groupAccessLines(LINES, 'all').map((group) => [group.module, group.lines.length])).toEqual([
      ['pos', 2],
      ['stock', 1],
    ]);
  });

  it('counts a key the plan filters as not allowed', () => {
    expect(groupAccessLines(LINES, 'yes').flatMap((group) => group.lines.map((one) => one.key))).toEqual([
      'pos:refund',
    ]);
    expect(groupAccessLines(LINES, 'no').flatMap((group) => group.lines.map((one) => one.key))).toEqual([
      'pos:settings',
      'stock:read',
    ]);
  });

  it('drops a module the filter empties', () => {
    expect(groupAccessLines(LINES, 'yes').map((group) => group.module)).toEqual(['pos']);
  });
});

describe('accessSummary', () => {
  it('says how many are allowed', () => {
    expect(accessSummary(LINES)).toBe('1 of 3 allowed');
  });
});

describe('memberAccessHref', () => {
  it('points inside the workspace when one is named', () => {
    expect(memberAccessHref('o 1', 'u1', 'w1')).toBe('/organizations/o%201/workspaces/w1/members/u1/access');
  });

  it('points at the organization otherwise', () => {
    expect(memberAccessHref('o1', 'u/1')).toBe('/organizations/o1/members/u%2F1/access');
  });
});

describe('moduleHeading', () => {
  it('reads a module key as words', () => {
    expect(moduleHeading('app_hub')).toBe('App hub');
    expect(moduleHeading('platform-billing')).toBe('Platform billing');
  });
});
