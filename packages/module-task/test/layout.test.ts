import { taskPanelLayout } from '../src/react/view/layout.js';

describe('taskPanelLayout', () => {
  it('shows no panel and no bar while no task is open', () => {
    expect(taskPanelLayout({ taskOpen: false, beside: true, collapsed: false })).toBe('none');
    expect(taskPanelLayout({ taskOpen: false, beside: false, collapsed: true })).toBe('none');
  });

  it('sits beside the board when wide, and over it when narrow', () => {
    expect(taskPanelLayout({ taskOpen: true, beside: true, collapsed: false })).toBe('beside');
    expect(taskPanelLayout({ taskOpen: true, beside: false, collapsed: false })).toBe('overlay');
  });

  it('collapses to the bar at any width, keeping the task open', () => {
    expect(taskPanelLayout({ taskOpen: true, beside: true, collapsed: true })).toBe('hidden');
    expect(taskPanelLayout({ taskOpen: true, beside: false, collapsed: true })).toBe('hidden');
  });
});
