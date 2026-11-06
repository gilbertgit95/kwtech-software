import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { buildSchema, parse, printSchema, validate } from 'graphql';
import { LOCAL_NETWORK_OPERATIONS } from '../src/operations.js';
import { LocalNetworkResolver } from '../src/server/graphql/local-network.resolver.js';

/**
 * ⚠ A schema mistake (a nullable field with no explicit type, a missing
 * `@Field`) passes tsc and fails only when the API boots. This builds the
 * schema from the resolver as the app's GraphQL module will, and checks the
 * page's document against it, before any app composes the module (phase 5 of
 * #66 adds it to `module-operations.test.ts` too).
 */
describe('the local network schema', () => {
  it('builds, and the page’s query is valid against it', async () => {
    const app = await NestFactory.create(GraphQLSchemaBuilderModule, { logger: false });
    await app.init();
    try {
      const factory = app.get(GraphQLSchemaFactory);
      const schema = buildSchema(printSchema(await factory.create([LocalNetworkResolver])));
      expect(validate(schema, parse(LOCAL_NETWORK_OPERATIONS.localNetwork))).toEqual([]);
      expect(printSchema(schema)).toContain('localNetwork: LocalNetwork!');
    } finally {
      await app.close();
    }
  });
});
