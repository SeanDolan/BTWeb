import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const commit = process.env.GITHUB_SHA || execFileSync('git', ['-c', `safe.directory=${fileURLToPath(root).replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full Git commit SHA is required.');
const output = new URL('.site/', root);
const prefix = `releases/${commit}/`;
const release = new URL(prefix, output);
await mkdir(release, { recursive: true });
const files = ['controller.html', 'style.css', 'manifest.webmanifest', 'controller/app.js',
  'controller/ble.js', 'controller/devices.js', 'controller/build.js', 'controller/updates.js'];
for (const path of files) {
  const target = new URL(path, release);
  await mkdir(new URL('./', target), { recursive: true });
  await cp(new URL(`docs/${path}`, root), target);
}
await writeFile(new URL('controller/build.js', release),
  `export const COMMIT = '${commit}';\nexport const SITE_ROOT = new URL('../../../', import.meta.url);\n`);
const html = await readFile(new URL('docs/controller.html', root), 'utf8');
const entry = html.replaceAll('href="./', `href="./${prefix}`).replaceAll('src="./', `src="./${prefix}`);
await writeFile(new URL('index.html', output), entry);
await writeFile(new URL('controller.html', output), entry);
await writeFile(new URL('.nojekyll', output), '');
const assets = files.map(path => prefix + path);
await writeFile(new URL('version.json', output), JSON.stringify({ commit, entry: prefix + 'controller.html', assets }));
let worker = await readFile(new URL('docs/sw.js', root), 'utf8');
worker = worker.replace('btweb-controller-development:', `btweb-controller-${commit}:`)
  .replace(/const ASSETS = .*;/, `const ASSETS = ${JSON.stringify(['./', './index.html', './controller.html', ...assets.map(path => './' + path)])};`);
await writeFile(new URL('sw.js', output), worker);
console.log(`Built controller commit ${commit}`);
