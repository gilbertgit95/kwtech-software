'use client';

import { useEffect, useState } from 'react';
import { MAX_NICKNAME_CODE_POINTS } from '../../domain/nicknames.js';
import type { QueueConsoleState } from '../use-queue-console.js';
import { buttonClass, inputClass, Section } from './ui.js';

/**
 * "Shown on public displays as…" — the person's own nickname, set by nobody else.
 *
 * ⚠ The description says what happens with NO nickname, because that is the
 * rule people least expect: no nickname means no name on a TV, never the
 * account name as a fallback.
 */
export function NicknameField({ state }: { state: QueueConsoleState }) {
  const { view, busy, run, client, scope } = state;
  const saved = view?.myNickname ?? '';
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);

  if (!view) return null;

  return (
    <Section
      title="Shown on public displays as…"
      description={
        view.settings.showStaffNames
          ? 'This workspace shows staff nicknames on its displays, beside the numbers you call. Leave it empty and no name appears.'
          : 'Displays here do not show names right now. If they start to, this is the only name that will appear — never your account name.'
      }
    >
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => (value.trim() ? client.setMyNickname(scope, value) : client.clearMyNickname(scope)));
        }}
      >
        <input
          className={`${inputClass} w-64`}
          value={value}
          maxLength={MAX_NICKNAME_CODE_POINTS * 2}
          placeholder="No name on displays"
          aria-label="Nickname shown on public displays"
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className={buttonClass('secondary')} disabled={busy || value === saved}>
          Save
        </button>
        {saved ? (
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={busy}
            onClick={() => run(() => client.clearMyNickname(scope))}
          >
            Remove
          </button>
        ) : null}
      </form>
    </Section>
  );
}
