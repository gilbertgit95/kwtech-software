import { Inject, Injectable } from '@nestjs/common';
import { type AppHubLayout, readLayout, validateLayout } from '../domain/layout.js';
import { AppHubWriteError } from './app-hub.errors.js';
import type { AppHubPrismaClient } from './app-hub.repository.js';
import { APP_HUB_PRISMA } from './app-hub.tokens.js';

export interface AppHubScope {
  organizationId: string;
  workspaceId: string;
}

/** Both saved layouts, raw. The page fits them to the viewer — only it knows which apps they hold. */
export interface AppHubLayouts {
  mine: AppHubLayout | null;
  workspace: AppHubLayout | null;
}

/**
 * The longest layout text accepted. A full six-cell layout with a hundred tabs
 * is a few kilobytes; this bounds the row, and the parse, well above that.
 */
export const MAX_LAYOUT_TEXT_LENGTH = 16_000;

/**
 * Saved layouts: read both, save or reset your own, save or reset the default.
 *
 * WHO may call what is the guard's job, through the bindings in
 * `APP_HUB_FEATURE_REGISTRY` — every operation is bound, so it has also
 * checked that the caller is a member of this workspace. What is left here is
 * whether the layout itself is one this module will store.
 */
@Injectable()
export class AppHubService {
  constructor(@Inject(APP_HUB_PRISMA) private readonly prisma: AppHubPrismaClient) {}

  async layouts(scope: AppHubScope, actorId: string): Promise<AppHubLayouts> {
    const [mine, workspace] = await Promise.all([
      this.prisma.appHubUserLayout.findUnique({
        where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actorId } },
      }),
      this.prisma.appHubWorkspaceLayout.findUnique({ where: { workspaceId: scope.workspaceId } }),
    ]);
    return {
      // A row from another tenant cannot be reached through a guarded scope;
      // checked anyway, because reading one would show another company's layout.
      mine: mine && mine.organizationId === scope.organizationId ? readLayout(mine.layout) : null,
      workspace: workspace && workspace.organizationId === scope.organizationId ? readLayout(workspace.layout) : null,
    };
  }

  async saveMine(scope: AppHubScope, actorId: string, text: string): Promise<void> {
    const layout = parse(text);
    await this.prisma.appHubUserLayout.upsert({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actorId } },
      create: { ...scope, userId: actorId, layout },
      update: { layout },
    });
  }

  /** Back to the workspace default. Resetting when there is nothing to reset is not an error. */
  async resetMine(scope: AppHubScope, actorId: string): Promise<void> {
    await this.prisma.appHubUserLayout.deleteMany({ where: { workspaceId: scope.workspaceId, userId: actorId } });
  }

  async saveWorkspace(scope: AppHubScope, actorId: string, text: string): Promise<void> {
    const layout = parse(text);
    await this.prisma.appHubWorkspaceLayout.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, layout, updatedBy: actorId },
      update: { layout, updatedBy: actorId },
    });
  }

  /** Back to the built-in default. People's own layouts are left alone. */
  async resetWorkspace(scope: AppHubScope): Promise<void> {
    await this.prisma.appHubWorkspaceLayout.deleteMany({ where: { workspaceId: scope.workspaceId } });
  }
}

/** JSON text → a validated layout, or `AppHubWriteError('invalid')` naming what was wrong. */
function parse(text: string): AppHubLayout {
  if (text.length > MAX_LAYOUT_TEXT_LENGTH) throw new AppHubWriteError('invalid', 'The layout is too large.');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new AppHubWriteError('invalid', 'The layout is not valid JSON.');
  }
  const check = validateLayout(input);
  if (!check.ok) throw new AppHubWriteError('invalid', check.problem);
  return check.layout;
}
