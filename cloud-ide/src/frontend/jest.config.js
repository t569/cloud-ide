// frontend/jest.config.cjs
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // This is the testing version of our tsconfig.json 'paths' map!
  moduleNameMapper: {
    '^@cloud-ide/shared$': '<rootDir>/../shared/index.ts',
    '^@cloud-ide/shared/(.*)$': '<rootDir>/../shared/$1',
  },
  clearMocks: true, // Crucial: wipes our fake Docker calls between tests
};