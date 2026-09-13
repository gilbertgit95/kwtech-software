'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useState } from 'react';
import {
  CHAT_TONE_CHOICES,
  type ChatSettings,
  DEFAULT_CHAT_SETTINGS,
  readChatSettings,
  writeChatSettings,
} from '../chat-settings.js';
import { type ChatToneId, playChatTone, unlockChatTones } from '../chat-tone.js';
import { ChatSubPage } from '../components/chat-sub-page.js';

/**
 * `/chat/preferences` — how chat tells you, on THIS device.
 *
 * ## ⚠ Why it is not `/chat/settings`
 *
 * Because `/chat/:conversationId/settings` already exists and means something
 * else entirely: what a GROUP is called and who runs it. Two pages a segment
 * apart, both called settings, one about a conversation and one about a
 * browser, is a naming collision people resolve by clicking the wrong one.
 *
 * ## ⚠ Per DEVICE, and the page says so
 *
 * Nothing here is stored on the server. The scope of "mute chat" is honestly
 * this machine — somebody muting at a shared desk means here, not on their
 * phone — and a page that quietly synced would silence the device they
 * actually need to hear. Saying it on screen is the difference between a
 * deliberate design and a bug people report.
 *
 * ## ⚠ THE PREVIEW BUTTON IS THE UNLOCK
 *
 * Browsers refuse to start audio until the page has been interacted with, and
 * a tone played into a context that was never unlocked is dropped SILENTLY —
 * no error, no console entry worth reading, just a chat that never makes a
 * sound. Pressing preview is a real user gesture, so it is what switches the
 * feature on for real. Every control here calls `unlockChatTones` for the same
 * reason, so somebody who only flips the toggle is unlocked too.
 */
export function ChatPreferencesPage() {
  /*
   * ⚠ Starts at the DEFAULT and loads in an effect, rather than reading
   * localStorage during render. This component is rendered on the server as
   * well, where there is no `window` — reading during render gives a first
   * paint built from the default and a second from storage, and React calls
   * that a hydration mismatch.
   */
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(readChatSettings());
    setLoaded(true);
  }, []);

  /** Both halves, always together: state for this tab, storage for the next. */
  const update = (next: ChatSettings) => {
    // ⚠ In the handler, never an effect — an effect runs outside the gesture
    // and the browser refuses the unlock again.
    unlockChatTones();
    setSettings(next);
    writeChatSettings(next);
  };

  const preview = (tone: ChatToneId) => {
    unlockChatTones();
    playChatTone(tone);
  };

  return (
    <ChatSubPage
      title="Chat preferences"
      description="How chat tells you a message has arrived. These are stored in this browser, on this device — muting here does not mute your phone, and signing in elsewhere starts from the default."
    >
      <section className="rounded-md border border-border p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.enabled}
            disabled={!loaded}
            onChange={(event) => update({ ...settings, enabled: event.target.checked })}
          />
          <span>
            <span className="text-sm font-medium">Play a sound when a message arrives</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Not for your own messages, and not while you are looking at the conversation it arrived in. Your
              availability still wins: on Do not disturb, chat stays silent.
            </span>
          </span>
        </label>
      </section>

      <section className={cn('mt-4 rounded-md border border-border p-4', !settings.enabled && 'opacity-60')}>
        <h2 className="text-sm font-medium">Sound</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {/*
            ⚠ Not decoration. Until something is previewed the browser may
            refuse to play anything at all, and it refuses silently — so the
            page asks for the gesture rather than waiting for a message to
            arrive and fail.
          */}
          Press Play to hear one. The first sound you play here is also what allows chat to make a sound later —
          browsers block audio until you have interacted with the page.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {CHAT_TONE_CHOICES.map((choice) => (
            <div key={choice.value} className="flex items-center gap-3">
              <label className="flex flex-1 items-center gap-3">
                <input
                  type="radio"
                  name="chat-tone"
                  value={choice.value}
                  checked={settings.tone === choice.value}
                  disabled={!loaded || !settings.enabled}
                  /*
                   * ⚠ CHOOSING ONE PLAYS IT. Every OS sound picker does this,
                   * and with ten options the alternative is picking blind and
                   * then hunting for the Play button to find out what you
                   * chose. It doubles as the unlock, so somebody who never
                   * presses Play is still unlocked by choosing.
                   */
                  onChange={() => {
                    update({ ...settings, tone: choice.value });
                    playChatTone(choice.value);
                  }}
                />
                <span className="text-sm">{choice.label}</span>
              </label>
              {/*
                ⚠ PLAY STAYS LIVE even with sound switched off, which is why
                it is not disabled alongside the radio. Auditioning is how
                somebody decides whether to turn it on at all, and it is also
                the gesture that unlocks playback — disabling it would mean the
                only way to unlock audio is to first enable a sound you have
                never heard.
              */}
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
                onClick={() => preview(choice.value)}
              >
                Play
              </button>
            </div>
          ))}
        </div>

        {/*
          ⚠ NO VOLUME SLIDER, deliberately. The operating system has one, it is
          the one people already know how to reach, and a second control that
          only affects this tab is a worse answer to the same question.
        */}
      </section>
    </ChatSubPage>
  );
}
