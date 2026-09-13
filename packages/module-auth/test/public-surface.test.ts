import 'reflect-metadata';
import { PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC, Public } from '../src/server/auth.decorators.js';

/**
 * `@Public` and a module that cannot import it must write the SAME key.
 *
 * A module other than this one marks a surface public with
 * `SetMetadata(PUBLIC_SURFACE_METADATA, reason)`, because PLAN §9 forbids it
 * importing `@Public`. If the two ever diverged, that surface would be refused
 * by `JwtAuthGuard` as "Not signed in" — loud, but only on the page nobody
 * signed in to test.
 */
describe('the public-surface metadata key', () => {
  class Handlers {
    @Public('the credential endpoint')
    viaDecorator() {}

    @SetMetadata(PUBLIC_SURFACE_METADATA, 'a module that cannot import @Public')
    viaSharedKey() {}
  }

  it('is the key JwtAuthGuard reads', () => {
    expect(IS_PUBLIC).toBe(PUBLIC_SURFACE_METADATA);
  });

  it('is written by @Public', () => {
    expect(Reflect.getMetadata(PUBLIC_SURFACE_METADATA, Handlers.prototype.viaDecorator)).toBe(
      'the credential endpoint',
    );
  });

  it('is read the same way when another module writes it directly', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, Handlers.prototype.viaSharedKey)).toBe('a module that cannot import @Public');
  });
});
