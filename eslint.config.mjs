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
    // The domain layer must know nothing about frameworks or adapters. This is
    // the hexagonal dependency rule, enforced by the linter rather than by convention.
    files: ['src/contexts/*/domain/**/*.ts', 'src/shared/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'The domain must not depend on Nest.' },
            { group: ['@aws-sdk/*'], message: 'The domain must not depend on the AWS SDK.' },
            { group: ['**/infrastructure/**'], message: 'Dependencies point inwards: the domain must not reach into infrastructure.' },
            { group: ['**/application/**'], message: 'The domain must not know about its own use cases.' },
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
