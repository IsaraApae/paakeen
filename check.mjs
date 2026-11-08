// Syntax check with no build step: the worker and scripts through node --check, and every inline <script> of the web app.
//   node check.mjs (npm run check also bundles the worker with wrangler's dry run)
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const files = ['src/index.js', 'public/report.js', 'public/categories.js', 'test.mjs', 'seed.mjs', 'check.mjs'];
for (const file of files) execFileSync(process.execPath, ['--check', file], {stdio: 'inherit'});
let n = 0;
for (const [, attrs, code] of readFileSync('public/index.html', 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=/.test(attrs)) new Script(code, {filename: `public/index.html, inline script ${++n}`});  // throws on a syntax error
}
console.log(`syntax ok: ${files.length} files and ${n} inline scripts`);
