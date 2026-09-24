// Fails if any source file outside legacy/ imports from legacy/.
// The archived hackathon code is reference material and must never become a dependency again.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.(c|m)?(j|t)sx?$/.test(file) && !file.startsWith('legacy/'));

const importFromLegacy = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:(?:\.\.?\/)+|\/)?(?:[^'"]*\/)?legacy\//;

const offenders = files.filter((file) => importFromLegacy.test(readFileSync(file, 'utf8')));

if (offenders.length > 0) {
  process.stderr.write(`Files importing from legacy/:\n${offenders.map((file) => `  ${file}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`No imports from legacy/ (${files.length} files checked).\n`);
