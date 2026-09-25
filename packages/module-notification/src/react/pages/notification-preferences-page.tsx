'use client';

import { playTone, unlockTones } from '@kwtech/web-ui';
import { useEffect, useId, useState } from 'react';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationDeviceSettings,
  onNotificationSettings,
  readNotificationSettings,
  writeNotificationSettings,
} from '../notification-settings.js';
import { NOTIFICATION_TONES, notificationTone } from '../notification-tones.js';
import { NOTIFICATIONS_HREF } from '../routes.js';

type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

function currentPermission(): Permission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * `/notifications/preferences` — how notifications reach you ON THIS DEVICE:
 * pop-ups inside the app, a sound, and the browser's own pop-ups when every tab
 * is in the background.
 *
 * ⚠ Per device by construction (localStorage). Turning the sound off at a shared
 * desk means "here", not on your phone, and the page says so.
 */
export function NotificationPreferencesPage() {
  const [settings, setSettings] = useState<NotificationDeviceSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [permission, setPermission] = useState<Permission>('unsupported');
  const [saved, setSaved] = useState(false);
  const ids = useId();

  useEffect(() => {
    setSettings(readNotificationSettings());
    setPermission(currentPermission());
    return onNotificationSettings(setSettings);
  }, []);

  const save = (change: Partial<NotificationDeviceSettings>) => {
    const next = { ...settings, ...change };
    setSettings(next);
    writeNotificationSettings(next);
    setSaved(true);
  };

  /*
   * ⚠ The Play button is the audio UNLOCK, not a nicety. Browsers refuse to
   * start sound until the page has been interacted with, and a tone played into
   * a locked context is dropped silently — so pressing Play is what makes the
   * sound actually work afterwards.
   */
  const preview = async () => {
    await unlockTones();
    playTone(notificationTone(settings.tone));
  };

  /*
   * ⚠ The ONLY place this module asks for permission, and only from a click:
   * browsers penalise prompts nobody triggered, and an unprompted dialog is how
   * the answer becomes "Block" for good.
   */
  const enableSystemPopups = async () => {
    if (typeof Notification === 'undefined') return;
    const answer = await Notification.requestPermission();
    setPermission(answer);
    save({ systemPopups: answer === 'granted' });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <a href={NOTIFICATIONS_HREF} className="text-sm text-primary underline-offset-2 hover:underline">
          ← Back to notifications
        </a>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Notification settings</h1>
        <p className="text-sm text-muted-foreground">
          These apply to this browser on this device only. Every notification is still kept in your inbox.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-border p-4" aria-labelledby={`${ids}-popups`}>
        <h2 id={`${ids}-popups`} className="text-base font-semibold">
          Pop-ups in the app
        </h2>
        <Toggle
          id={`${ids}-toasts`}
          label="Show a pop-up when a notification arrives"
          hint="Alerts stay until you close them. Everything else disappears after a few seconds."
          checked={settings.toasts}
          onChange={(toasts) => save({ toasts })}
        />
      </section>

      <section className="space-y-4 rounded-lg border border-border p-4" aria-labelledby={`${ids}-sound`}>
        <h2 id={`${ids}-sound`} className="text-base font-semibold">
          Sound
        </h2>
        <Toggle
          id={`${ids}-sound-on`}
          label="Play a sound when a notification arrives"
          hint="Off by default. Press Play once so your browser allows the sound."
          checked={settings.sound}
          onChange={(sound) => save({ sound })}
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-tone`} className="text-sm font-medium">
              Sound
            </label>
            <select
              id={`${ids}-tone`}
              value={settings.tone}
              onChange={(event) => save({ tone: event.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {NOTIFICATION_TONES.map((tone) => (
                <option key={tone.id} value={tone.id}>
                  {tone.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void preview()}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Play
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4" aria-labelledby={`${ids}-system`}>
        <h2 id={`${ids}-system`} className="text-base font-semibold">
          When this app is in the background
        </h2>
        <p className="text-sm text-muted-foreground">
          Your browser can show a notification when every tab of this app is in the background. It shows the title and
          where it came from, never the full text. It needs this app to be open in a tab.
        </p>
        {permission === 'unsupported' ? (
          <p className="text-sm text-muted-foreground">This browser does not support notifications.</p>
        ) : permission === 'denied' ? (
          <p className="text-sm text-muted-foreground">
            Your browser is blocking notifications from this site. Allow them in the browser&apos;s site settings, then
            come back here.
          </p>
        ) : permission === 'granted' ? (
          <Toggle
            id={`${ids}-system-on`}
            label="Show browser notifications in the background"
            checked={settings.systemPopups}
            onChange={(systemPopups) => save({ systemPopups })}
          />
        ) : (
          <button
            type="button"
            onClick={() => void enableSystemPopups()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Turn on browser notifications
          </button>
        )}
      </section>

      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      ) : null}
    </div>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
        className="mt-0.5 size-4 accent-primary"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
