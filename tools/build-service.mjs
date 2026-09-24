// Bundles a service (run from its directory) into dist/index.mjs: one ES module with every
// dependency inlined, so the runtime needs only Node. Usage:
//   node ../../tools/build-service.mjs [--with-migrations]
// --with-migrations copies packages/db/migrations to dist/migrations for services that migrate
// on startup (hosts without a separate release step).
import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(process.cwd(), 'dist');

rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: [join(process.cwd(), 'src/index.ts')],
  outfile: join(outdir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  // Optional native driver that pg only tries to load when asked to.
  external: ['pg-native'],
  // Some bundled CommonJS dependencies call require(); give ES modules a working one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

if (process.argv.includes('--with-migrations')) {
  cpSync(join(repoRoot, 'packages/db/migrations'), join(outdir, 'migrations'), { recursive: true });
}
