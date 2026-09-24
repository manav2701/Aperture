import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Rules that encode plan/conventions "anti-slop" decisions. Keep messages actionable.
const restrictedSyntax = [
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      'Math.random is not allowed: use node:crypto for anything security-relevant, and never generate fake data.',
  },
  {
    selector: 'CallExpression[callee.name=/^(alert|confirm|prompt)$/]',
    message: 'Use the dialog and toast components instead of browser dialogs.',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'Rendering raw HTML is not allowed (XSS).',
  },
];

export default defineConfig(
  {
    ignores: [
      'legacy/**',
      '.semgrep/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.node,
    },
    rules: {
      'no-console': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Tests may print benchmark numbers with console.info; nothing else.
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: { 'no-console': ['error', { allow: ['info'] }] },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web' } },
    languageOptions: { globals: globals.browser },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
