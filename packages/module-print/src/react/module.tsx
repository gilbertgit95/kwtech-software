import type { AppProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { PRINT_FEATURE, PRINT_FEATURE_REGISTRY, PRINT_LIMIT_REGISTRY } from '../feature-keys.js';
import { PrintApp } from './print-app.js';

/**
 * The printing side's web descriptor — its app, its keys and its cap, as data
 * the web app composes:
 *
 *   const FEATURE_MODULES = [..., printWebModule()];
 *
 * A function, as `queueWebModule` is, so options can arrive without changing
 * the call site.
 *
 * ⚠ NO ROUTES and NO DRAWER ENTRY. A sub-app is reached from the workspace's
 * Apps page.
 */
export interface PrintWebModuleOptions {
  /**
   * The server's socket address as a computer OUTSIDE reaches it
   * (`wss://app.example.com/api/v1/graphql`). The page's setup guide shows it,
   * and the API's address worked out from it, as the two lines to put in the
   * print agent's settings file.
   *
   * Left out, the guide shows the two lines blank, to be asked for. ⚠ It never
   * guesses: an address typed into a shop's computer is where that computer
   * sends its pairing code.
   */
  wsUrl?: string | undefined;
}

export function printWebModule(options: PrintWebModuleOptions = {}): WebModuleDescriptor {
  const wsUrl = options.wsUrl ?? null;
  // A string, so it crosses from the server, where a sub-app's element is made, to the client component.
  function PrintAppRoute(props: AppProps) {
    return <PrintApp {...props} wsUrl={wsUrl} />;
  }
  return {
    key: 'print',
    features: PRINT_FEATURE_REGISTRY,
    limits: PRINT_LIMIT_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts of the Apps page. Never rename it.
        key: 'print',
        label: 'Printers',
        description: 'The computers paired to print for this workspace, and their printers.',
        icon: 'printer',
        feature: PRINT_FEATURE.read,
        // Right after the print studio (70), which is what will print through it.
        order: 75,
        component: PrintAppRoute,
      },
    ],
  };
}
