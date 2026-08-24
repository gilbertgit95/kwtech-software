import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';

/**
 * `/api/v1` is set as a global prefix, and that is not cosmetic: it is the
 * prefix `PermissionsModule.forRoot({ apiPrefix })` strips before parsing a
 * request's scope from its path. The two must agree, or every organization-
 * scoped request resolves one segment off and silently answers at app level.
 */
const API_PREFIX = 'api/v1';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix(API_PREFIX);

  /**
   * No global ValidationPipe yet. Nest's needs `class-validator`, and §12.6 is
   * still open between that and a zod pipe (which is what masterdb runs) — a
   * choice that belongs to the app and should be made once, not smuggled in by
   * whichever controller needed validation first.
   *
   * Nothing is unvalidated in the meantime: the auth endpoints check their own
   * inputs inside AuthService, which is where a CLI or a worker calling the
   * same method gets the check too. Add the pipe here when §12.6 closes.
   */

  /**
   * The frontends run on a different origin — §5 puts them on Vercel and this
   * service on a container host — so CORS is required rather than incidental.
   * `credentials` stays off: this API is a pure bearer-token service and sets
   * no cookies, which is what leaves it with no CSRF surface at all.
   */
  app.enableCors({ origin: env.CORS_ORIGINS ?? [env.FRONTEND_URL], credentials: false });

  // Emits openapi.json, from which the Next app generates its REST types. The
  // modules' controllers are registered by their DynamicModules, so their
  // routes appear here with no wiring in this file (PLAN §6, §9).
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('kwtech API').setVersion('0.0.0').addBearerAuth().build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);

  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`Listening on http://localhost:${env.PORT}/${API_PREFIX}`);
}

void bootstrap();
