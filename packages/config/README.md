# @aperture/config

Shared configuration. Today: `tsconfig.base.json`, which every package and app extends.

The compiler flags follow [plan/conventions](../../plan/conventions/README.md#typescript). Code is always bundled (tsup for services, Next.js for the web app) or run through tsx/Vitest, so the base uses `module: preserve` with bundler resolution and never emits.

ESLint and Prettier configuration live at the repository root (`eslint.config.js`, `.prettierrc.json`) because they apply to every workspace.
