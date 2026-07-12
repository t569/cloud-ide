/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // This is the testing version of our tsconfig.json 'paths' map!
  moduleNameMapper: {
    '^@cloud-ide/shared(.*)$': '<rootDir>/../shared/index.ts',
  },
  clearMocks: true, // Crucial: wipes our fake Docker calls between tests
  // `data/` is RUNTIME state, not source: it holds the git worktrees of real sandboxes,
  // so a user's own project (its `src/App.test.js` and all) was being collected and run
  // as if it were ours. It failed on every run — a permanently red suite that hides
  // actual regressions.
  testPathIgnorePatterns: ['/node_modules/', '/data/', '/dist/'],
};