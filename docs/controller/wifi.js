const commandUuid = 'fb8c0004-7b3a-4d0c-a8d5-83f46571c901';
const resultUuid = 'fb8c0005-7b3a-4d0c-a8d5-83f46571c901';
const security = ['Open', 'WEP', 'WPA', 'WPA2', 'WPA/WPA2', 'WPA2 Enterprise', 'WPA3', 'WPA2/WPA3', 'WAPI', 'WPA3 Enterprise 192-bit'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function decodeScan(view) {
  if (view.byteLength < 8 || view.getUint8(0) !== 1 || view.getUint8(2) < 1 ||
      view.getUint8(2) > 4 || view.getUint8(7) > 32 || view.byteLength !== 8 + view.getUint8(7)) {
    throw new Error('Invalid Wi-Fi scan response.');
  }
  return {
    sequence: view.getUint8(1), kind: view.getUint8(2), count: view.getUint16(3, true),
    security: security[view.getUint8(5)] || `Unknown (${view.getUint8(5)})`,
    rssi: view.getInt8(6),
    ssid: new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + 8, view.getUint8(7))) || '(Hidden network)',
  };
}

export class WifiScanClient {
  constructor(client) { this.client = client; this.cancelled = false; }
  cancel() { this.cancelled = true; }
  check() {
    if (this.cancelled) throw new DOMException('Scan display cleared.', 'AbortError');
    if (!this.client.ready) throw new Error('Bluetooth disconnected during Wi-Fi scan.');
  }
  async io(action) {
    this.check();
    let timer;
    try {
      return await Promise.race([
        this.client.enqueueGatt(() => { this.check(); return action(); }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          this.client.disconnect();
          reject(new Error('Wi-Fi scan Bluetooth request timed out.'));
        }, 4000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async request(operation, index = 0) {
    const sequence = this.sequence = (this.sequence + 1) & 255;
    const bytes = new Uint8Array([1, sequence, operation, index & 255, index >> 8]);
    await this.io(() => this.command.writeValueWithResponse
      ? this.command.writeValueWithResponse(bytes) : this.command.writeValue(bytes));
    const deadline = Date.now() + 3000;
    do {
      const result = decodeScan(await this.io(() => this.result.readValue()));
      if (result.sequence === sequence) {
        if (result.kind === 4) throw new Error('ESP32 could not complete the Wi-Fi scan. Try again.');
        return result;
      }
      await pause(30);
    } while (Date.now() < deadline);
    throw new Error('ESP32 did not acknowledge the Wi-Fi scan request.');
  }
  async scan(onRow = () => {}) {
    try {
      this.command = await this.io(() => this.client.service.getCharacteristic(commandUuid));
      this.result = await this.io(() => this.client.service.getCharacteristic(resultUuid));
    } catch (error) {
      if (!this.client.ready || this.cancelled) throw error;
      throw new Error('Wi-Fi scan is unavailable on this board. Upload the updated firmware.');
    }
    this.sequence = decodeScan(await this.io(() => this.result.readValue())).sequence;
    let status = await this.request(1);
    const deadline = Date.now() + 20000;
    while (status.kind === 1) {
      if (Date.now() >= deadline) throw new Error('Wi-Fi scan timed out.');
      await pause(400);
      status = await this.request(2);
    }
    if (status.kind !== 2) throw new Error('Unexpected Wi-Fi scan status.');
    for (let index = 0; index < status.count; index++) {
      const ap = await this.request(3, index);
      this.check();
      if (ap.kind !== 3 || ap.count !== status.count) throw new Error('Wi-Fi scan results changed. Scan again.');
      onRow(ap);
    }
    return status.count;
  }
}

export function installWifi(document, registry) {
  const byId = id => document.getElementById(id);
  const select = byId('wifi-device');
  let active = null;
  function refresh() {
    const previous = select.value;
    select.replaceChildren();
    for (const row of registry.rows.values()) {
      if (!row.client?.ready) continue;
      const option = document.createElement('option');
      option.value = row.id; option.textContent = row.name;
      select.append(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    select.disabled = Boolean(active) || select.options.length === 0;
    byId('wifi-scan').disabled = Boolean(active) || select.options.length === 0;
  }
  byId('wifi-scan').addEventListener('click', async () => {
    const row = registry.rows.get(select.value);
    if (active || !row?.client?.ready) return;
    const scan = active = new WifiScanClient(row.client);
    byId('wifi-results').replaceChildren();
    byId('wifi-status').textContent = `Scanning from ${row.name}…`;
    refresh();
    try {
      const count = await scan.scan(ap => {
        const tr = document.createElement('tr');
        for (const value of [ap.ssid, ap.security, `${ap.rssi} dBm`]) {
          const td = document.createElement('td'); td.textContent = value; tr.append(td);
        }
        byId('wifi-results').append(tr);
      });
      if (!scan.cancelled) byId('wifi-status').textContent = `${row.name}: ${count} access point${count === 1 ? '' : 's'} found.`;
    } catch (error) {
      if (!scan.cancelled) byId('wifi-status').textContent = error.message || String(error);
    } finally { active = null; refresh(); }
  });
  byId('wifi-clear').addEventListener('click', () => {
    active?.cancel();
    byId('wifi-results').replaceChildren();
    byId('wifi-status').textContent = '';
  });
  refresh();
  return refresh;
}
