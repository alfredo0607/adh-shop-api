import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
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
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
};

export default config;
