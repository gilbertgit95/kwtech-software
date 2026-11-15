'use client';

import { cn } from '@kwtech/web-ui/react';
import { Check, Lock, UserRoundCheck, Users } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import type { FilePersonView } from '../file-client.js';

export interface SharingDraft {
  visibility: string;
  sharedWith: string[];
}

const CHOICES: readonly { value: string; label: string; hint: string; icon: ReactNode }[] = [
  { value: 'private', label: 'Only me', hint: 'Nobody else can see it.', icon: <Lock className="size-4" /> },
  {
    value: 'workspace',
    label: 'Everyone here',
    hint: 'Everybody in this workspace who can open Files.',
    icon: <Users className="size-4" />,
  },
  {
    value: 'people',
    label: 'Chosen people',
    hint: 'Only the people you pick.',
    icon: <UserRoundCheck className="size-4" />,
  },
];

/** "AN" for Ana Navarro: the chip's avatar. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * Who a file is shared with: three choices as cards, and the people for the
 * third as chips. Used by the upload and by Share on a file, on the desktop
 * and in a phone's sheet, so all four ask the same question the same way.
 *
 * Real radio buttons and toggle buttons underneath, so a keyboard and a
 * screen reader get the same choice a thumb does.
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
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Who can see it</legend>
      <div className="grid gap-2 @lg:grid-cols-3">
        {choices.map((choice) => {
          const checked = draft.visibility === choice.value;
          return (
            <label
              key={choice.value}
              className={cn(
                'relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                checked ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-accent/60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={checked}
                onChange={() => onChange({ ...draft, visibility: choice.value })}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg',
                  checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {choice.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{choice.label}</span>
                <span className="block text-xs text-muted-foreground">{choice.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      {members.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody else here can open Files yet, so a file is yours alone or everyone’s here.
        </p>
      ) : null}
      {draft.visibility === 'people' && members.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            {draft.sharedWith.length === 0
              ? 'Choose the people to share it with.'
              : `${draft.sharedWith.length} ${draft.sharedWith.length === 1 ? 'person' : 'people'} chosen.`}
          </p>
          <ul className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
            {members.map((member) => {
              const chosen = draft.sharedWith.includes(member.userId);
              return (
                <li key={member.userId}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => toggle(member.userId)}
                    className={cn(
                      'inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      chosen
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-foreground hover:bg-accent',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold',
                        chosen ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {chosen ? <Check className="size-3.5" /> : initialsOf(member.displayName)}
                    </span>
                    <span className="truncate">{member.displayName}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </fieldset>
  );
}
