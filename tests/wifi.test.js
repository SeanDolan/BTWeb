import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeScan, WifiScanClient, installWifi } from '../docs/controller/wifi.js';

function packet(sequence, kind, ssid = '', auth = 3, rssi = -67, count = 1) {
  const name = new TextEncoder().encode(ssid);
  return new DataView(Uint8Array.from([1, sequence, kind, count & 255, count >> 8, auth, rssi & 255, name.length, ...name]).buffer);
}
function client(ssid = 'Test network') {
  let sequence = 0; let operation = 0;
  const writes = [];
  const result = { readValue: async () => packet(sequence, operation === 3 ? 3 : operation ? 2 : 4, operation === 3 ? ssid : '') };
  const command = { writeValueWithResponse: async bytes => { writes.push([...bytes]); sequence = bytes[1]; operation = bytes[2]; } };
  return { writes, result, ready: true, enqueueGatt: action => Promise.resolve().then(action),
    disconnect() { this.ready = false; },
    service: { getCharacteristic: async uuid => uuid.startsWith('fb8c0004') ? command : result } };
}

test('scan decoding preserves UTF-8, signed RSSI, security and full count', () => {
  const decoded = decodeScan(packet(4, 3, 'Café', 7, -92, 300));
  assert.equal(decoded.ssid, 'Café');
  assert.equal(decoded.rssi, -92);
  assert.equal(decoded.security, 'WPA2/WPA3');
  assert.equal(decoded.count, 300);
  assert.equal(decodeScan(packet(1, 3, '', 0)).ssid, '(Hidden network)');
  assert.equal(decodeScan(packet(1, 3, '', 0)).security, 'Open');
  assert.throws(() => decodeScan(packet(1, 3, 'a'.repeat(33))));
  assert.throws(() => decodeScan(new DataView(new ArrayBuffer(7))));
});

test('scan commands use a separate characteristic and return each AP without changing LED state', async () => {
  const board = client(); const rows = [];
  assert.equal(await new WifiScanClient(board).scan(row => rows.push(row)), 1);
  assert.deepEqual(board.writes.map(bytes => bytes[2]), [1, 3]);
  assert.equal(rows[0].ssid, 'Test network');
  assert.equal(board.ready, true);
});

test('clear cancels further result delivery without disconnecting BLE', async () => {
  const board = client();
  const scan = new WifiScanClient(board);
  const original = board.result.readValue;
  board.result.readValue = async () => { scan.cancel(); return original(); };
  await assert.rejects(scan.scan(() => assert.fail('Result after Clear')), { name: 'AbortError' });
  assert.equal(board.ready, true);
});

test('older firmware reports missing scan support while keeping BLE connected', async () => {
  const board = client();
  board.service.getCharacteristic = async () => { throw new Error('No characteristic'); };
  await assert.rejects(new WifiScanClient(board).scan(), /updated firmware/);
  assert.equal(board.ready, true);
});

test('Wi-Fi table targets the selected board and Clear removes all rows', async () => {
  class Element {
    constructor() { this.children = []; this.value = ''; }
    append(...children) { this.children.push(...children); if (!this.value && children[0]?.value) this.value = children[0].value; }
    replaceChildren() { this.children = []; this.value = ''; }
    get options() { return this.children; }
    addEventListener(type, action) { this[type] = action; }
  }
  const ids = ['wifi-device', 'wifi-scan', 'wifi-clear', 'wifi-results', 'wifi-status'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const a = client('First'); const b = client('<script>not HTML</script>');
  const registry = { rows: new Map([['a', { id: 'a', name: 'A', client: a }], ['b', { id: 'b', name: 'B', client: b }]]) };
  installWifi({ getElementById: id => elements[id], createElement: () => new Element() }, registry);
  elements['wifi-device'].value = 'b';
  await elements['wifi-scan'].click();
  assert.equal(a.writes.length, 0);
  const cells = elements['wifi-results'].children[0].children;
  assert.deepEqual(cells.map(cell => cell.textContent), ['<script>not HTML</script>', 'WPA2', '-67 dBm']);
  elements['wifi-clear'].click();
  assert.equal(elements['wifi-results'].children.length, 0);
  assert.equal(b.ready, true);
});
