import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AUTH_OPTIONS, type AuthModuleOptions } from './auth.options.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { TokenService } from './token.service.js';

/**
 * Wire once per server app:
 *
 *   AuthModule.forRoot({
 *     jwtSecret: env.JWT_SECRET,
 *     issuer: 'kwtech-web-server',
 *     audience: 'kwtech-api',
 *     prismaProvider: { provide: AUTH_PRISMA, useExisting: PrismaService },
 *     sendPasswordResetEmail: ({ user, token }) => mailer.sendReset(user.email, token),
 *   })
 *
 * then apply JwtAuthGuard globally with APP_GUARD. Global on purpose:
 * authentication is opt-out (@Public), so a handler nobody annotated is
 * protected rather than anonymous.
 */
@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    // Checked here rather than at first use: a missing secret must stop the
    // app booting, not surface as the first sign-in of the day failing.
    if (!options.jwtSecret) throw new Error('AuthModule.forRoot requires a jwtSecret');
    if (!options.issuer || !options.audience) {
      throw new Error('AuthModule.forRoot requires an issuer and an audience — they are verified on every token');
    }

    const providers: Provider[] = [
      { provide: AUTH_OPTIONS, useValue: options },
      // Nest auto-provides Reflector in the ROOT injector, not in a dynamic
      // module's own. JwtAuthGuard reads decorator metadata through it, so
      // without this line the container cannot construct the guard and the app
      // fails at boot with "can't resolve dependencies of the JwtAuthGuard".
      // Listed rather than imported: importing @nestjs/core's module graph to
      // obtain one helper is a heavier dependency than providing it.
      Reflector,
      TokenService,
      AuthService,
      JwtAuthGuard,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider);

    return {
      module: AuthModule,
      controllers: [AuthController],
      providers,
      exports: [AuthService, TokenService, JwtAuthGuard, AUTH_OPTIONS],
      global: true,
    };
  }
}
