import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../docs/sw.js', import.meta.url), 'utf8');
function worker(online = true) {
  const handlers = {};
  const entries = new Map();
  const scope = 'https://example.github.io/BTWeb/';
  const cache = {
    async addAll(urls) {
      assert.ok(online);
      for (const url of urls) entries.set(url, { url, cached: true });
    },
    async match(request) {
      const url = new URL(typeof request === 'string' ? request : request.url);
      url.search = '';
      return entries.get(url.href);
    },
  };
  vm.runInNewContext(source, {
    URL, Promise,
    self: {
      registration: { scope }, location: { origin: 'https://example.github.io' },
      clients: { async claim() {} },
      addEventListener(type, callback) { handlers[type] = callback; },
    },
    caches: { async open(name) { assert.ok(name.includes(scope)); return cache; } },
    async fetch() { throw new Error('Network unavailable'); },
  });
  return { handlers, entries, scope };
}

test('installs every controller asset and serves the page with network unavailable', async () => {
  const { handlers, entries, scope } = worker();
  let installation;
  handlers.install({ waitUntil(promise) { installation = promise; } });
  await installation;
  assert.equal(entries.size, 7);
  for (const file of ['', 'index.html', 'app.js', 'ble.js', 'devices.js', 'style.css', 'manifest.webmanifest']) {
    let response;
    handlers.fetch({ request: { method: 'GET', url: scope + file }, respondWith(promise) { response = promise; } });
    assert.equal((await response).cached, true);
  }
});

test('cache readiness detects missing assets', async () => {
  const { handlers, entries, scope } = worker();
  let installation;
  handlers.install({ waitUntil(promise) { installation = promise; } });
  await installation;
  entries.delete(scope + 'ble.js');
  let check;
  let ready;
  handlers.message({ data: { type: 'CHECK_CACHE' }, ports: [{ postMessage(data) { ready = data.ready; } }], waitUntil(promise) { check = promise; } });
  await check;
  assert.equal(ready, false);
});

test('does not intercept other repositories or cross-origin requests', () => {
  const { handlers } = worker();
  for (const url of ['https://example.github.io/another/', 'https://other.test/BTWeb/']) {
    handlers.fetch({ request: { method: 'GET', url }, respondWith() { assert.fail('Unexpected interception'); } });
  }
});
