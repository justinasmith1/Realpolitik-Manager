/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./apps/*/tsconfig.json', './packages/*/tsconfig.json'],
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier', // Must be last – disables rules that conflict with Prettier
  ],
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: ['./apps/*/tsconfig.json', './packages/*/tsconfig.json'],
      },
      node: true,
    },
  },
  rules: {
    /* TypeScript */
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-non-null-assertion': 'error',

    /* Imports */
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-duplicates': 'error',
    'import/no-cycle': 'error',

    /* General */
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always'],
  },
  overrides: [
    {
      // Denegado por defecto (ADR-0006 §5): las rutas se declaran con crearRouter() (negocio, con
      // autorizar(PERMISO) obligatorio) o crearRouterPublico() (/health y /auth). Un Router suelto
      // de express podría montar rutas sin permiso.
      files: ['apps/backend/src/**/*.ts'],
      excludedFiles: ['apps/backend/src/modules/auth/autorizacion.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'express',
                importNames: ['Router'],
                message: 'Usá crearRouter() o crearRouterPublico() de modules/auth/autorizacion.',
              },
            ],
          },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.name='express'][property.name='Router']",
            message: 'Usá crearRouter() o crearRouterPublico() de modules/auth/autorizacion.',
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.js', '*.cjs', '*.mjs', 'coverage/'],
};
