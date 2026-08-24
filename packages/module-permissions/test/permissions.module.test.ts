import { FeatureGuard } from '../src/server/feature.guard.js';
import { PermissionsResolver } from '../src/server/graphql/permissions.resolver.js';
import { PermissionsController } from '../src/server/permissions.controller.js';
import { PERMISSIONS_OPTIONS, PermissionsModule } from '../src/server/permissions.module.js';
import { PERMISSIONS_PRISMA } from '../src/server/permissions.repository.js';
import { PermissionsService } from '../src/server/permissions.service.js';

/**
 * Registration is composition, not wiring: importing the module IS the
 * registration. REST routes appear in the app and therefore in openapi.json,
 * resolvers join the composed code-first schema, and the app writes no glue.
 *
 * `expose` is the one knob — a worker importing the module for its service
 * alone wants neither transport.
 */

const principal = { resolvePrincipal: () => ({ userId: 'u1' }) };

describe('PermissionsModule.forRoot', () => {
  it('publishes both transports by default', () => {
    const mod = PermissionsModule.forRoot(principal);
    expect(mod.controllers).toEqual([PermissionsController]);
    expect(mod.providers).toContain(PermissionsResolver);
  });

  it('drops the controller when REST is turned off', () => {
    const mod = PermissionsModule.forRoot({ ...principal, expose: { rest: false } });
    expect(mod.controllers).toEqual([]);
    // GraphQL is unaffected: the two are independent switches.
    expect(mod.providers).toContain(PermissionsResolver);
  });

  it('drops the resolver when GraphQL is turned off', () => {
    const mod = PermissionsModule.forRoot({ ...principal, expose: { graphql: false } });
    expect(mod.providers).not.toContain(PermissionsResolver);
    expect(mod.controllers).toEqual([PermissionsController]);
  });

  it('leaves the service and guard available with both transports off — the worker case', () => {
    const mod = PermissionsModule.forRoot({ ...principal, expose: { rest: false, graphql: false } });
    expect(mod.providers).toEqual(expect.arrayContaining([PermissionsService, FeatureGuard]));
    expect(mod.exports).toEqual(expect.arrayContaining([FeatureGuard, PermissionsService, PERMISSIONS_OPTIONS]));
  });

  it('registers the app’s prisma binding when one is given, and none otherwise', () => {
    // The module opens no connection of its own; the host injects the client.
    const provider = { provide: PERMISSIONS_PRISMA, useValue: {} };
    expect(PermissionsModule.forRoot({ ...principal, prismaProvider: provider }).providers).toContain(provider);

    const without = PermissionsModule.forRoot(principal).providers ?? [];
    expect(without.some((p) => typeof p === 'object' && 'provide' in p && p.provide === PERMISSIONS_PRISMA)).toBe(
      false,
    );
  });

  it('passes the options through as a provider the guard can inject', () => {
    const options = { ...principal, apiPrefix: '/api/v1' };
    expect(PermissionsModule.forRoot(options).providers).toContainEqual({
      provide: PERMISSIONS_OPTIONS,
      useValue: options,
    });
  });

  it('forwards the app’s imports, so the prisma provider can depend on a DB module', () => {
    class DbModule {}
    expect(PermissionsModule.forRoot({ ...principal, imports: [DbModule] }).imports).toEqual([DbModule]);
    expect(PermissionsModule.forRoot(principal).imports).toEqual([]);
  });

  it('is global, so a guard applied app-wide can resolve it', () => {
    expect(PermissionsModule.forRoot(principal).global).toBe(true);
  });
});
