import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { GraphQLFloat, GraphQLObjectType, type GraphQLSchema } from 'graphql';
import { PlatformBillingAdminResolver } from '../src/server/graphql/platform-billing-admin.resolver.js';

/**
 * ⚠ THE REPORT'S SUMS MUST CROSS AS `Float`. `reports.test.ts` proves the
 * arithmetic stays exact past 2,147,483,647 centavos, but it calls the domain
 * directly: a sum field put back to `Int` would still pass it, and then the
 * query fails to serialise the first time collections pass about 21 million
 * pesos. This builds the schema from the decorators, as the app's GraphQL
 * module does at boot, and checks every summed field's type.
 */
const SUM_FIELDS: ReadonlyArray<readonly [type: string, field: string]> = [
  ['PlatformBillingReport', 'total'],
  ['PlatformBillingCollected', 'amount'],
  ['PlatformBillingPlanRevenue', 'amount'],
  ['PlatformBillingStandingsSummary', 'creditHeld'],
  ['PlatformBillingStandingsSummary', 'creditOwed'],
];

describe('the report schema', () => {
  let schema: GraphQLSchema;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const app = await NestFactory.create(GraphQLSchemaBuilderModule, { logger: false });
    await app.init();
    close = () => app.close();
    schema = await app.get(GraphQLSchemaFactory).create([PlatformBillingAdminResolver]);
  });

  afterAll(async () => {
    await close?.();
  });

  it.each(SUM_FIELDS)('%s.%s is Float!, which holds totals past Int', (typeName, fieldName) => {
    const type = schema.getType(typeName);
    expect(type).toBeInstanceOf(GraphQLObjectType);
    const field = (type as GraphQLObjectType).getFields()[fieldName];
    expect(String(field?.type)).toBe('Float!');
    // What a Float field actually serialises: the large total, exactly.
    expect(GraphQLFloat.serialize(4_000_000_001)).toBe(4_000_000_001);
  });
});
