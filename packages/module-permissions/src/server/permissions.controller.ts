import { Controller, Get, Req } from '@nestjs/common';
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
@Controller('permissions')
export class PermissionsController {
  /** The grantable vocabulary, for the role editor. */
  @Get('features')
  @RequireFeature(FEATURE.adminAccess)
  features(): readonly FeatureSpec[] {
    return FEATURE_REGISTRY;
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
