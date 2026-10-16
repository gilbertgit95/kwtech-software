import {
  chosenSettings,
  type PrinterMenuPrinter,
  printersByComputer,
  settingChoices,
} from '../src/react/printer-menu-rules.js';

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
const printer = (over: Partial<PrinterMenuPrinter> = {}): PrinterMenuPrinter => ({
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

  it('keeps what was last chosen while the menu is mounted', () => {
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
