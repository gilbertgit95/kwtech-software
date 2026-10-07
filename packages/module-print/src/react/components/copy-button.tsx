'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { buttonClass } from '../ui.js';

/**
 * Copy a line to the clipboard, and say it was done for a moment.
 *
 * ⚠ The clipboard is not storage this page keeps: it is the person's own, and
 * a one-time code that works for ten minutes is theirs to carry across a room.
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // No clipboard here (an insecure page, a refused permission): the text is selectable, and stays so.
      setCopied(false);
    }
  }

  return (
    <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => void copy()}>
      {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}
