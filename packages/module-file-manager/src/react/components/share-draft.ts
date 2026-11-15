'use client';

import { useEffect, useRef, useState } from 'react';
import type { FileEntryView } from '../file-client.js';
import type { FilesState } from '../use-files.js';
import type { SharingDraft } from './sharing-fields.js';

export interface ShareDraft {
  sharing: SharingDraft;
  setSharing(sharing: SharingDraft): void;
  problem: string | null;
  /** True from Save until the list is read again: Cancel and closing wait for it. */
  saving: boolean;
  save(): Promise<void>;
}

/** Re-sharing one of your files: the same draft for the desktop's inline editor and a phone's sheet. */
export function useShareDraft(state: FilesState, file: FileEntryView, onDone: () => void): ShareDraft {
  const [sharing, setSharing] = useState<SharingDraft>({
    visibility: file.visibility,
    sharedWith: file.sharedWith.map((person) => person.userId),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /*
   * ⚠ A save finishing after its editor is gone must not close the NEXT one:
   * `onDone` would close whatever share editor is open by then.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (sharing.visibility === 'people' && sharing.sharedWith.length === 0) {
      setProblem('Choose at least one person to share it with, or keep it to yourself.');
      return;
    }
    setProblem(null);
    setSaving(true);
    const ok = await state.run(async (api) => {
      await api.setSharing(state.scope, file.id, sharing);
    });
    if (!mounted.current) return;
    setSaving(false);
    if (ok) onDone();
  }

  return { sharing, setSharing, problem, saving, save };
}
