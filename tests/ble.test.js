import test from 'node:test';
import assert from 'node:assert/strict';
import { BTWebClient, decodeState } from '../docs/controller/ble.js';

test('advertisement rediscovery waits for the saved ID and stops watching afterwards', async () => {
  const client = new BTWebClient(null);
  const device = new EventTarget();
  device.id = 'saved';
  let signal;
  device.watchAdvertisements = async options => { signal = options.signal; };
  let done = false;
  const waiting = client.waitForAdvertisement(device, 100).then(() => { done = true; });
  const wrong = new Event('advertisementreceived'); wrong.device = { id: 'other' };
  device.dispatchEvent(wrong);
  await Promise.resolve();
  assert.equal(done, false);
  const right = new Event('advertisementreceived'); right.device = device;
  device.dispatchEvent(right);
  await waiting;
  assert.equal(signal.aborted, true);
});

test('advertisement denial and cancellation reject cleanly', async () => {
  const client = new BTWebClient(null);
  const device = new EventTarget();
  device.watchAdvertisements = async () => { throw 2; };
  await assert.rejects(client.waitForAdvertisement(device), error => error === 2);
  device.watchAdvertisements = async () => {};
  const waiting = client.waitForAdvertisement(device);
  client.disconnect();
  await assert.rejects(waiting, /cancelled/);
});

test('advertisement silence times out and aborts watching', async () => {
  const client = new BTWebClient(null);
  const device = new EventTarget();
  let signal;
  device.watchAdvertisements = async options => { signal = options.signal; };
  await assert.rejects(client.waitForAdvertisement(device, 10), /No advertisement/);
  assert.equal(signal.aborted, true);
});

function state(sequence, result = 0) {
  return new DataView(Uint8Array.from([1, sequence, result, 255, 0, 0, 1, 2, 1, 0]).buffer);
}

test('validates wire version, length, reserved fields and overflow byte order', () => {
  assert.equal(decodeState(state(7)).dropped, 258);
  assert.deepEqual(decodeState(state(7)).rgb, [255, 0, 0]);
  assert.throws(() => decodeState(new DataView(new ArrayBuffer(9))));
  const invalid = state(1); invalid.setUint8(0, 2);
  assert.throws(() => decodeState(invalid));
  invalid.setUint8(0, 1); invalid.setUint8(9, 1);
  assert.throws(() => decodeState(invalid));
});

test('requires matching application acknowledgement, not just successful GATT write', async () => {
  const client = new BTWebClient(null);
  client.ready = true;
  client.command = { writeValueWithResponse: async bytes => {
    assert.deepEqual([...bytes], [1, 1, 1, 255, 0, 0]);
  } };
  const operation = client.send(1, [255, 0, 0]);
  client.accept(state(99));
  assert.ok(client.pending);
  await assert.rejects(client.send(1, [0, 0, 0]), /wait/);
  client.accept(state(1));
  assert.equal((await operation).sequence, 1);
  assert.equal(client.pending, null);
});

test('disconnect rejects outstanding operation and resets the connection', async () => {
  const client = new BTWebClient(null);
  client.ready = true;
  client.command = { writeValueWithResponse: async () => {} };
  const operation = client.send(1, [0, 255, 0]);
  client.disconnect();
  await assert.rejects(operation, /disconnected/);
  assert.equal(client.ready, false);
});

test('board rejection is not reported as successful colour change', async () => {
  const client = new BTWebClient(null);
  client.ready = true;
  client.command = { writeValueWithResponse: async () => {} };
  const operation = client.send(1, [0, 0, 255]);
  client.accept(state(1, 3));
  await assert.rejects(operation, /unavailable/);
});

test('falls back to older writeValue API and wraps sequence numbers', async () => {
  const client = new BTWebClient(null);
  client.ready = true;
  client.sequence = 255;
  client.command = { writeValue: async bytes => client.accept(state(bytes[1])) };
  assert.equal((await client.send(2, [0, 0, 0])).sequence, 0);
});

test('failed service discovery disconnects the partially connected device', async () => {
  let disconnected = false;
  const device = new EventTarget();
  device.gatt = {
    connected: true,
    disconnect() { disconnected = true; },
    async connect() { return { async getPrimaryService() { throw new Error('Missing service'); } }; },
  };
  const client = new BTWebClient({ requestDevice: async () => device });
  await assert.rejects(client.connect(), /Missing service/);
  assert.ok(disconnected);
  assert.equal(client.device, null);
});

test('synchronous Bluetooth write failure rejects cleanly without an unhandled promise', async () => {
  const client = new BTWebClient(null);
  client.ready = true;
  client.command = { writeValueWithResponse() { throw new Error('Write failed'); } };
  await assert.rejects(client.send(1, [0, 0, 0]), /Write failed/);
  assert.equal(client.ready, false);
});
