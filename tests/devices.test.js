import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceRegistry, STORAGE_KEY } from '../docs/devices.js';
import { UUID } from '../docs/ble.js';

function board(id, name = 'MNQ-BT-0001') {
  const device = new EventTarget();
  Object.assign(device, { id, name, writes: [], connections: 0 });
  const characteristic = new EventTarget();
  let rgb = [0, 255, 0];
  let sequence = 0;
  const value = () => new DataView(Uint8Array.from([1, sequence, 0, ...rgb, 1, 0, 0, 0]).buffer);
  characteristic.startNotifications = async () => characteristic;
  characteristic.readValue = async () => value();
  const command = { async writeValueWithResponse(bytes) {
    device.writes.push([...bytes]);
    sequence = bytes[1];
    if (bytes[2] === 1) rgb = [...bytes.slice(3)];
    characteristic.value = value();
    characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
  } };
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; device.connections++; return this; },
    disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
    async getPrimaryService(uuid) {
      assert.equal(uuid, UUID.service);
      return { async getCharacteristic(id) { return id === UUID.command ? command : characteristic; } };
    },
  };
  return device;
}

function storage(entries = []) {
  let data = JSON.stringify(entries);
  return {
    getItem(key) { assert.equal(key, STORAGE_KEY); return data; },
    setItem(key, value) { assert.equal(key, STORAGE_KEY); data = value; },
  };
}

test('restores multiple authorised boards without a picker; same names remain separate', async () => {
  const a = board('a'); const b = board('b');
  const saved = storage();
  const registry = new DeviceRegistry({ getDevices: async () => [a, b], requestDevice() { assert.fail('Picker opened'); } }, saved);
  await registry.restore();
  assert.equal(registry.rows.size, 2);
  for (const row of registry.rows.values()) assert.equal(row.client.ready, true);
  assert.equal(JSON.parse(saved.getItem(STORAGE_KEY)).length, 2);
  const rowA = registry.rows.get('a'); const rowB = registry.rows.get('b');
  await Promise.all([registry.colour(rowA, [255, 0, 0]), registry.colour(rowB, [0, 0, 255])]);
  assert.deepEqual(a.writes.at(-1).slice(2), [1, 255, 0, 0]);
  assert.deepEqual(b.writes.at(-1).slice(2), [1, 0, 0, 255]);
  await registry.colour(rowA, [0, 0, 0]);
  assert.deepEqual(rowA.state.rgb, [0, 0, 0]);
  assert.deepEqual(rowB.state.rgb, [0, 0, 255]);
});

test('manual disconnect persists across resume and page reload until explicit Connect', async () => {
  const a = board('a'); const saved = storage();
  const bluetooth = { getDevices: async () => [a] };
  const first = new DeviceRegistry(bluetooth, saved);
  await first.restore();
  first.disconnect(first.rows.get('a'));
  await first.restore();
  const next = new DeviceRegistry(bluetooth, saved);
  await next.restore();
  assert.equal(a.connections, 1);
  await next.connect(next.rows.get('a'));
  assert.equal(a.connections, 2);
});

test('a missing board times out independently and late connection is closed', async () => {
  const a = board('a'); const b = board('b');
  let finish;
  a.gatt.connect = () => new Promise(resolve => { finish = () => { a.gatt.connected = true; resolve(a.gatt); }; });
  const registry = new DeviceRegistry({ getDevices: async () => [a, b] }, storage(), () => {}, 30);
  await registry.restore();
  assert.match(registry.rows.get('a').message, /unavailable/);
  assert.equal(registry.rows.get('b').client.ready, true);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.gatt.connected, false);
  assert.equal(registry.rows.get('a').state, null);
});

test('unavailable getDevices preserves saved rows without opening a picker', async () => {
  const registry = new DeviceRegistry({ requestDevice() { assert.fail('Picker opened'); } }, storage([{ id: 'a', name: 'Saved board' }]));
  await registry.restore();
  assert.equal(registry.rows.get('a').name, 'Saved board');
  assert.equal(registry.rows.get('a').client, null);
});

test('denied or corrupt storage does not prevent live connections', async () => {
  const a = board('a');
  const registry = new DeviceRegistry({ getDevices: async () => [a] }, {
    getItem: () => '{broken', setItem() { throw new Error('Storage denied'); },
  });
  await registry.restore();
  assert.equal(registry.rows.get('a').client.ready, true);
});

test('repeated restore does not duplicate active connections or replace connected names', async () => {
  const a = board('a');
  const registry = new DeviceRegistry({ getDevices: async () => [a] }, storage());
  await Promise.all([registry.restore(), registry.restore()]);
  a.name = 'MNQ-BT-0002';
  await registry.restore();
  assert.equal(a.connections, 1);
  assert.equal(registry.rows.get('a').name, 'MNQ-BT-0001');
});

test('a stale restored name cannot overwrite the saved name; connection saves the fresh name', async () => {
  const a = board('a', 'BTWeb-C3');
  const saved = storage([{ id: 'a', name: 'MNQ-BT-0001', autoConnect: false }]);
  const registry = new DeviceRegistry({ getDevices: async () => [a] }, saved);
  await registry.restore();
  assert.equal(registry.rows.get('a').name, 'MNQ-BT-0001');
  assert.match(registry.rows.get('a').message, /paused/);
  const connect = a.gatt.connect.bind(a.gatt);
  a.gatt.connect = async () => { a.name = 'MNQ-BT-0002'; return connect(); };
  await registry.connect(registry.rows.get('a'));
  assert.equal(JSON.parse(saved.getItem(STORAGE_KEY))[0].name, 'MNQ-BT-0002');
});

test('restoration failures are visible instead of silently looking disconnected', async () => {
  const registry = new DeviceRegistry({ getDevices: async () => { throw new Error('Permission denied'); } },
    storage([{ id: 'a', name: 'Saved board' }]));
  await registry.restore();
  assert.match(registry.rows.get('a').message, /Permission denied/);
});

test('a timed-out connection completing after a retry does not disconnect the new client', async () => {
  const a = board('a');
  const normalConnect = a.gatt.connect.bind(a.gatt);
  let finish;
  a.gatt.connect = () => new Promise(resolve => { finish = () => resolve(a.gatt); });
  const registry = new DeviceRegistry({ getDevices: async () => [a] }, storage(), () => {}, 20);
  await registry.restore();
  a.gatt.connect = normalConnect;
  await registry.connect(registry.rows.get('a'));
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.gatt.connected, true);
  assert.equal(registry.rows.get('a').client.ready, true);
});

test('page renders five cells per board and a single swatch click controls only that row', async () => {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.attributes = {}; }
    append(...children) { this.children.push(...children); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    setAttribute(key, value) { this.attributes[key] = value; }
  }
  const elements = Object.fromEntries(['devices', 'empty', 'connect', 'message'].map(id => [id, new Element()]));
  const a = board('a'); const b = board('b');
  const previous = Object.fromEntries(['document', 'window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: id => elements[id], createElement: () => new Element(), addEventListener() {},
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true, localStorage: storage() } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth: { getDevices: async () => [a, b] } } });
  try {
    await import('../docs/app.js');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.devices.children.length, 2);
    const row = elements.devices.children[1];
    assert.equal(row.children.length, 5);
    assert.equal(row.children[0].children[0].textContent, b.name);
    const off = row.children[4].children[0];
    assert.equal(off.disabled, false);
    off.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(b.writes.at(-1).slice(2), [1, 0, 0, 0]);
    assert.equal(a.writes.length, 1); // Initial status request only.
    assert.equal(off.attributes['aria-pressed'], 'true');
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
