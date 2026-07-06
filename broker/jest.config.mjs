export default {
  displayName: 'broker',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.mjs'],
  transform: {},
  injectGlobals: false,
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30_000,
  slowTestThreshold: 10,
  openHandlesTimeout: 5_000,
  waitForUnhandledRejections: true,
};
