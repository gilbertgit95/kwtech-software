/**
 * Jest 30 + @swc/jest, as every package here does.
 *
 * `moduleNameMapper` is the load-bearing line: the source is NodeNext, so every
 * relative import carries a '.js' that does not exist before a build. Stripping
 * it lets the suite run against src/ directly — a test that needed `tsc` first
 * would stop being run.
 *
 * No decorator options, unlike module-permissions: this package is PURE DOMAIN
 * today. The day a Nest adapter lands here, they arrive with it.
 */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' }, target: 'es2023' } }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts'],
};
