/**
 * Jest 30 + @swc/jest, as every package here does.
 *
 * `moduleNameMapper` is the load-bearing line: the source is NodeNext, so every
 * relative import carries a '.js' that does not exist before a build. Stripping
 * it lets the suite run against src/ directly.
 *
 * Decorators are on because the server adapter is Nest: the resolver carries
 * `@Inject` parameters, and the surface-coverage suite reads its metadata
 * back, so the polyfill loads before a class is evaluated. The page (phase 4
 * of #66) adds `tsx`, as module-backup's config has it.
 */
export default {
  // Two workers, not jest's default of one per CPU core: turbo runs several
  // packages' suites at once, and a dozen workers in each is what ran the
  // machine out of memory (turbo.json, `concurrency`, has the numbers).
  maxWorkers: 2,
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
