import { Controller, Get, Query, Req } from '@nestjs/common';
import { filterFeatures } from '../domain/feature-filter.js';
import { type Page, paginate } from '../domain/pagination.js';
import { FEATURE, FEATURE_REGISTRY } from '../feature-keys.js';
import type { FeatureSpec, PermissionContext } from '../types.js';
import { PERMISSION_CONTEXT_KEY } from './feature.guard.js';
import { RequireFeature } from './require-feature.decorator.js';

/**
 * The module's REST surface.
 *
 * Listed in PermissionsModule's `controllers`, so an app that imports the
 * module has these routes — guards, Swagger entries and all — without writing a
 * line. @nestjs/swagger scans registered controllers, so they appear in
 * openapi.json for free, which means the frontend's generated REST types pick
 * them up with no extra wiring either.
 *
 * Mount them under a prefix from the app if the bare paths collide:
 *   RouterModule.register([{ path: 'admin', module: PermissionsModule }])
 */
/** `undefined` for anything that is not a whole number, so `resolvePageArgs` applies its default. */
function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/** `?modules=a,b` — repeated params would work too, but one spelling is enough. */
function toList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * `undefined` for anything that is not clearly true or false.
 *
 * Not `Boolean(value)`: that reads `?isPrivileged=false` as TRUE, because a
 * non-empty string is truthy — filtering to exactly the rows the caller wanted
 * excluded.
 */
function toBool(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

@Controller('permissions')
export class PermissionsController {
  /** The grantable vocabulary, for the role editor. */
  @Get('features')
  // `features:read`, not `admin:access`: this returns the grantable vocabulary,
  // which is what that key means. Two keys for one question is two places for
  // them to drift.
  @RequireFeature(FEATURE.featuresRead)
  /*
   * Paged like the GraphQL query, and clamped the same way — two endpoints
   * answering one question must not have two ideas about how much of it to
   * answer. Bad or absent query strings fall back rather than 400: `?limit=abc`
   * is a caller mistake that should still return something usable, and the
   * response says which limit was applied.
   */
  features(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
    @Query('modules') modules?: string,
    @Query('levels') levels?: string,
    @Query('tags') tags?: string,
    @Query('isPrivileged') isPrivileged?: string,
    @Query('unboundOnly') unboundOnly?: string,
  ): Page<FeatureSpec> {
    // Filter then page — see the resolver for why the order matters.
    const matching = filterFeatures(FEATURE_REGISTRY, {
      search,
      modules: toList(modules),
      levels: toList(levels),
      tags: toList(tags),
      isPrivileged: toBool(isPrivileged),
      unboundOnly: toBool(unboundOnly),
    });

    return paginate(matching, { limit: toInt(limit), offset: toInt(offset) });
  }

  /**
   * The caller's own grants. No @RequireFeature: asking what you hold is not
   * itself a privilege, and gating it would deadlock the frontend's first load.
   * The guard has already memoised the context onto the request.
   */
  @Get('me')
  me(@Req() request: Record<string, unknown>): PermissionContext | null {
    return (request[PERMISSION_CONTEXT_KEY] as PermissionContext | undefined) ?? null;
  }
}
