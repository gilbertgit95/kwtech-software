import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { PrintResolver } from './graphql/print.resolver.js';
import { PrintAgentResolver } from './graphql/print-agent.resolver.js';
import { PrintRelayController } from './http/print-relay.controller.js';
import type { PrintModuleOptions } from './print.options.js';
import { PrintService } from './print.service.js';
import { PRINT_LIMIT_CHECKER, PRINT_OPTIONS } from './print.tokens.js';
import { PrintAgentService } from './print-agent.service.js';
import { PrintJobService } from './print-job.service.js';
import { PrintRelayService } from './print-relay.service.js';
import { PrintWriteService } from './print-write.service.js';

/**
 * Importing this module IS the registration: the resolvers join the composed
 * schema because the driver walks the container.
 */
@Module({})
export class PrintModule {
  static forRoot(options: PrintModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: PRINT_OPTIONS, useValue: options },
      PrintService,
      PrintWriteService,
      PrintAgentService,
      PrintRelayService,
      PrintJobService,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold.
     */
    const optional: Array<[unknown, string]> = [[options.limitCheckerProvider, PRINT_LIMIT_CHECKER]];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(PrintResolver, PrintAgentResolver);

    return {
      module: PrintModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      /*
       * ⚠ The relay's two routes, which carry a job's file. With them off
       * (`expose.rest: false`) a job can still be opened and can never be
       * sent: it fails `agent_did_not_fetch`. Off is for a host that mounts
       * the transfer some other way.
       */
      controllers: (options.expose?.rest ?? true) ? [PrintRelayController] : [],
      // `PrintAgentService` is exported for the host's socket handshake, which calls `admit`.
      exports: [PrintService, PrintWriteService, PrintAgentService, PrintJobService, PrintRelayService, PRINT_OPTIONS],
    };
  }
}
