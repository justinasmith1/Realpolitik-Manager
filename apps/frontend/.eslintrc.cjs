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
    // Base UI pinta Checkbox como un control con rol checkbox y un input oculto. Sin este
    // mapa, jsx-a11y no ve la etiqueta hermana (`htmlFor`) como asociada a ese control.
    'jsx-a11y': {
      components: {
        Checkbox: 'input',
      },
    },
  },
};
