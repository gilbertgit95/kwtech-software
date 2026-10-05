'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useHoldsFeature, useRealtime, useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { CalendarDays, ClipboardList, Inbox, type LucideIcon, Settings, UsersRound } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { BOOKING_FEATURE } from '../feature-keys.js';
import { type BookingClient, createBookingClient } from './booking-client.js';
import type { BookingAppState } from './booking-state.js';
import { DaySection } from './components/day-section.js';
import { SectionBar } from './components/layout.js';
import { RequestsSection } from './components/requests-section.js';
import { ResourcesSection } from './components/resources-section.js';
import { ServicesSection } from './components/services-section.js';
import { SettingsSection } from './components/settings-section.js';
import { useBookingData } from './use-booking-data.js';

type Section = 'day' | 'requests' | 'services' | 'resources' | 'settings';

/**
 * Booking as a SUB-APP on the workspace's Apps page (docs/BOOKING-PLAN.md).
 *
 * - Laid out by the BOX's width, never the viewport's (`@container`), because a
 *   grid cell is narrow on a wide screen.
 * - Which section and which booking are open is this component's own state,
 *   never a URL: a link would leave the Apps page and close every other app
 *   running on it.
 * - A section shows only to somebody holding its key: the front desk sees the
 *   Day and — once the public page takes them — Requests, with a count of
 *   those waiting; a manager also sees Services, Resources and Settings. Hiding is
 *   cosmetic — the API refuses too.
 * - ⚠ Every day and time is the WORKSPACE's (`useWorkspaceTimeZone`), so two
 *   people in different places see the same day and the same 2:30 PM.
 * - Says WHY when something is missing — nothing to book yet, not live.
 */
export function BookingApp({ organizationId, workspaceId, client }: AppProps & { client?: BookingClient }) {
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const api = useMemo(() => client ?? createBookingClient(), [client]);
  const timeZone = useWorkspaceTimeZone();
  const live = useRealtime() !== null;
  const manageAppointments = useHoldsFeature(BOOKING_FEATURE.manageAppointments);
  const cancelAppointments = useHoldsFeature(BOOKING_FEATURE.cancelAppointments);
  const manageServices = useHoldsFeature(BOOKING_FEATURE.manageServices);
  const manageSettings = useHoldsFeature(BOOKING_FEATURE.manageSettings);
  const [section, setSection] = useState<Section>('day');

  // The live services and resources, read once here: the day's dialogs need them to offer anything.
  const loadCatalogue = useCallback(() => api.catalogue(scope, false), [api, scope]);
  const catalogue = useBookingData(scope, loadCatalogue, ['catalogue'], 'Could not load what can be booked.');

  const state: BookingAppState = {
    scope,
    client: api,
    timeZone,
    catalogue,
    can: { manageAppointments, cancelAppointments, manageServices, manageSettings },
  };

  // Requests from the public page, waiting for the desk — counted here so the bar can say so from any section.
  const loadRequests = useCallback(() => api.requests(scope), [api, scope]);
  const requests = useBookingData(scope, loadRequests, ['appointment'], 'Could not load the requests.');
  const loadSettings = useCallback(() => api.settings(scope), [api, scope]);
  const settings = useBookingData(scope, loadSettings, ['settings'], 'Could not load the settings.');
  const waiting = requests.data?.length ?? 0;
  // The tab is for shops that take requests: shown once the public page is on, and for as long as any wait.
  const takesRequests = (settings.data?.publicEnabled ?? false) || waiting > 0;

  const sections: { key: Section; label: string; icon: LucideIcon; badge?: number }[] = [
    { key: 'day', label: 'Day', icon: CalendarDays },
    ...(takesRequests ? [{ key: 'requests' as const, label: 'Requests', icon: Inbox, badge: waiting }] : []),
    ...(manageServices ? [{ key: 'services' as const, label: 'Services', icon: ClipboardList }] : []),
    ...(manageServices ? [{ key: 'resources' as const, label: 'Resources', icon: UsersRound }] : []),
    ...(manageSettings ? [{ key: 'settings' as const, label: 'Settings', icon: Settings }] : []),
  ];

  return (
    <div className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground">
      <SectionBar label="Booking" sections={sections} current={section} onChange={setSection}>
        {live ? null : 'Not live — other people’s bookings show when you reload.'}
      </SectionBar>
      {section === 'day' ? <DaySection state={state} /> : null}
      {section === 'requests' ? <RequestsSection state={state} requests={requests} /> : null}
      {section === 'services' && manageServices ? <ServicesSection state={state} /> : null}
      {section === 'resources' && manageServices ? <ResourcesSection state={state} /> : null}
      {section === 'settings' && manageSettings ? <SettingsSection state={state} /> : null}
    </div>
  );
}
