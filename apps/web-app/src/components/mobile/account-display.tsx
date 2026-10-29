'use client';

import { applyDisplay, DEFAULT_SPACING, DEFAULT_TEXT_SIZE, isSpacing, isTextSize } from '@kwtech/web-ui';
import { useLayoutEffect } from 'react';

/**
 * The account's text size and spacing, applied on an IN-APP navigation of the
 * phone layout (issue #20's sizes, issue #22's layout).
 *
 * On a full page load the shell's inline script does this before the first
 * paint. On an in-app navigation that script is left out: React never runs a
 * script it renders on the client, and warns about every one it meets — which
 * the phone layout hit on each workspace switch once switching stopped
 * reloading the page. This does the same work after React commits, before the
 * browser paints. Usually a no-op, since the sizes rarely change mid-session.
 */
export function AccountDisplay({ display }: { display: { textSize: string; spacing: string } | null }) {
  const textSize = display?.textSize;
  const spacing = display?.spacing;

  useLayoutEffect(() => {
    applyDisplay({
      textSize: isTextSize(textSize) ? textSize : DEFAULT_TEXT_SIZE,
      spacing: isSpacing(spacing) ? spacing : DEFAULT_SPACING,
    });
  }, [textSize, spacing]);

  return null;
}
