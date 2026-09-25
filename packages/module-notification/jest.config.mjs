/**
 * Jest 30 + @swc/jest, as every package here does.
 *
 * `moduleNameMapper` is the load-bearing line: the source is NodeNext, so every
 * relative import carries a '.js' that does not exist before a build. Stripping
 * it lets the suite run against src/ directly.
 *
 * Decorators are on because the server adapter is Nest, and the surface-coverage
 * suite reads the resolvers' metadata back — which needs the polyfill loaded
 * before a resolver class is evaluated. `tsx` because the web descriptor renders
 * its route adapters, and a suite that could not parse JSX could not assert what
 * the module contributes.
 */
export default {
  setupFiles: ['reflect-metadata'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true, decorators: true },
          transform: { decoratorMetadata: true, legacyDecorator: true, react: { runtime: 'automatic' } },
          target: 'es2023',
        },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts', '!src/react/**'],
};
