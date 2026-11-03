'use client';

import { zonedDayKey } from '@kwtech/module-kit';
import { downloadWorkbook, ExportDialog, ImportWizard, workbookFileName, writeWorkbook } from '@kwtech/web-ui/react';
import { planPosSetup, readPosSetup } from '../../domain/setup.js';
import type { TillState } from '../use-till.js';
import {
  SETUP_SHEET_NAMES,
  setupExport,
  setupMutationInput,
  setupPreview,
  setupStore,
  setupTemplate,
} from '../view/setup.js';

/** Which Excel dialog is open on the Items tab. */
export type SetupExcelDialog = 'none' | 'import' | 'export';

/**
 * The Items tab's Excel import and export (issue #35): `@kwtech/web-ui`'s
 * wizard and export dialog, driven by the POS's own sheets and rules.
 *
 * ⚠ THE STORE IS READ AFRESH for every preview and export, never taken from
 * the tab already on screen, which may be minutes old. The server plans once
 * more inside its transaction, so the preview is a promise the import keeps.
 */
export function SetupExcel({
  state,
  open,
  onClose,
  onImported,
}: {
  state: TillState;
  open: SetupExcelDialog;
  onClose: () => void;
  /** After an import: the Items tab reads the catalogue again. */
  onImported: () => void;
}) {
  const { client, scope } = state;
  // The workspace's day, not the browser's, in the file's name.
  const today = () => zonedDayKey(new Date(), state.timeZone);

  async function readStore() {
    const [catalogue, settings] = await Promise.all([client.catalogue(scope, true), client.settings(scope)]);
    return setupStore(catalogue, settings);
  }

  async function downloadTemplate() {
    downloadWorkbook(await writeWorkbook(setupTemplate()), workbookFileName('POS setup template', '', today()));
  }

  return (
    <>
      <ImportWizard
        open={open === 'import'}
        title="Import from Excel"
        description={
          <>
            Set up items, sizes, categories, order types and references from one Excel file: the template filled in, or
            a file exported from this or another store. You see what will change before anything does.
          </>
        }
        onTemplate={downloadTemplate}
        preview={async (reading, mode) => {
          const read = readPosSetup(reading.tabs);
          const store = await readStore();
          return setupPreview(read, planPosSetup(read.input, store, mode), store);
        }}
        apply={async (reading, mode, skipErrorRows) => {
          const read = readPosSetup(reading.tabs);
          const outcome = await client.importSetup(scope, setupMutationInput(read.input, mode, skipErrorRows));
          onImported();
          return outcome;
        }}
        onClose={onClose}
      />
      <ExportDialog
        open={open === 'export'}
        title="Export to Excel"
        sheets={SETUP_SHEET_NAMES}
        onExport={async (choice) => {
          const blob = await writeWorkbook(setupExport(await readStore(), choice));
          downloadWorkbook(blob, workbookFileName('POS setup', '', today()));
        }}
        onClose={onClose}
      />
    </>
  );
}
