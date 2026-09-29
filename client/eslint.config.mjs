// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Type-aware lint, warn-only for now: a promise nobody awaits or catches, a
 * promise passed where a void callback is expected (an async onClick), a switch
 * that misses a union member.
 */
export default tseslint.config(
  { ignores: ['.next/**', '.next-e2e/**', 'coverage/**', 'node_modules/**', 'src/vendor/**', 'next-env.d.ts'] },
  // Directives in the code predate this config (e.g. for no-console, not enabled here).
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': 'warn',
    },
  },
);
