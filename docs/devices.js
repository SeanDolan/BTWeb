import { BTWebClient, UUID } from './ble.js';

export const STORAGE_KEY = 'btweb.devices.v1';
export const REMOVED_KEY = 'btweb.removedDevices.v1';

// Browser-scoped IDs identify boards; names are display labels only.
export class DeviceRegistry {
  constructor(bluetooth, storage, changed = () => {}, connectionTimeout = 12000) {
    this.bluetooth = bluetooth;
    this.storage = storage;
    this.changed = changed;
    this.connectionTimeout = connectionTimeout;
    this.rows = new Map();
    this.removed = new Set();
    try {
      const removed = JSON.parse(storage?.getItem(REMOVED_KEY) || '[]');
      if (Array.isArray(removed)) this.removed = new Set(removed.filter(id => typeof id === 'string'));
    } catch { /* Optional storage. */ }
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) for (const entry of saved) {
        if (entry && typeof entry.id === 'string' && typeof entry.name === 'string') {
          this.add({ id: entry.id, name: entry.name }, entry.autoConnect !== false, false);
        }
      }
    } catch { /* Persistent storage is optional. */ }
  }

  save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.rows.values()].map(
        ({ id, name, autoConnect }) => ({ id, name, autoConnect }))));
    } catch { /* Live connections still work without storage. */ }
  }

  add(device, autoConnect = true, authorised = true) {
    let row = this.rows.get(device.id);
    if (!row) {
      row = { id: device.id, name: device.name || 'Unnamed board', autoConnect,
        device: null, client: null, state: null, busy: false, message: 'Disconnected' };
      this.rows.set(row.id, row);
    }
    if (authorised) row.device = device;
    return row;
  }

  async restore() {
    // Never open a permission picker automatically.
    let restoreMessage = 'Tap Connect to select this board again.';
    if (typeof this.bluetooth?.getDevices === 'function') {
      let timer;
      try {
        const devices = await Promise.race([
          this.bluetooth.getDevices(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Saved-device lookup timed out.')), 5000);
          }),
        ]);
        for (const device of devices) {
          if (this.removed.has(device.id)) continue;
          // Do not replace a freshly selected handle on returning from the picker.
          if (!this.rows.get(device.id)?.device) this.add(device);
        }
        this.save();
      } catch (error) {
        restoreMessage = `Could not restore connection: ${error.message || String(error)}`;
      } finally { clearTimeout(timer); }
    }
    for (const row of this.rows.values()) {
      if (!row.busy && !row.client?.ready) {
        if (!row.autoConnect) row.message = 'Auto-connect paused. Tap Connect to resume.';
        else if (!row.device) row.message = restoreMessage;
      }
    }
    this.changed();
    await Promise.allSettled([...this.rows.values()]
      .filter(row => row.autoConnect && row.device && !row.busy && !row.client?.ready)
      .map(row => this.connect(row)));
  }

  async choose() {
    const device = await this.bluetooth.requestDevice({ filters: [{ services: [UUID.service] }] });
    this.removed.delete(device.id);
    this.saveRemoved();
    const row = this.add(device);
    if (device.name) row.name = device.name;
    row.autoConnect = true;
    this.save();
    this.changed();
    await this.connect(row);
    return row;
  }

  async connect(row) {
    if (row.busy || row.client?.ready) return;
    if (!row.device) return this.choose();
    row.autoConnect = true;
    this.save();
    row.busy = true;
    row.state = null;
    row.message = 'Connecting…';
    const client = new BTWebClient(this.bluetooth, state => {
      if (row.client !== client) return;
      row.state = state;
      this.changed();
    }, () => {
      if (row.client !== client) return;
      row.state = null;
      row.message = 'Disconnected';
      this.changed();
    });
    row.client = client;
    this.changed();
    let timer;
    try {
      await Promise.race([
        client.connect(row.device),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Board unavailable. Tap Connect to retry.')), this.connectionTimeout);
        }),
      ]);
      // Restored browser records can have an old name. Persist the name seen
      // on a successful connection instead of replacing it during restore.
      if (row.device.name) row.name = row.device.name;
      this.save();
      row.message = row.state?.outputAvailable ? 'Connected' : 'Connected · LED unavailable';
    } catch (error) {
      client.disconnect();
      row.client = null;
      row.message = error.message || 'Could not connect';
    } finally {
      clearTimeout(timer);
      row.busy = false;
      this.changed();
    }
  }

  disconnect(row) {
    row.autoConnect = false;
    row.client?.disconnect();
    row.message = 'Auto-connect paused. Tap Connect to resume.';
    this.save();
    this.changed();
  }

  saveRemoved() {
    try { this.storage?.setItem(REMOVED_KEY, JSON.stringify([...this.removed])); }
    catch { /* Removal still applies for this page session. */ }
  }

  remove(row) {
    if (row.busy) return;
    row.client?.disconnect();
    this.rows.delete(row.id);
    // getDevices may continue returning the browser's old permission record.
    this.removed.add(row.id);
    this.saveRemoved();
    this.save();
    this.changed();
  }

  async colour(row, rgb) {
    if (row.busy || !row.client?.ready || !row.state?.outputAvailable) return;
    row.busy = true;
    this.changed();
    try {
      await row.client.send(1, rgb);
      row.message = rgb.every(value => value === 0) ? 'Off confirmed' : 'Colour confirmed';
    } catch (error) {
      row.message = error.message || 'Command failed';
    } finally {
      row.busy = false;
      this.changed();
    }
  }
}
