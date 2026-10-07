'use client';

import type { StudioCalibration } from '../domain/calibration.js';
import type { StudioLayoutSpec } from '../domain/layout.js';
import type { StudioLogEntry } from '../domain/log.js';
import { STUDIO_OPERATIONS } from '../operations.js';

/**
 * How the print studio reaches the API — through the app's same-origin route
 * handler, which attaches the session. The path is a parameter because that
 * handler belongs to `module-auth`, and this module may not name its URL
 * (PLAN §9). The default is where this app mounts it.
 *
 * ⚠ NOTHING HERE CARRIES A FILE. Layouts, calibration profiles and log entries
 * are the only things this client ever sends (PRINT-STUDIO-PLAN decision 8).
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface StudioScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface StudioLayoutView {
  id: string;
  name: string;
  /** `private` or `workspace`. */
  visibility: string;
  /** What kind of work it is for. Null: none. */
  tag: string | null;
  version: number;
  mine: boolean;
  ownerId: string;
  ownerName: string | null;
  updatedAt: string;
  createdAt: string;
  spec: StudioLayoutSpec;
}

export interface StudioCalibrationView extends StudioCalibration {
  id: string;
  name: string;
  updatedAt: string;
}

export interface StudioLogEntryView {
  id: string;
  action: string;
  kind: string;
  userId: string;
  userName: string | null;
  mine: boolean;
  layoutId: string | null;
  layoutName: string | null;
  paperLabel: string;
  paperWidth: number;
  paperHeight: number;
  pages: number;
  copies: number;
  fileNames: string[];
  createdAt: string;
}

export interface StudioLogPageView {
  entries: StudioLogEntryView[];
  nextCursor: string | null;
  everyone: boolean;
}

/** A workspace's settings. `keymap` is a `StudioKeymap` as JSON text, always complete. */
export interface StudioSettingsView {
  keymap: string;
  version: number;
}

export interface StudioClient {
  settings(scope: StudioScopeView): Promise<StudioSettingsView>;
  /** `keymap` null puts every key back to its default. */
  saveSettings(scope: StudioScopeView, keymap: string | null): Promise<StudioSettingsView>;
  layouts(scope: StudioScopeView): Promise<StudioLayoutView[]>;
  createLayout(
    scope: StudioScopeView,
    input: { name: string; visibility?: 'private' | 'workspace'; tag?: string; spec: StudioLayoutSpec },
  ): Promise<StudioLayoutView>;
  /** ⚠ Only the changed fields, from the version they were changed from. */
  updateLayout(
    scope: StudioScopeView,
    layoutId: string,
    expectedVersion: number,
    /** `tag`: an empty string takes it off; absent leaves it. */
    input: { name?: string; spec?: StudioLayoutSpec; tag?: string },
  ): Promise<StudioLayoutView>;
  setVisibility(
    scope: StudioScopeView,
    layoutId: string,
    visibility: 'private' | 'workspace',
  ): Promise<StudioLayoutView>;
  duplicateLayout(scope: StudioScopeView, layoutId: string, name?: string): Promise<StudioLayoutView>;
  deleteLayout(scope: StudioScopeView, layoutId: string): Promise<void>;
  calibrations(scope: StudioScopeView): Promise<StudioCalibrationView[]>;
  saveCalibration(
    scope: StudioScopeView,
    input: StudioCalibration & { id?: string; name: string },
  ): Promise<StudioCalibrationView>;
  deleteCalibration(scope: StudioScopeView, calibrationId: string): Promise<void>;
  log(
    scope: StudioScopeView,
    input: { everyone?: boolean; cursor?: string | null; limit?: number },
  ): Promise<StudioLogPageView>;
  recordPrint(scope: StudioScopeView, entry: StudioLogEntry): Promise<void>;
}

/** A spec as the schema's input takes it: a cell's absent label, and an absent border or sizing, are sent as null. */
function specInput(spec: StudioLayoutSpec) {
  return {
    ...spec,
    cells: spec.cells.map((cell) => ({ ...cell, label: cell.label ?? null })),
    border: spec.border ?? null,
    sizing: spec.sizing ?? null,
  };
}

