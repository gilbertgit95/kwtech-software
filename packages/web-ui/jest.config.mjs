/**
 * Jest 30 + @swc/jest, as every package here does — added with the tone engine,
 * the first code in this package whose behaviour a script cannot check.
 *
 * `moduleNameMapper` strips the '.js' NodeNext imports carry, so the suite runs
 * against src/ directly.
 */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' }, target: 'es2023' } }],
  },
};
