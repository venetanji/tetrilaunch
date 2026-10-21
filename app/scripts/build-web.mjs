import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
if (process.env.CF_PAGES === '1') {
  // Existing Pages projects build from app/ and publish app/dist. Keep that
  // integration on the same allowlist as the Worker, without a dashboard edit.
  execFileSync(process.execPath, [
    fileURLToPath(new URL('../../scripts/build-marketing.mjs', import.meta.url)), '--pages',
  ], { cwd: app, stdio: 'inherit' });
} else {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this build with npm run build.');
  execFileSync(process.execPath, [npmCli, 'run', 'build:game'], { cwd: app, stdio: 'inherit' });
}
