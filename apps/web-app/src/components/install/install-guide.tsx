'use client';

import { QrCode } from '@kwtech/web-ui/react';
import { Download, MoreVertical, Share, SquarePlus } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { detectInstallPlatform, type InstallPlatform, isRunningInstalled } from './install-platform';

/**
 * Chrome's install prompt, which the DOM typings do not declare yet. The event
 * arrives once the browser has decided the site is installable (manifest,
 * icons, HTTPS); calling `prompt()` shows the same dialog as the browser menu's
 * "Install app", which is what lets this page offer one button instead of
 * directions to a menu.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * The `/install` page's body: one set of steps for the device in hand, with
 * the others folded away beneath it.
 *
 * Everything here waits for the browser. The platform, whether the app is
 * already installed and the install prompt are all unknowable on the server,
 * and guessing there would render one set of steps and swap it for another on
 * hydration.
 */
export function InstallGuide({ appName }: { appName: string }) {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [installed, setInstalled] = useState(false);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [outcome, setOutcome] = useState<'accepted' | 'dismissed' | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    setPlatform(detectInstallPlatform(window.navigator));
    setInstalled(isRunningInstalled());
    setLink(`${window.location.origin}/install`);

    /*
     * `preventDefault` keeps Chrome's own mini-infobar from appearing on top
     * of a page whose whole subject is that same choice. The event is kept so
     * the button below can show the dialog when the person asks.
     */
    function onPrompt(event: Event) {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setPrompt(null);
      setOutcome('accepted');
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    // A prompt can be shown once. Dismissed, the browser fires a fresh event
    // later, and until then the manual steps below still work.
    setPrompt(null);
    setOutcome(choice.outcome);
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-24 sm:pt-28">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Install {appName} on your phone</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        No app store needed. It installs from your phone's browser, opens full screen from its own icon, and updates
        itself whenever there is a new version.
      </p>

      {installed ? (
        <section className="mt-6 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-card-foreground">You are using the installed app</h2>
          <p className="mt-1 text-sm text-muted-foreground">There is nothing more to do here.</p>
          <a href="/" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
            Go to the dashboard
          </a>
        </section>
      ) : null}

      {/* Nothing until the browser has answered: see the note above the component. */}
      {platform !== null && !installed ? (
        <>
          {outcome === 'accepted' ? (
            <p role="status" className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground">
              Installed. Open {appName} from its icon on your home screen or in your apps list.
            </p>
          ) : null}

          {prompt ? (
            <button
              type="button"
              onClick={() => void install()}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Download aria-hidden className="size-4" />
              Install app
            </button>
          ) : null}

          <PlatformSteps platform={platform} appName={appName} link={link} />

          <details className="mt-6 rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Using a different device?</summary>
            {OTHERS[platform].map((other) => (
              <PlatformSteps key={other} platform={other} appName={appName} link={link} />
            ))}
          </details>
        </>
      ) : null}

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium text-foreground">After installing</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Open {appName} from its icon. A link opens it in the browser instead.</li>
          <li>
            Sign in once inside the app. On an iPhone the installed app keeps its own sign-in, apart from Safari's.
          </li>
          <li>Your account, roles and data are the same as on the website.</li>
          <li>To remove it, press and hold the icon, then choose Remove or Uninstall.</li>
        </ul>
      </section>
    </div>
  );
}

/** The two sets of steps not shown first, in the order a reader is likely to need them. */
const OTHERS: Record<InstallPlatform, readonly InstallPlatform[]> = {
  ios: ['android', 'desktop'],
  android: ['ios', 'desktop'],
  desktop: ['ios', 'android'],
};

function PlatformSteps({
  platform,
  appName,
  link,
}: {
  platform: InstallPlatform;
  appName: string;
  link: string | null;
}) {
  switch (platform) {
    case 'ios':
      return (
        <Steps title="iPhone and iPad">
          <li>
            Open this page in <strong>Safari</strong>. On iOS 16.4 and later, Chrome and Edge work too.
          </li>
          <li>
            Tap <strong>Share</strong> <Share aria-hidden className="inline size-4 align-text-bottom" /> — at the bottom
            of the screen on an iPhone, at the top on an iPad.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>{' '}
            <SquarePlus aria-hidden className="inline size-4 align-text-bottom" />. Not in the list? Tap{' '}
            <strong>Edit Actions…</strong> at the bottom and add it.
          </li>
          <li>
            Keep the name <strong>{appName}</strong> and tap <strong>Add</strong>.
          </li>
        </Steps>
      );
    case 'android':
      return (
        <Steps title="Android">
          <li>
            Open this page in <strong>Chrome</strong>.
          </li>
          <li>
            Tap <strong>Install app</strong> when it is offered. If it is not, tap the menu{' '}
            <MoreVertical aria-hidden className="inline size-4 align-text-bottom" /> at the top right, then{' '}
            <strong>Install app</strong> or <strong>Add to Home screen</strong>.
          </li>
          <li>
            Tap <strong>Install</strong> to confirm. {appName} appears on your home screen and in your apps list.
          </li>
        </Steps>
      );
    case 'desktop':
      return (
        <Steps title="On a computer">
          <li>
            Scan this code with your phone's camera to open this page there, then follow the steps for your phone.
            {/* Inside the step it belongs to: a list item of its own would take a number. */}
            {link ? (
              <div className="mt-3">
                <QrCode value={link} size={160} label={`QR code for ${link}`} />
              </div>
            ) : null}
          </li>
          <li>
            Chrome and Edge can install it on this computer too: use the install icon at the right of the address bar.
          </li>
        </Steps>
      );
  }
}

function Steps({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">{children}</ol>
    </section>
  );
}
