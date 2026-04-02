/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // This is the testing version of our tsconfig.json 'paths' map!
  moduleNameMapper: {
    '^@cloud-ide/shared(.*)$': '<rootDir>/../shared/index.ts',
  },
  clearMocks: true, // Crucial: wipes our fake Docker calls between tests
};