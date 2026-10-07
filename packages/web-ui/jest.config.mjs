/**
 * Jest 30 + @swc/jest, as every package here does — added with the tone engine,
 * the first code in this package whose behaviour a script cannot check.
 *
 * `moduleNameMapper` strips the '.js' NodeNext imports carry, so the suite runs
 * against src/ directly.
 */
export default {
  // Two workers, not jest's default of one per CPU core: turbo runs several
  // packages' suites at once, and a dozen workers in each is what ran the
  // machine out of memory (turbo.json, `concurrency`, has the numbers).
  maxWorkers: 2,
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' }, target: 'es2023' } }],
  },
};
