import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { chatIsEnabled } from '../enabled.js';
import { ChatEventPublisher } from './chat.events.js';
import type { ChatModuleOptions } from './chat.options.js';
import { ChatPresenceService } from './chat.presence.service.js';
import { ChatService } from './chat.service.js';
import {
  CHAT_DEFAULTS,
  CHAT_LIMIT_CHECKER,
  CHAT_OPTIONS,
  CHAT_PLATFORM_ADMIN,
  CHAT_PRISMA,
  CHAT_PRISMA_WRITE,
  CHAT_PUBSUB,
  CHAT_USER_DIRECTORY,
} from './chat.tokens.js';
import { ChatWriteService } from './chat-write.service.js';
import { ChatResolver } from './graphql/chat.resolver.js';

/**
 * Importing this module IS the registration. The host writes no glue: the
 * resolver joins the composed schema because the driver walks the container.
 *
 * ⚠ `enabled: false` RETURNS A MODULE THAT REGISTERS NOTHING, and that is ONE
 * place on purpose. A flag each surface consults for itself is a flag somebody
 * forgets in one of them, and a "disabled" chat that still answers a GraphQL
 * query is worse than no switch at all.
 */
@Module({})
export class ChatModule {
  static forRoot(options: ChatModuleOptions = {}): DynamicModule {
    // ⚠ The same reader the WEB descriptor uses, so the two halves of the
    // module cannot disagree about what "on" means.
    if (!chatIsEnabled(options)) {
      /*
       * Deliberately NOT an empty providers array with the resolver removed —
       * nothing at all. The options token is not even bound, so a stray
       * injection fails loudly at boot rather than resolving an object whose
       * `enabled` nobody rechecks.
       */
      return { module: ChatModule };
    }

    const exposeGraphql = options.expose?.graphql ?? true;

    const providers: Provider[] = [
      { provide: CHAT_OPTIONS, useValue: options },
      ChatService,
      ChatWriteService,
      ChatEventPublisher,
      /*
       * ⚠ Provided even with no pub/sub bound: it holds the registries, and
       * `chatPresence` answering "nobody is here" is a better shape than the
       * resolver having to know whether the tier exists. Its sweep timer is
       * unref'd, so a host with no sockets pays a wakeup and nothing else.
       */
      ChatPresenceService,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);
    if (options.userDirectoryProvider) providers.push(options.userDirectoryProvider as Provider);
    else providers.push({ provide: CHAT_USER_DIRECTORY, useValue: undefined });
    /*
     * ⚠ The NULL OBJECT when the host binds nothing, so chat runs in an app with
     * no permission model at all: unguarded but functional. The cost — a host
     * that MEANT to enforce the cap and forgot the binding gets silence — is
     * the price of that, and is stated in the options.
     */
    if (options.limitCheckerProvider) providers.push(options.limitCheckerProvider as Provider);
    else providers.push({ provide: CHAT_LIMIT_CHECKER, useValue: undefined });
    /*
     * ⚠ No engine means the NULL one, which publishes into nothing and whose
     * subscription ends rather than hangs. Chat works over HTTP alone; it is
     * simply not live.
     */
    if (options.pubsubProvider) providers.push(options.pubsubProvider as Provider);
    else providers.push({ provide: CHAT_PUBSUB, useValue: undefined });
    /*
     * ⚠ Unbound means NOBODY administers a conversation they are not in. A host
     * that has not answered the question has not granted the right.
     */
    if (options.platformAdminProvider) providers.push(options.platformAdminProvider as Provider);
    else providers.push({ provide: CHAT_PLATFORM_ADMIN, useValue: undefined });
    /*
     * ⚠ Unbound means EVERY DEFAULT IS UNSET, which is the documented
     * fallback and a working product: the creator owns the group they made and
     * everybody else joins as a member, exactly as before the settings existed.
     *
     * ⚠ And it is bound to `undefined` rather than left out, for the reason
     * every token above is. `ChatWriteService` injects this `@Optional()`, and
     * an optional token that NOTHING provides resolves to undefined only while
     * no other provider in the graph asks for it by that name — binding it
     * explicitly is what makes "nobody answered" a stated configuration rather
     * than a property of the container.
     */
    if (options.defaultsProvider) providers.push(options.defaultsProvider as Provider);
    else providers.push({ provide: CHAT_DEFAULTS, useValue: undefined });

    if (exposeGraphql) providers.push(ChatResolver);

    return {
      module: ChatModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [ChatService, ChatWriteService, ChatEventPublisher, ChatPresenceService, CHAT_OPTIONS],
    };
  }
}

export {
  CHAT_DEFAULTS,
  CHAT_LIMIT_CHECKER,
  CHAT_OPTIONS,
  CHAT_PLATFORM_ADMIN,
  CHAT_PRISMA,
  CHAT_PRISMA_WRITE,
  CHAT_PUBSUB,
  CHAT_USER_DIRECTORY,
};
