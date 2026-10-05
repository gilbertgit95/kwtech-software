/**
 * Jest 30 + @swc/jest, as every package here does.
 *
 * `moduleNameMapper` is the load-bearing line: the source is NodeNext, so every
 * relative import carries a '.js' that does not exist before a build. Stripping
 * it lets the suite run against src/ directly.
 *
 * Decorators are on because the server adapter is Nest: the services carry
 * `@Inject` parameters, which need the polyfill loaded before a class is
 * evaluated.
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
          parser: { syntax: 'typescript', decorators: true },
          transform: { decoratorMetadata: true, legacyDecorator: true },
          target: 'es2023',
        },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts'],
};
