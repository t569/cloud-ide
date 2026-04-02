// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Tells Jest to look for tests in the __tests__ folder or files ending in .test.ts
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  // Ignore compiled output directories
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  verbose: true,
};