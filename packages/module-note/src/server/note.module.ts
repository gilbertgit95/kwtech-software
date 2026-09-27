import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { NoteResolver } from './graphql/note.resolver.js';
import { NoteEventPublisher } from './note.events.js';
import type { NoteModuleOptions } from './note.options.js';
import { NoteService } from './note.service.js';
import {
  NOTE_ACCESS_CHECK,
  NOTE_AUTHOR_DIRECTORY,
  NOTE_LIMIT_CHECKER,
  NOTE_OPTIONS,
  NOTE_PUBSUB,
} from './note.tokens.js';
import { NoteWriteService } from './note-write.service.js';

/**
 * Importing this module IS the registration: the resolver joins the composed
 * schema because the driver walks the container.
 */
@Module({})
export class NoteModule {
  static forRoot(options: NoteModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: NOTE_OPTIONS, useValue: options },
      NoteService,
      NoteWriteService,
      NoteEventPublisher,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `NoteModuleOptions`.
     */
    const optional: Array<[unknown, string]> = [
      [options.limitCheckerProvider, NOTE_LIMIT_CHECKER],
      [options.accessCheckProvider, NOTE_ACCESS_CHECK],
      [options.authorDirectoryProvider, NOTE_AUTHOR_DIRECTORY],
      [options.pubsubProvider, NOTE_PUBSUB],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(NoteResolver);

    return {
      module: NoteModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [NoteService, NoteWriteService, NoteEventPublisher, NOTE_OPTIONS],
    };
  }
}
