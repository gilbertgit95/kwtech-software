import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { PlatformBillingResolver } from './graphql/platform-billing.resolver.js';
import { PlatformBillingAdminResolver } from './graphql/platform-billing-admin.resolver.js';
import type { PlatformBillingModuleOptions } from './platform-billing.options.js';
import { PlatformBillingService } from './platform-billing.service.js';
import { PLATFORM_BILLING_OPTIONS, PLATFORM_BILLING_PEOPLE } from './platform-billing.tokens.js';
import { PlatformBillingWriteService } from './platform-billing-write.service.js';

/**
 * Importing this module IS the registration: both resolvers join the composed
 * schema because the driver walks the container.
 */
@Module({})
export class PlatformBillingModule {
  static forRoot(options: PlatformBillingModuleOptions = {}): DynamicModule {
    /*
     * ⚠ The subscription and plan ports are REQUIRED, checked here rather than
     * at the first approval: billing that cannot apply a plan would take
     * payments and give nothing for them, and the first person to find out
     * would be a customer.
     */
    for (const [provider, name] of [
      [options.subscriptionsProvider, 'subscriptionsProvider (PLATFORM_BILLING_SUBSCRIPTIONS)'],
      [options.plansProvider, 'plansProvider (PLATFORM_BILLING_PLANS)'],
    ] as const) {
      if (!provider) {
        throw new Error(
          `PlatformBillingModule needs ${name}. Bind the app's adapter in platformBillingServerModule({...}) — ` +
            'apps/web-server/src/platform-billing/ has it.',
        );
      }
    }
    const providers: Provider[] = [
      { provide: PLATFORM_BILLING_OPTIONS, useValue: options },
      PlatformBillingService,
      PlatformBillingWriteService,
      options.subscriptionsProvider as Provider,
      options.plansProvider as Provider,
      // ⚠ Bound to `undefined` when absent, so "nobody answered" is stated: every approver is flagged (D15).
      options.peopleProvider
        ? (options.peopleProvider as Provider)
        : { provide: PLATFORM_BILLING_PEOPLE, useValue: undefined },
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);
    if (options.expose?.graphql ?? true) providers.push(PlatformBillingResolver, PlatformBillingAdminResolver);

    return {
      module: PlatformBillingModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [PlatformBillingService, PlatformBillingWriteService, PLATFORM_BILLING_OPTIONS],
    };
  }
}
