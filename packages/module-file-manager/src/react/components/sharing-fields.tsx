'use client';

import { useId } from 'react';
import type { FilePersonView } from '../file-client.js';

export interface SharingDraft {
  visibility: string;
  sharedWith: string[];
}

const CHOICES: readonly { value: string; label: string; hint: string }[] = [
  { value: 'private', label: 'Private', hint: 'Only you can see and download it.' },
  { value: 'workspace', label: 'The workspace', hint: 'Everybody here who can open Files.' },
  { value: 'people', label: 'Chosen people', hint: 'Only the people you pick, and you.' },
];

/**
 * Who a file is shared with: three choices, and the people for the third.
 * Used by the upload and by "Share…" on a file, so both ask the same question.
 */
export function SharingFields({
  draft,
  members,
  onChange,
  disabled,
}: {
  draft: SharingDraft;
  members: readonly FilePersonView[];
  onChange: (draft: SharingDraft) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const choices = members.length > 0 ? CHOICES : CHOICES.filter((choice) => choice.value !== 'people');

  function toggle(userId: string): void {
    const sharedWith = draft.sharedWith.includes(userId)
      ? draft.sharedWith.filter((id) => id !== userId)
      : [...draft.sharedWith, userId];
    onChange({ ...draft, sharedWith });
  }

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">Who can see it</legend>
      {choices.map((choice) => (
        <label key={choice.value} className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={draft.visibility === choice.value}
            onChange={() => onChange({ ...draft, visibility: choice.value })}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{choice.label}</span>
            <span className="block text-xs text-muted-foreground">{choice.hint}</span>
          </span>
        </label>
      ))}
      {members.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody else here can open Files yet, so a file can be private or the workspace’s.
        </p>
      ) : null}
      {draft.visibility === 'people' && members.length > 0 ? (
        <ul className="ml-6 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
          {members.map((member) => (
            <li key={member.userId}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.sharedWith.includes(member.userId)}
                  onChange={() => toggle(member.userId)}
                />
                {member.displayName}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
