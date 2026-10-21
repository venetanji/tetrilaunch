#!/usr/bin/env node
// An allowlist, not a filtered copy of app/dist: future game assets cannot leak
// onto the apex simply because somebody adds a new public/ directory.
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'marketing/dist');
const marketingFiles = ['index.html', '404.html', 'support.html', 'sw.js', 'retire-pwa.js', '_headers'];
const publicFiles = [
  'favicon.svg', 'icons/apple-touch-icon.png',
  'fonts/fonts.css', 'fonts/OFL.txt', 'fonts/jetbrains-mono-variable.woff2',
  'fonts/orbitron-variable.woff2', 'fonts/press-start-2p-400.woff2',
  'fonts/rajdhani-500.woff2', 'fonts/rajdhani-600.woff2', 'fonts/rajdhani-700.woff2',
  'about/aim-arc.png', 'about/launch.png', 'about/stacked-bay.png',
  'about/workshop.png', 'about/contracts.png', 'about/menu.png', 'about/social-card.png',
];
const policyFiles = ['privacy.html', 'terms.html'];
// Resolve all inputs before replacing the last successful build.
for (const file of marketingFiles) readFileSync(resolve(root, 'marketing', file));
for (const file of [...publicFiles, ...policyFiles]) readFileSync(resolve(root, 'app/public', file));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
rmSync(output, { recursive: true, force: true });
function copy(base, file) {
  const destination = resolve(output, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, base, file), destination);
}
for (const file of marketingFiles) copy('marketing', file);
for (const file of publicFiles) copy('app/public', file);
for (const file of policyFiles) {
  // Keep the authoritative legal content; only the home link's label changes.
  const html = readFileSync(resolve(root, 'app/public', file), 'utf8')
    .replace('>Play Tetrilaunch</a>', '>Tetrilaunch home</a>')
    .replace('</head>', '  <script src="/retire-pwa.js" defer></script>\n  </head>');
  writeFileSync(resolve(output, file), html);
}
for (const file of ['index.html', '404.html', 'support.html', ...policyFiles]) {
  const path = resolve(output, file);
  const html = readFileSync(path, 'utf8').replace('</head>', `  <meta name="tetrilaunch-build" content="${revision}" />\n  </head>`);
  writeFileSync(path, html);
}
// Preserve the previously shared /about URL without serving the old beta/game CTA.
copyFileSync(resolve(output, 'index.html'), resolve(output, 'about.html'));
writeFileSync(resolve(output, 'build.json'), `${JSON.stringify({ artifact: 'marketing', revision }, null, 2)}\n`);
console.log(`Marketing-only artifact: ${output} (${marketingFiles.length + publicFiles.length + policyFiles.length + 2} files, ${revision})`);
