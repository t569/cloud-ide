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
  // Ignore compiled output directories
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  verbose: true,
};