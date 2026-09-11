import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { CHAT_FEATURE_REGISTRY, CHAT_LIMIT_REGISTRY } from '../feature-keys.js';
import { ChatModule } from './chat.module.js';
import type { ChatModuleOptions } from './chat.options.js';

/**
 * Chat as DATA the host composes, rather than wiring the host writes.
 *
 * The app lists this in `SERVER_MODULES` and its resolvers, features and caps
 * all arrive with it — the same one-line adoption `authServerModule()` and
 * `permissionsServerModule()` already have.
 *
 * ⚠ The features and limits ride ALONG rather than being read from this module
 * by anybody: the app composes them in `seed/registry.ts`, which is the one
 * place that has every module's. Carrying them here as well is what lets an app
 * that never seeds still see what chat declares.
 */
export function chatServerModule(options: ChatModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'chat',
    nestModule: ChatModule.forRoot(options),
    features: CHAT_FEATURE_REGISTRY,
    limits: CHAT_LIMIT_REGISTRY,
  };
}
