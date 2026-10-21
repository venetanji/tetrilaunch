import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
test('marketing build is isolated, local-only and has no playable game or download bypass', () => {
  assert.ok(existsSync(`${root}scripts/build-marketing.mjs`), 'separate marketing build exists');
  execFileSync(process.execPath, ['scripts/build-marketing.mjs'], { cwd: root });
  const files = readdirSync(`${root}marketing/dist`, { recursive: true });
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('sw.js'));
  assert.ok(files.includes('retire-pwa.js'));
  assert.ok(files.includes('build.json'));
  assert.ok(!files.some(f => /^(assets|audio|desktop|src)(\/|$)|manifest\.webmanifest|registerSW/.test(f)));
  const html = readFileSync(`${root}marketing/dist/index.html`, 'utf8');
  assert.match(html, /Store pages/);
  assert.doesNotMatch(html, /github\.com\/venetanji\/tetrilaunch\/releases|Play free|Play now|STEAM_STORE_URL/);
  assert.doesNotMatch(html, /<(script|iframe)[^>]+(?:src="https?:|type="module")/);
  assert.equal(JSON.parse(readFileSync(`${root}marketing/dist/build.json`)).artifact, 'marketing');
});
test('marketing support explains retired browser play without inventing purchase migration', () => {
  const html = readFileSync(`${root}marketing/dist/support.html`, 'utf8');
  assert.doesNotMatch(html, /on phones, tablets and in the browser|On the web, open/);
  assert.match(html, /Previous browser players/);
  assert.match(html, /not automatically transferred/);
  assert.match(html, /mailto:gio@shicheng\.com\.hk/);
  assert.match(html, /In the iOS or Android app/);
});
test('Pages builds from app emit the marketing artifact instead of the full game', () => {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: `${root}app`,
    env: { ...process.env, CF_PAGES: '1' },
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });
  const files = readdirSync(`${root}app/dist`, { recursive: true });
  assert.ok(files.includes('build.json'), 'Pages output identifies the marketing artifact');
  assert.equal(JSON.parse(readFileSync(`${root}app/dist/build.json`)).artifact, 'marketing');
  assert.ok(!files.some(f => /^(assets|audio)(\/|$)|manifest\.webmanifest|registerSW/.test(f)),
    'Pages output must not contain playable game assets or its PWA');
  const html = readFileSync(`${root}app/dist/index.html`, 'utf8');
  assert.match(html, /Store pages/);
  assert.doesNotMatch(html, /<script[^>]+type="module"|rel="manifest"/);
});
