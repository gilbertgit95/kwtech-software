'use client';

import { useStatusChannel, useStatusMessages } from '@kwtech/module-kit/react';
import { StatusBar, type StatusBarMessage } from '@kwtech/web-ui/react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Connects the module-kit status channel to the web-ui status bar.
 *
 * Two packages that do not know about each other, joined here — which is the
 * app's job, and the same arrangement as `resolvePrincipal` on the server and
 * `session-query` in the shell. `@kwtech/web-ui` declares the message shape
 * structurally rather than importing `@kwtech/module-kit`, so THIS FILE is
 * where a disagreement between them fails to compile: the assignment below is
 * the assertion.
 *
 * Kept separate from the bar itself because subscribing is what forces a client
 * component, and the bar should stay renderable from a literal array.
 */
export function StatusBarHost({ className }: { className?: string }) {
  const messages = useStatusMessages();
  const channel = useStatusChannel();
  const pathname = usePathname();

  /*
   * A page's message is about that page.
   *
   * Without this, an error from a form someone abandoned follows them across
   * the app, and the bar ends up describing somewhere they no longer are.
   * Sticky messages — connectivity — survive, because a server being down is
   * not a property of the current route.
   *
   * `pathname` is the TRIGGER, not an input: the effect reads nothing from it
   * and exists only to fire when it changes. Taking the rule's suggested fix
   * would make this run once and never clear anything again.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a change trigger, not a value the effect reads; removing it stops the clearing entirely.
  useEffect(() => {
    channel.clearTransient();
  }, [pathname, channel]);

  /*
   * The structural bridge, and the one line that would break if either side's
   * shape moved: module-kit's StatusMessage assigns to web-ui's
   * StatusBarMessage, or this does not compile.
   */
  const items: StatusBarMessage[] = messages.map((message) => ({
    id: message.id,
    level: message.level,
    text: message.text,
    action: message.action,
    // A condition cannot be dismissed; news can. See StatusBarMessage.
    dismissible: !message.sticky,
  }));

  return <StatusBar messages={items} onDismiss={(id) => channel.retract(id)} className={className} />;
}
