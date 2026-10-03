'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useHoldsFeature } from '@kwtech/module-kit/react';
import { HandCoins, LayoutDashboard, type LucideIcon, ReceiptText, Settings, Users } from 'lucide-react';
import { useCallback, useState } from 'react';
import { BOOKS_FEATURE } from '../feature-keys.js';
import type { BooksClient } from './books-client.js';
import { PosSalesDialog } from './components/dialogs.js';
import { InvestorsSection } from './components/investors-section.js';
import { Alert, Empty, SectionBar } from './components/layout.js';
import { LoansSection } from './components/loans-section.js';
import { MoneySection } from './components/money-section.js';
import { OverviewSection } from './components/overview-section.js';
import { SettingsSection } from './components/settings-section.js';
import { useBooksContext, useBooksData } from './use-books.js';

type Section = 'overview' | 'money' | 'investors' | 'loans' | 'settings';

/**
 * The books as a SUB-APP on the workspace's Apps page (docs/BOOKKEEPING-PLAN.md).
 *
 * - Laid out by the BOX's width, never the viewport's (`@container`), because a
 *   grid cell is narrow on a wide screen.
 * - Which section is open is this component's own state, never a URL: a link
 *   would leave the Apps page and close every other app running on it.
 * - Controls show only to somebody holding their key; hiding is cosmetic — the
 *   API refuses too. Settings is the owners' alone.
 * - The overview is read ONCE here and handed to every section, so the figures
 *   on one tab never disagree with another's; any change in the books, by
 *   anybody, reloads it (`booksEvents`).
 */
export function BooksApp({ organizationId, workspaceId, client }: AppProps & { client?: BooksClient }) {
  const books = useBooksContext(organizationId, workspaceId, client ? { client } : {});
  const canRecord = useHoldsFeature(BOOKS_FEATURE.record);
  const canManage = useHoldsFeature(BOOKS_FEATURE.manageInvestors);
  const load = useCallback(() => books.client.overview(books.scope), [books.client, books.scope]);
  const overview = useBooksData(books.scope, load, 'Could not load the books.');
  const [section, setSection] = useState<Section>('overview');
  const [bringingIn, setBringingIn] = useState(false);
  const reload = () => void overview.reload();

  const sections: { key: Section; label: string; icon: LucideIcon }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'money', label: 'Money', icon: ReceiptText },
    { key: 'investors', label: 'Investors', icon: Users },
    { key: 'loans', label: 'Loans', icon: HandCoins },
    ...(canManage ? [{ key: 'settings' as const, label: 'Settings', icon: Settings }] : []),
  ];
  const view = overview.data;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handler only catches Esc bubbling up from a section, to return to the overview; every control inside has its own keys.
    <div
      className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || section === 'overview' || event.defaultPrevented) return;
        // ⚠ Esc inside a dialog closes the dialog, never the section under it.
        if (event.target instanceof Element && event.target.closest('dialog')) return;
        setSection('overview');
      }}
    >
      <SectionBar label="Books" sections={sections} current={section} onChange={setSection}>
        {!books.live ? 'Not live — other people’s entries show when you reload.' : null}
      </SectionBar>

      <Alert message={overview.error} />
      {view === null ? (
        <Empty>{overview.loading ? 'Loading the books…' : 'The books could not be opened.'}</Empty>
      ) : (
        <>
          {section === 'overview' ? (
            <OverviewSection
              overview={view}
              canRecord={canRecord}
              canManage={canManage}
              onBringInSales={() => setBringingIn(true)}
              onOpenSettings={() => setSection('settings')}
            />
          ) : null}
          {section === 'money' ? (
            <MoneySection
              books={books}
              overview={view}
              canRecord={canRecord}
              canManage={canManage}
              onBringInSales={() => setBringingIn(true)}
              onChanged={reload}
            />
          ) : null}
          {section === 'investors' ? (
            <InvestorsSection books={books} overview={view} canManage={canManage} onChanged={reload} />
          ) : null}
          {section === 'loans' ? (
            <LoansSection books={books} overview={view} canRecord={canRecord} onChanged={reload} />
          ) : null}
          {section === 'settings' && canManage ? (
            <SettingsSection books={books} overview={view} onChanged={reload} />
          ) : null}
          <PosSalesDialog
            open={bringingIn}
            books={books}
            overview={view}
            onClose={() => setBringingIn(false)}
            onDone={reload}
          />
        </>
      )}
    </div>
  );
}
