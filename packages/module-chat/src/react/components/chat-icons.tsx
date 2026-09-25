'use client';

/**
 * The header tool's and floating window's icons: lucide's paths, inline, so
 * they match an app that uses lucide without this module taking an icon
 * dependency for five paths — the call module-auth makes for its settings
 * pages. All decorative: every control that shows one carries its own
 * accessible name.
 */
export type ChatIconName = 'message' | 'minimize' | 'restore' | 'expand' | 'close';

/*
 * A switch rather than a lookup object of JSX: an object literal would build
 * the elements when the module LOADS, which under the test compiler's classic
 * JSX transform needs `React` in scope — and this module is imported by the
 * descriptor, which every test that composes chat loads.
 */
function iconPaths(name: ChatIconName): React.ReactNode {
  switch (name) {
    case 'message':
      return <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />;
    case 'minimize':
      return <path d="M5 12h14" />;
    case 'restore':
      return <path d="m18 15-6-6-6 6" />;
    case 'expand':
      return (
        <>
          <path d="M15 3h6v6" />
          <path d="m21 3-7 7" />
          <path d="m3 21 7-7" />
          <path d="M9 21H3v-6" />
        </>
      );
    case 'close':
      return (
        <>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </>
      );
  }
}

export function ChatIcon({ name, className = 'size-4' }: { name: ChatIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths(name)}
    </svg>
  );
}
