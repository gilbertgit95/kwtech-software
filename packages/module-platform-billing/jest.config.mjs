/**
 * Jest 30 + @swc/jest, as every package here does.
 *
 * `moduleNameMapper` is the load-bearing line: the source is NodeNext, so every
 * relative import carries a '.js' that does not exist before a build. Stripping
 * it lets the suite run against src/ directly.
 *
 * No decorators and no JSX yet: phase 2 (#91) is the pure core. Phase 4 adds
 * the Nest half and copies module-queuing-window's transform options.
 */
export default {
  // Two workers, not jest's default of one per CPU core: turbo runs several
  // packages' suites at once, and a dozen workers in each is what ran the
  // machine out of memory (turbo.json, `concurrency`, has the numbers).
  maxWorkers: 2,
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' }, target: 'es2023' } }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts'],
};
