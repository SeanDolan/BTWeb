import test from 'node:test';
import assert from 'node:assert/strict';
import { latestRelease, installUpdates } from '../docs/controller/updates.js';

const commit = 'a'.repeat(40);
const entry = `releases/${commit}/controller.html`;
const release = { commit, entry, assets: [entry, `releases/${commit}/controller/app.js`] };

test('reload bypasses manifest cache and downloads the complete immutable release', async () => {
  const calls = [];
  const url = await latestRelease(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => release, arrayBuffer: async () => new ArrayBuffer(0) };
  }, new URL('https://example.test/BTWeb/'));
  assert.equal(calls[0].options.cache, 'no-store');
  assert.ok(calls[0].url.searchParams.has('reload'));
  assert.equal(calls.length, 3);
  assert.equal(url.pathname, '/BTWeb/' + entry);
  for (const call of calls.slice(1)) assert.equal(call.options.cache, 'reload');
});

test('missing release assets and invalid paths prevent navigation', async () => {
  await assert.rejects(latestRelease(async url => ({ ok: url.pathname.endsWith('version.json'), json: async () => release }),
    new URL('https://example.test/BTWeb/')), /not fully available/);
  await assert.rejects(latestRelease(async () => ({ ok: true, json: async () => ({ ...release, assets: [entry, '../outside'] }) }),
    new URL('https://example.test/BTWeb/')), /Invalid release/);
});

test('offline reload keeps the page open and lets the user retry', async () => {
  const elements = Object.fromEntries(['commit', 'reload-cache', 'reload-status'].map(id => [id, {
    addEventListener(type, callback) { this.click = callback; },
  }]));
  installUpdates({ getElementById: id => elements[id] }, { replace() { assert.fail('Navigated while offline'); } },
    async () => { throw new Error('Offline'); });
  await elements['reload-cache'].click();
  assert.equal(elements['reload-cache'].disabled, false);
  assert.match(elements['reload-status'].textContent, /saved boards are unchanged/);
});
