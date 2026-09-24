// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'eslint.config.mjs', 'jest.config.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // La capa de dominio no puede conocer frameworks ni adaptadores: es la
    // regla de dependencia de la arquitectura hexagonal, verificada por el linter.
    files: ['src/contexts/*/domain/**/*.ts', 'src/shared/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'El dominio no puede depender de Nest.' },
            { group: ['@aws-sdk/*'], message: 'El dominio no puede depender del SDK de AWS.' },
            { group: ['**/infrastructure/**'], message: 'El dominio no apunta hacia adentro.' },
            { group: ['**/application/**'], message: 'El dominio no conoce sus casos de uso.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
  prettier,
);
