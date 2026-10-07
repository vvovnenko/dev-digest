// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Type-aware lint, warn-only for now: the rules that catch what tsc can't in a
 * fire-and-forget server — a promise nobody awaits or catches, a promise passed
 * where a void callback is expected, a switch that misses a union member.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'clones/**', 'node_modules/**', 'src/vendor/**', 'src/db/migrations/**'] },
  // Directives in the code predate this config (e.g. for no-console, not enabled here).
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      // src + tests + vitest.config.ts (the plain tsconfig covers src only).
      parserOptions: { project: ['./tsconfig.test.json'], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': 'warn',
    },
  },
);
