module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Tells Jest to look for files ending in .test.ts or .spec.ts
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'], 
};