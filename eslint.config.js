import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'diagnostics/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // Browser code served by GitHub Pages; schedule.js and i18n.js are also imported by tests.
    files: ['docs/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
];
