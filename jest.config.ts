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
    // Arranque del proceso: se cubre end-to-end, no con pruebas unitarias.
    '!src/main.ts',
    // Modulos de Nest: cableado de inyeccion de dependencias, sin logica propia.
    '!src/**/*.module.ts',
    // Puertos y tipos: interfaces que desaparecen al compilar.
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
