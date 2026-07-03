/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Map @noble/hashes ESM imports to CJS versions
    '^@noble/hashes/(.*)$': '@noble/hashes/$1',
  },
  // @noble/hashes ships as ESM — ts-jest must transform it
  transformIgnorePatterns: [
    'node_modules/(?!(@noble)/)',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: true,
        esModuleInterop: true,
      },
    }],
    // Transform ESM packages from node_modules
    '^.+\\.js$': ['ts-jest', {
      tsconfig: {
        strict: false,
        allowJs: true,
        esModuleInterop: true,
      },
    }],
  },
  testTimeout: 60000,
  extensionsToTreatAsEsm: [],
};
