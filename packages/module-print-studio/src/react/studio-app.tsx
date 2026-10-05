'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useHoldsFeature, useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { History, Keyboard, LayoutTemplate, type LucideIcon, Printer, Ruler } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { effectiveStudioKeymap, type StudioKeymap } from '../domain/keymap.js';
import { STUDIO_FEATURE } from '../feature-keys.js';
import { CalibrationSection } from './components/calibration-section.js';
import { HistorySection } from './components/history-section.js';
import { SectionBar } from './components/layout.js';
import { type ChosenLayout, LayoutsSection } from './components/layouts-section.js';
import { PrintSection } from './components/print-section.js';
import { ShortcutsSection } from './components/shortcuts-section.js';
import { createStudioClient, type StudioClient } from './studio-client.js';
import type { StudioAppState } from './studio-state.js';
import { useStudioData } from './use-studio-data.js';

type Section = 'print' | 'layouts' | 'history' | 'calibration' | 'shortcuts';

/**
 * The print studio as a SUB-APP on the workspace's Apps page
 * (docs/PRINT-STUDIO-PLAN.md).
 *
 * - Laid out by the BOX's width, never the viewport's (`@container`), because a
 *   grid cell is narrow on a wide screen.
 * - Which section is open, and which layout is being printed with, is this
 *   component's own state, never a URL: a link would leave the Apps page and
 *   close every other app running on it.
 * - ⚠ PRINT STAYS MOUNTED while another section is open. It holds the photos
 *   somebody chose, in memory and nowhere else; unmounting it to look at the
 *   history would throw them away.
 * - Controls a person may not use are hidden with `useHoldsFeature`. Hiding is
 *   cosmetic — the API refuses too.
 * - ⚠ Every day and time in the history is the WORKSPACE's
 *   (`useWorkspaceTimeZone`).
 */
export function StudioApp({ organizationId, workspaceId, client }: AppProps & { client?: StudioClient }) {
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const api = useMemo(() => client ?? createStudioClient(), [client]);
  const timeZone = useWorkspaceTimeZone();
  const write = useHoldsFeature(STUDIO_FEATURE.write);
  const manageAll = useHoldsFeature(STUDIO_FEATURE.manageAll);
  const manageSettings = useHoldsFeature(STUDIO_FEATURE.manageSettings);
  const [section, setSection] = useState<Section>('print');
  const [layout, setLayout] = useState<ChosenLayout | null>(null);

  /*
   * The workspace's shortcut keys, read once here and handed to every screen.
   * Until they arrive — and when they cannot be read — the defaults apply:
   * keys that work are better than keys that wait on a request.
   */
  const loadSettings = useCallback(() => api.settings(scope), [api, scope]);
  const settings = useStudioData(loadSettings, 'Could not load the shortcut keys.');
  const keymap = useMemo(() => keymapFrom(settings.data?.keymap), [settings.data?.keymap]);

  const state: StudioAppState = useMemo(
    () => ({ scope, client: api, timeZone, keymap, can: { write, manageAll, manageSettings } }),
    [scope, api, timeZone, keymap, write, manageAll, manageSettings],
  );

  const sections: { key: Section; label: string; icon: LucideIcon }[] = [
    { key: 'print', label: 'Print', icon: Printer },
    { key: 'layouts', label: 'Layouts', icon: LayoutTemplate },
    { key: 'history', label: 'History', icon: History },
    { key: 'calibration', label: 'Calibration', icon: Ruler },
    { key: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  ];

  return (
    <div className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground">
      <SectionBar label="Print studio" sections={sections} current={section} onChange={setSection}>
        Photos and results stay on this computer.
      </SectionBar>
      {/* Hidden rather than unmounted: see the note on the photos above. */}
      <div className={section === 'print' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <PrintSection
          state={state}
          layout={layout}
          onLayout={setLayout}
          onBrowseLayouts={() => setSection('layouts')}
        />
      </div>
      {section === 'layouts' ? (
        <LayoutsSection
          state={state}
          onUse={(chosen) => {
            setLayout(chosen);
            setSection('print');
          }}
        />
      ) : null}
      {section === 'history' ? <HistorySection state={state} /> : null}
      {section === 'calibration' ? <CalibrationSection state={state} /> : null}
      {section === 'shortcuts' ? <ShortcutsSection state={state} onSaved={settings.reload} /> : null}
    </div>
  );
}

/** The keymap the API sent, as JSON text, laid over the defaults. Anything unreadable is the defaults. */
function keymapFrom(text: string | undefined): StudioKeymap {
  if (!text) return effectiveStudioKeymap(null);
  try {
    return effectiveStudioKeymap(JSON.parse(text));
  } catch {
    // Not JSON: the server never sends that, and the defaults are the safe reading of it.
    return effectiveStudioKeymap(null);
  }
}
