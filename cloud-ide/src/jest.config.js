// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // frontend/ is "type": "module", so NodeNext emits ESM there — force CJS
  // for tests since Jest runs CommonJS.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', moduleResolution: 'node', ignoreDeprecations: '6.0', esModuleInterop: true, jsx: 'react-jsx' } }],
  },
  // Tells Jest to look for tests in the __tests__ folder or files ending in .test.ts
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  // Ignore compiled output directories. frontend/ is Vitest's (it needs
  // import.meta.env, which Jest's CJS runtime cannot provide) — run it with
  // `npm test -w frontend`. Without this, Jest collects those suites and every
  // one of them fails on `Cannot find module 'vitest'`.
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/frontend/'],
  // Env defaults (e.g. skip the real-docker egress kernel probe). See jest.env.js.
  setupFiles: ['<rootDir>/jest.env.js'],
  verbose: true,
};