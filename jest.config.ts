import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  // The HTTP suites boot a Nest application; under coverage on a loaded CI
  // runner that alone can pass the 5 s default and fail a correct test.
  testTimeout: 20_000,
  testRegex: '.*\.spec\.ts$',
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  clearMocks: true,
  restoreMocks: true,

  collectCoverageFrom: [
    'src/**/*.ts',
    // Process bootstrap: covered end-to-end, not by unit tests.
    '!src/main.ts',
    // Nest modules: dependency injection wiring, no logic of their own.
    '!src/**/*.module.ts',
    // Ports and types: interfaces that vanish at compile time.
    '!src/**/*.port.ts',
    '!src/**/*.d.ts',
    // Test helpers are test code. Counting them inflates the number with
    // fixtures that exist only to support the tests measuring it.
    '!src/**/__fixtures__/**',
    '!src/**/*.fixture.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
};

export default config;
