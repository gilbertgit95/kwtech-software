import { chosenSettings, clampCopies, printersByComputer, settingChoices } from '../src/react/components/output-bar.js';
import type { StudioPrinterChoice } from '../src/react/printer-port.js';

const paperType = {
  key: 'mediaType',
  label: 'Paper type',
  options: [
    { id: 'plain', label: 'Plain paper' },
    { id: 'glossy', label: 'Glossy' },
  ],
  initial: 'plain',
};
const quality = { key: 'quality', label: 'Quality', options: [{ id: 'high', label: 'High' }], initial: null };
const printer = (over: Partial<StudioPrinterChoice> = {}): StudioPrinterChoice => ({
  id: 'p1',
  name: 'L5290',
  computer: 'Front desk PC',
  blocked: null,
  settings: [paperType, quality],
  ...over,
});

describe('a printer’s settings for one print', () => {
  it('starts on what the printer is set to, and on "as the printer is set" where that is not known', () => {
    expect(settingChoices(printer())).toEqual({ mediaType: 'plain', quality: '' });
  });

  it('keeps what was last chosen on this page', () => {
    expect(settingChoices(printer(), { mediaType: 'glossy', quality: 'high' })).toEqual({
      mediaType: 'glossy',
      quality: 'high',
    });
  });

  it('⚠ drops a remembered choice the printer no longer offers, rather than send it', () => {
    expect(settingChoices(printer(), { mediaType: 'canvas' })).toEqual({ mediaType: 'plain', quality: '' });
  });

  it('sends only what was chosen: one left as the printer is set is not sent at all', () => {
    expect(chosenSettings({ mediaType: 'glossy', quality: '' })).toEqual({ mediaType: 'glossy' });
    expect(chosenSettings({})).toEqual({});
  });

  it('has nothing to choose on a printer that offers nothing', () => {
    expect(settingChoices(printer({ settings: [] }))).toEqual({});
  });
});

describe('the printers menu', () => {
  it('lists the printers under the computer each is on, in the order they came', () => {
    const groups = printersByComputer([
      printer(),
      printer({ id: 'p2', name: 'L121' }),
      printer({ id: 'p3', name: 'Back', computer: 'Back room PC', blocked: 'That computer is offline.' }),
    ]);
    expect(groups.map((group) => [group.computer, group.blocked, group.printers.map((one) => one.name)])).toEqual([
      ['Front desk PC', false, ['L5290', 'L121']],
      ['Back room PC', true, ['Back']],
    ]);
  });
});

describe('the number of copies', () => {
  it('stays a whole number between 1 and 99, whatever is typed or stepped to', () => {
    expect([0, 1, 2.9, 99, 100, -4, Number.NaN].map(clampCopies)).toEqual([1, 1, 2, 99, 99, 1, 1]);
  });
});
