/**
 * Jest 30 + @swc/jest, as every package here does.
 *
 * `moduleNameMapper` is the load-bearing line: the source is NodeNext, so every
 * relative import carries a '.js' that does not exist before a build. Stripping
 * it lets the suite run against src/ directly — a test that needed `tsc` first
 * would stop being run.
 *
 * Decorators are on because the server adapter is Nest and its classes do not
 * parse without them. `emitDecoratorMetadata` for the same reason tsconfig sets
 * it: DI reads `design:paramtypes` from it, and the surface-coverage suite reads
 * the resolver's own operation names back out.
 */
export default {
  // The surface-coverage suite reads decorator metadata, which needs the
  // polyfill loaded before the resolver class is evaluated.
  setupFiles: ['reflect-metadata'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          // `tsx` since the web descriptor landed: `react/module.tsx` renders
          // its route adapter rather than calling it, and a suite that could
          // not parse JSX could not assert what the module contributes.
          parser: { syntax: 'typescript', tsx: true, decorators: true },
          transform: { decoratorMetadata: true, legacyDecorator: true },
          target: 'es2023',
        },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts', '!src/react/**'],
};
