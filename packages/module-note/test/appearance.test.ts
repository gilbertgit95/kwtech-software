import {
  DEFAULT_NOTE_SETTINGS,
  NOTE_APPEARANCE_LABELS,
  NOTE_COLORS,
  NOTE_FONTS,
  NOTE_LOOKS,
  normalizeNoteColor,
  normalizeNoteSettings,
  noteSettingsRefusal,
} from '../src/domain/appearance.js';

describe('appearance presets', () => {
  it('defaults to a notebook in the semi-handwritten font, on the theme’s paper', () => {
    expect(DEFAULT_NOTE_SETTINGS).toEqual({ look: 'notebook', font: 'hand', defaultColor: 'default' });
  });

  it('labels every preset it offers', () => {
    expect(Object.keys(NOTE_APPEARANCE_LABELS.look).sort()).toEqual([...NOTE_LOOKS].sort());
    expect(Object.keys(NOTE_APPEARANCE_LABELS.font).sort()).toEqual([...NOTE_FONTS].sort());
    expect(Object.keys(NOTE_APPEARANCE_LABELS.color).sort()).toEqual([...NOTE_COLORS].sort());
  });
});

describe('noteSettingsRefusal', () => {
  it('accepts a complete, valid set', () => {
    expect(noteSettingsRefusal({ look: 'sticky', font: 'serif', defaultColor: 'yellow' })).toBeNull();
  });

  it('names the first field that is not a choice', () => {
    expect(noteSettingsRefusal({ look: 'scroll', font: 'hand', defaultColor: 'default' })).toBe('look');
    expect(noteSettingsRefusal({ look: 'plain', font: 'comic', defaultColor: 'default' })).toBe('font');
    expect(noteSettingsRefusal({ look: 'plain', font: 'hand', defaultColor: '#ff0000' })).toBe('defaultColor');
  });

  it('⚠ refuses a missing field rather than resetting it to its default', () => {
    expect(noteSettingsRefusal({ look: 'plain', font: 'hand' })).toBe('defaultColor');
  });
});

describe('normalizeNoteSettings', () => {
  it('reads no row as the defaults', () => {
    expect(normalizeNoteSettings(null)).toEqual(DEFAULT_NOTE_SETTINGS);
  });

  it('reads a retired value as its default and keeps the rest', () => {
    expect(normalizeNoteSettings({ look: 'scroll', font: 'mono', defaultColor: 'blue' })).toEqual({
      look: 'notebook',
      font: 'mono',
      defaultColor: 'blue',
    });
  });
});

describe('normalizeNoteColor', () => {
  it('keeps a colour on offer and reads anything else as the default', () => {
    expect(normalizeNoteColor('pink')).toBe('pink');
    expect(normalizeNoteColor('#ff0000')).toBe('default');
    expect(normalizeNoteColor(null)).toBe('default');
  });
});
