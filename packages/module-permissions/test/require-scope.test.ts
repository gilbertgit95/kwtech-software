import 'reflect-metadata';
import { declareScope, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import { REQUIRED_SCOPE, RequireScope, type ScopeSpec } from '../src/server/require-scope.decorator.js';

/**
 * `@RequireScope` and a module that cannot import it must write the SAME key.
 *
 * ⚠ This is the failure that matters most in the whole move, because it is
 * SILENT. A module below app level declares its scope with
 * `SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))`. If
 * `FeatureGuard` read a different key it would find no declaration, resolve
 * the resolver at app level, and every workspace-level key would grant nothing
 * to everybody — no error, just a denial nobody can explain (PLAN §12.13).
 */
describe('the required-scope metadata key', () => {
  class Handlers {
    @RequireScope('workspace')
    viaDecorator() {}

    @SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace', { workspaceIdArg: 'wsId' }))
    viaSharedKey() {}
  }

  it('is the key FeatureGuard reads', () => {
    expect(REQUIRED_SCOPE).toBe(REQUIRED_SCOPE_METADATA);
  });

  it('is written by @RequireScope', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, Handlers.prototype.viaDecorator)).toEqual({
      level: 'workspace',
    });
  });

  it('is read as a ScopeSpec when another module writes it directly', () => {
    const declared = Reflect.getMetadata(REQUIRED_SCOPE, Handlers.prototype.viaSharedKey) as ScopeSpec;
    expect(declared).toEqual({ level: 'workspace', workspaceIdArg: 'wsId' });
  });
});
