import {
  DISPLAY_STORAGE_KEY,
  displayApplyScript,
  displayPreloadScript,
  isSpacing,
  isTextSize,
  SPACINGS,
  TEXT_SIZES,
} from '../src/display.js';

/** Runs a generated script against a stand-in `<html>` and storage, as a browser would. */
function run(script: string, stored: string | null = null) {
  const attributes = new Map<string, string>();
  const storage = new Map<string, string>(stored === null ? [] : [[DISPLAY_STORAGE_KEY, stored]]);
  const document = { documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) } };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  new Function('document', 'localStorage', script)(document, localStorage);
  return { attributes: Object.fromEntries(attributes), stored: storage.get(DISPLAY_STORAGE_KEY) ?? null };
}

describe('display sizes', () => {
  it('knows its own steps, and nothing else', () => {
    for (const size of TEXT_SIZES) expect(isTextSize(size)).toBe(true);
    for (const spacing of SPACINGS) expect(isSpacing(spacing)).toBe(true);
    expect(isTextSize('huge')).toBe(false);
    expect(isSpacing(null)).toBe(false);
  });

  it('applies the sizes this browser stored before the first paint', () => {
    expect(run(displayPreloadScript(), 'larger roomy').attributes).toEqual({
      'data-text-size': 'larger',
      'data-spacing': 'roomy',
    });
  });

  it('⚠ ignores a stored value it does not know, rather than setting a size no rule matches', () => {
    expect(run(displayPreloadScript(), 'enormous roomy').attributes).toEqual({ 'data-spacing': 'roomy' });
    expect(run(displayPreloadScript()).attributes).toEqual({});
  });

  it("applies the account's sizes and makes them this browser's copy", () => {
    expect(run(displayApplyScript({ textSize: 'largest', spacing: 'compact' }), 'small roomy')).toEqual({
      attributes: { 'data-text-size': 'largest', 'data-spacing': 'compact' },
      stored: 'largest compact',
    });
  });

  it('⚠ never writes a value from the API into the script unchecked: anything unknown is the default', () => {
    const script = displayApplyScript({ textSize: '");alert(1);("', spacing: 'roomy' });
    expect(script).not.toContain('alert');
    expect(run(script).attributes).toEqual({ 'data-text-size': 'normal', 'data-spacing': 'roomy' });
    expect(run(displayApplyScript(null)).attributes).toEqual({
      'data-text-size': 'normal',
      'data-spacing': 'comfortable',
    });
  });
});
