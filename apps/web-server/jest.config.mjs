/**
 * Jest 30 + @swc/jest, per PLAN §3 — swc, not ts-jest, so the suite compiles at
 * roughly the speed of the code it tests.
 *
 * Two things are load-bearing here:
 *
 *   moduleNameMapper  the source is written for NodeNext, so every relative
 *                     import carries a '.js' extension that does not exist
 *                     before a build. Stripping it lets the tests run against
 *                     src/ directly — a test that needed `tsc` first would stop
 *                     being run.
 *   decorators        the server adapter is Nest, and its classes do not parse
 *                     without decorator support. emitDecoratorMetadata is on
 *                     for the same reason tsconfig sets it: DI reads
 *                     design:paramtypes from it.
 */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  // The generated Prisma client is enormous and has no tests of its own.
  testPathIgnorePatterns: ['/node_modules/', '/src/generated/'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true, decorators: true },
          transform: { decoratorMetadata: true, legacyDecorator: true },
          target: 'es2023',
        },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts', '!src/generated/**'],
};
