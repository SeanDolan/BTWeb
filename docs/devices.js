import { BTWebClient, UUID } from './ble.js';

export const STORAGE_KEY = 'btweb.devices.v1';
export const REMOVED_KEY = 'btweb.removedDevices.v1';

export function errorText(error) {
  if (typeof error === 'string' && error) return error;
  if (error?.message) return String(error.message);
  try {
    const details = JSON.stringify(error);
    if (details && details !== '{}') return details;
  } catch { /* Non-serialisable browser error. */ }
  return error?.name || 'Browser returned no error details';
}

// Browser-scoped IDs identify boards; names are display labels only.
export class DeviceRegistry {
  constructor(bluetooth, storage, changed = () => {}, connectionTimeout = 12000) {
    this.bluetooth = bluetooth;
    this.storage = storage;
    this.changed = changed;
    this.connectionTimeout = connectionTimeout;
    this.rows = new Map();
    this.selecting = false;
    this.removed = new Set();
    try {
      const removed = JSON.parse(storage?.getItem(REMOVED_KEY) || '[]');
      if (Array.isArray(removed)) this.removed = new Set(removed.filter(id => typeof id === 'string'));
    } catch { /* Optional storage. */ }
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) for (const entry of saved) {
        if (entry && typeof entry.id === 'string' && entry.id.length && typeof entry.name === 'string' && !this.removed.has(entry.id)) {
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
    if (typeof device?.id !== 'string' || !device.id.length) throw new Error('Browser returned a device without a valid ID.');
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
    if (this.selecting) return;
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
          const row = this.rows.get(device.id);
          // Permission history is not our saved board list. Exact ID match only.
          if (!row || row.failed || this.selecting) continue;
          if (!row.device && !row.busy && !row.client?.ready) row.device = device;
        }
        this.save();
      } catch (error) {
        restoreMessage = `Could not restore connection: ${errorText(error)}`;
      } finally { clearTimeout(timer); }
    }
    for (const row of this.rows.values()) {
      if (!row.busy && !row.client?.ready && !row.failed) {
        if (!row.autoConnect) row.message = 'Auto-connect paused. Tap Connect to resume.';
        else if (!row.device) row.message = restoreMessage;
      }
    }
    this.changed();
    await Promise.allSettled([...this.rows.values()]
      .filter(row => row.autoConnect && row.device && !row.busy && !row.client?.ready)
      .map(row => this.connect(row)));
  }

  async choose(previousRow) {
    if (this.selecting) return;
    this.selecting = true;
    try {
      const device = await this.bluetooth.requestDevice({ filters: [{ services: [UUID.service] }] });
      if (this.rows.get(device.id)?.busy) throw new Error('This board is already connecting. Wait for it to finish.');
      this.removed.delete(device.id);
      this.saveRemoved();
      const row = this.add(device);
      if (device.name) row.name = device.name;
      row.autoConnect = true;
      row.failed = false;
      this.save();
      this.changed();
      await this.connect(row);
      // A new browser ID replaces only the row the user explicitly reselected,
      // and only after the selected device has passed service/protocol setup.
      if (previousRow && previousRow !== row && row.client?.ready) this.remove(previousRow);
      return row;
    } finally { this.selecting = false; }
  }

  async connect(row) {
    if (row.busy || row.client?.ready) return;
    if (!row.device || row.failed) return this.choose(row);
    row.autoConnect = true;
    this.save();
    row.busy = true;
    row.state = null;
    const device = row.device;
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
        client.connect(device),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Board unavailable. Tap Connect to retry.')), this.connectionTimeout);
        }),
      ]);
      // Restored browser records can have an old name. Persist the name seen
      // on a successful connection instead of replacing it during restore.
      if (device.name) row.name = device.name;
      this.save();
      row.message = row.state?.outputAvailable ? 'Connected' : 'Connected · LED unavailable';
    } catch (error) {
      client.disconnect();
      row.client = null;
      row.device = null;
      row.failed = true;
      row.message = `${client.stage || 'Connection'}: ${errorText(error)}. Tap Connect to select the board again.`;
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