/** A spec as the domain holds it: the API's null label, border or sizing is an absent one. */
function specFromApi(
  spec: Omit<StudioLayoutSpec, 'border' | 'sizing'> & {
    border?: StudioLayoutSpec['border'] | null;
    sizing?: StudioLayoutSpec['sizing'] | null;
  },
): StudioLayoutSpec {
  const { border, sizing, ...rest } = spec;
  return {
    ...rest,
    cells: spec.cells.map(({ label, ...cell }) => (label ? { ...cell, label } : cell)),
    ...(border ? { border } : {}),
    ...(sizing ? { sizing } : {}),
  };
}

const layoutFromApi = (layout: StudioLayoutView): StudioLayoutView => ({ ...layout, spec: specFromApi(layout.spec) });

export function createStudioClient(options: { graphqlPath?: string } = {}): StudioClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call. Throws the API's FIRST error message:
   * the refusals are written for a reader, and two of them — not found and
   * conflict — are what the editor compares against.
   */
  async function graphql<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ query: document, variables }),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  const scoped = (scope: StudioScopeView, extra: Record<string, unknown> = {}) => ({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...extra,
  });
  const ops = STUDIO_OPERATIONS;

  return {
    async settings(scope) {
      return (await graphql<{ studioSettings: StudioSettingsView }>(ops.studioSettings, scoped(scope))).studioSettings;
    },
    async saveSettings(scope, keymap) {
      const data = await graphql<{ saveStudioSettings: StudioSettingsView }>(
        ops.saveStudioSettings,
        scoped(scope, { keymap }),
      );
      return data.saveStudioSettings;
    },
    async layouts(scope) {
      const data = await graphql<{ studioLayouts: StudioLayoutView[] }>(ops.studioLayouts, scoped(scope));
      return data.studioLayouts.map(layoutFromApi);
    },
    async createLayout(scope, input) {
      const variables = scoped(scope, { input: { ...input, spec: specInput(input.spec) } });
      const data = await graphql<{ createStudioLayout: StudioLayoutView }>(ops.createStudioLayout, variables);
      return layoutFromApi(data.createStudioLayout);
    },
    async updateLayout(scope, layoutId, expectedVersion, input) {
      const changes = { ...input, ...(input.spec ? { spec: specInput(input.spec) } : {}) };
      const variables = scoped(scope, { layoutId, expectedVersion, input: changes });
      const data = await graphql<{ updateStudioLayout: StudioLayoutView }>(ops.updateStudioLayout, variables);
      return layoutFromApi(data.updateStudioLayout);
    },
    async setVisibility(scope, layoutId, visibility) {
      const data = await graphql<{ setStudioLayoutVisibility: StudioLayoutView }>(
        ops.setStudioLayoutVisibility,
        scoped(scope, { layoutId, visibility }),
      );
      return layoutFromApi(data.setStudioLayoutVisibility);
    },
    async duplicateLayout(scope, layoutId, name) {
      const data = await graphql<{ duplicateStudioLayout: StudioLayoutView }>(
        ops.duplicateStudioLayout,
        scoped(scope, { layoutId, name: name ?? null }),
      );
      return layoutFromApi(data.duplicateStudioLayout);
    },
    async deleteLayout(scope, layoutId) {
      await graphql(ops.deleteStudioLayout, scoped(scope, { layoutId }));
    },
    async calibrations(scope) {
      const data = await graphql<{ studioCalibrations: StudioCalibrationView[] }>(
        ops.studioCalibrations,
        scoped(scope),
      );
      return data.studioCalibrations;
    },
    async saveCalibration(scope, input) {
      const data = await graphql<{ saveStudioCalibration: StudioCalibrationView }>(
        ops.saveStudioCalibration,
        scoped(scope, { input }),
      );
      return data.saveStudioCalibration;
    },
    async deleteCalibration(scope, calibrationId) {
      await graphql(ops.deleteStudioCalibration, scoped(scope, { calibrationId }));
    },
    async log(scope, input) {
      const variables = scoped(scope, {
        everyone: input.everyone ?? false,
        cursor: input.cursor ?? null,
        limit: input.limit ?? null,
      });
      return (await graphql<{ studioLog: StudioLogPageView }>(ops.studioLog, variables)).studioLog;
    },
    async recordPrint(scope, entry) {
      await graphql(ops.recordStudioPrint, scoped(scope, { input: entry }));
    },
  };
}
