/**
 * Extiende la configuración raíz (cascada de ESLint) solo con lo propio del
 * frontend: entorno browser, React, Hooks y accesibilidad en JSX.
 *
 * @type {import("eslint").Linter.Config}
 */
module.exports = {
  env: { browser: true },
  extends: [
    'plugin:react/recommended',
    'plugin:react/jsx-runtime', // JSX transform moderno: no exige `import React`
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  settings: {
    react: { version: 'detect' },
  },
};
