'use client';

import { useState } from 'react';
import type { FileEntryView } from '../file-client.js';
import type { FilesState } from '../use-files.js';
import type { SharingDraft } from './sharing-fields.js';

export interface ShareDraft {
  sharing: SharingDraft;
  setSharing(sharing: SharingDraft): void;
  problem: string | null;
  save(): Promise<void>;
}

/** Re-sharing one of your files: the same draft for the desktop's inline editor and a phone's sheet. */
export function useShareDraft(state: FilesState, file: FileEntryView, onDone: () => void): ShareDraft {
  const [sharing, setSharing] = useState<SharingDraft>({
    visibility: file.visibility,
    sharedWith: file.sharedWith.map((person) => person.userId),
  });
  const [problem, setProblem] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (sharing.visibility === 'people' && sharing.sharedWith.length === 0) {
      setProblem('Choose at least one person to share it with, or keep it to yourself.');
      return;
    }
    setProblem(null);
    const ok = await state.run(async (api) => {
      await api.setSharing(state.scope, file.id, sharing);
    });
    if (ok) onDone();
  }

  return { sharing, setSharing, problem, save };
}
