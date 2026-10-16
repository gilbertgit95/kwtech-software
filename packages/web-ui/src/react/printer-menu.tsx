'use client';

import { ChevronDown, Monitor, Printer } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from './confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
import { chosenSettings, type PrinterMenuPrinter, printersByComputer, settingChoices } from './printer-menu-rules.js';

/** The select's look, for the printer's settings and a caller's own `fields`, so the dialog reads as one. */
export const PRINTER_MENU_SELECT_CLASS =
  'h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface PrinterMenuProps<P extends PrinterMenuPrinter> {
  /** The printers to offer (`usePrinters(scope).printers`). Empty renders nothing at all. */
  printers: readonly P[];
  /**
   * The person chose a printer and pressed Print in its dialog. `settings`
   * holds only what was chosen; one left "as the printer is set" is not in it.
   */
  onPrint: (printer: P, settings: Record<string, string>) => void;
  /** The menu opened: read the printers again (`usePrinters(scope).refresh`). */
  onOpen?: () => void;
  disabled?: boolean;
  /** The trigger button's classes: the caller's own button look, so it sits with its neighbours. */
  triggerClassName?: string;
  /** Where the menu lines up with its trigger. */
  align?: 'start' | 'end';
  /** The dialog's first line: what will be printed, and where. Defaults to the computer's name. */
  describe?: (printer: P) => ReactNode;
  /** Fields of the caller's own, above the printer's settings: a paper size, a number of copies. */
  fields?: ReactNode;
}

/**
 * "Printers ▾": the workspace's printers by computer, and a dialog of the
 * chosen one's settings for this one print. The print studio's menu, shared
 * so every module that prints offers the same one.
 *
 * It knows printers only by shape, and sends nothing: `onPrint` does, with
 * `usePrinters` from `@kwtech/module-kit/react`.
 *
 * ⚠ THE CHOICES ARE REMEMBERED WHILE THIS IS MOUNTED, per printer: the second
 * sheet of glossy should not need the choice made again, and a choice kept
 * past the page would outlive the paper in the tray.
 */
export function PrinterMenu<P extends PrinterMenuPrinter>({
  printers,
  onPrint,
  onOpen,
  disabled = false,
  triggerClassName,
  align = 'start',
  describe,
  fields,
}: PrinterMenuProps<P>) {
  const [picked, setPicked] = useState<P | null>(null);
  const [kept, setKept] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>({});
  const choices = picked ? settingChoices(picked, kept[picked.id]) : {};
  if (printers.length === 0) return null;

  return (
    <>
      <DropdownMenu onOpenChange={(open) => (open ? onOpen?.() : undefined)}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={triggerClassName} disabled={disabled}>
            <Monitor aria-hidden="true" className="size-4" />
            Printers
            <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="max-w-xs">
          {printersByComputer(printers).map((group) => (
            <div key={group.computer}>
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {group.computer}
                {group.blocked ? ' — cannot print now' : ''}
              </DropdownMenuLabel>
              {group.printers.map((printer) => (
                <DropdownMenuItem
                  key={printer.id}
                  disabled={printer.blocked !== null}
                  title={printer.blocked ?? undefined}
                  onSelect={() => setPicked(printer)}
                >
                  <Printer aria-hidden="true" />
                  <span className="min-w-0 truncate">{printer.name}</span>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The printer's settings for this one print. Opened from the menu; Print here is what sends it. */}
      <ConfirmDialog
        open={picked !== null}
        danger={false}
        title={picked ? `Print on ${picked.name}` : 'Print'}
        confirmLabel="Print"
        description={
          picked ? (
            <div className="flex flex-col gap-3">
              <p>{describe ? describe(picked) : `On the computer “${picked.computer}”.`}</p>
              {fields}
              {picked.settings.map((setting) => (
                <label key={setting.key} className="flex flex-col gap-1 text-xs font-medium">
                  {setting.label}
                  <select
                    className={PRINTER_MENU_SELECT_CLASS}
                    value={choices[setting.key] ?? ''}
                    onChange={(event) =>
                      setKept((all) => ({
                        ...all,
                        [picked.id]: { ...settingChoices(picked, all[picked.id]), [setting.key]: event.target.value },
                      }))
                    }
                  >
                    {/* Offered only when what the printer is set to is not known: otherwise that is where it starts. */}
                    {setting.initial === null ? <option value="">As the printer is set</option> : null}
                    {setting.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.id === setting.initial ? ' (the printer’s own)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {picked.settings.length === 0 ? (
                <p>This printer offers no settings here. It prints as it is set on its computer.</p>
              ) : (
                <p className="text-xs">
                  These apply to this print only. Load that paper first: the printer cannot tell what is in its tray.
                </p>
              )}
            </div>
          ) : null
        }
        onCancel={() => setPicked(null)}
        onConfirm={() => {
          if (!picked) return;
          const settings = chosenSettings(choices);
          setPicked(null);
          onPrint(picked, settings);
        }}
      />
    </>
  );
}
