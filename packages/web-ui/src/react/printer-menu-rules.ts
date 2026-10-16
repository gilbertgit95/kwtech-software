/**
 * The printer menu's rules, pure and tested (`PrinterMenu`).
 *
 * ⚠ STRUCTURAL SHAPES. `web-ui` imports nothing of this repo, so these are
 * the printer as the menu reads it; `module-kit`'s `PrinterChoice` is written
 * to fit them, and every module that shows the menu is the compiler's check.
 */

/** One thing to choose before printing on a printer: a list, the printer's current pick, or null when not known. */
export interface PrinterMenuSetting {
  key: string;
  label: string;
  options: { id: string; label: string }[];
  initial: string | null;
}

/** One printer as the menu shows it. */
export interface PrinterMenuPrinter {
  id: string;
  name: string;
  /** The computer it is on: the menu's groups. */
  computer: string;
  /** Why it cannot be printed on right now (shown, and the row disabled), or null. */
  blocked: string | null;
  settings: PrinterMenuSetting[];
}

/** The printers under the computer each is on, in the order they came. A computer is blocked when all of its are. */
export function printersByComputer<P extends PrinterMenuPrinter>(
  printers: readonly P[],
): { computer: string; blocked: boolean; printers: P[] }[] {
  const groups = new Map<string, P[]>();
  for (const printer of printers) {
    groups.set(printer.computer, [...(groups.get(printer.computer) ?? []), printer]);
  }
  return [...groups].map(([computer, list]) => ({
    computer,
    blocked: list.every((printer) => printer.blocked !== null),
    printers: list,
  }));
}

/**
 * Where each of a printer's settings stands: what was last chosen, while the
 * printer still offers it, else what the printer is set to. '' is "leave it
 * as the printer is set".
 */
export function settingChoices(
  printer: Pick<PrinterMenuPrinter, 'settings'>,
  kept: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const setting of printer.settings) {
    const last = kept[setting.key];
    const offered = last !== undefined && (last === '' || setting.options.some((option) => option.id === last));
    choices[setting.key] = offered ? last : (setting.initial ?? '');
  }
  return choices;
}

/** The choices to send: the ones left "as the printer is set" are not sent at all. */
export function chosenSettings(choices: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(choices).filter(([, id]) => id !== ''));
}
