// backend/src/__mocks__/index.node.js

// this is a manual mock so we dont execute compiled C/Rust code
module.exports = {
  bootSandbox: jest.fn(),
  pauseSandbox: jest.fn(),
  destroySandbox: jest.fn(),
  getSandboxStatus: jest.fn(),
  getSandboxIp: jest.fn(),
};