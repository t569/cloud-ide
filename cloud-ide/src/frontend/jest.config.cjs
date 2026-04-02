// frontend/jest.config.cjs
module.exports = {
  preset: 'ts-jest',
  // Use 'jsdom' if you are testing React components, but 'node' is fine for our pure TS classes
  testEnvironment: 'node', 
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};