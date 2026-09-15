export const UUID = Object.freeze({
  service: 'fb8c0001-7b3a-4d0c-a8d5-83f46571c901',
  command: 'fb8c0002-7b3a-4d0c-a8d5-83f46571c901',
  state: 'fb8c0003-7b3a-4d0c-a8d5-83f46571c901',
});

export function decodeState(view) {
  if (view.byteLength !== 10 || view.getUint8(0) !== 1 || view.getUint8(9) !== 0 ||
      view.getUint8(2) > 3 || view.getUint8(6) > 1) {
    throw new Error('Unsupported response from board. Check firmware and page versions.');
  }
  return {
    sequence: view.getUint8(1), result: view.getUint8(2),
    rgb: [view.getUint8(3), view.getUint8(4), view.getUint8(5)],
    outputAvailable: Boolean(view.getUint8(6)), dropped: view.getUint16(7, true),
  };
}

const connectionOwners = new WeakMap();

// One operation in flight per board. On uncertainty disconnect instead of replaying commands.
export class BTWebClient {
  constructor(bluetooth, onState = () => {}, onDisconnect = () => {}) {
    this.bluetooth = bluetooth;
    this.onState = onState;
    this.onDisconnect = onDisconnect;
    this.sequence = 0;
    this.pending = null;
    this.ready = false;
    this.receive = event => this.accept(event.target.value);
    this.lost = () => this.cleanup();
  }

  async connect(knownDevice, rediscover = false) {
    if (this.device) throw new Error('Already connecting or connected.');
    this.device = knownDevice || await this.bluetooth.requestDevice({ filters: [{ services: [UUID.service] }] });
    const device = this.device;
    connectionOwners.set(device, this);
    const check = () => {
      if (this.device !== device) {
        if (connectionOwners.get(device) === this && device.gatt.connected) device.gatt.disconnect();
        throw new Error('Connection cancelled.');
      }
    };
    this.device.addEventListener('gattserverdisconnected', this.lost);
    try {
      if (rediscover && typeof device.watchAdvertisements === 'function') {
        this.stage = 'Saved board rediscovery';
        await this.waitForAdvertisement(device);
        check();
      }
      this.stage = 'Bluetooth connection';
      const server = await this.device.gatt.connect();
      check();
      this.stage = 'BTWeb service discovery';
      const service = await server.getPrimaryService(UUID.service);
      check();
      this.stage = 'BTWeb characteristic discovery';
      const command = await service.getCharacteristic(UUID.command);
      check();
      const state = await service.getCharacteristic(UUID.state);
      check();
      this.command = command;
      this.state = state;
      this.state.addEventListener('characteristicvaluechanged', this.receive);
      this.stage = 'State notification subscription';
      await this.state.startNotifications();
      check();
      this.stage = 'Initial state read';
      const initial = await this.state.readValue();
      check();
      if (this.device !== device || !device.gatt.connected) throw new Error('Bluetooth disconnected during setup.');
      this.sequence = decodeState(initial).sequence;
      this.accept(initial);
      this.ready = true;
      this.stage = 'Board acknowledgement';
      // Fence the initial cached state with a fresh application acknowledgement.
      await this.send(2, [0, 0, 0]);
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  waitForAdvertisement(device, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let timer;
      let finished = false;
      const finish = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        device.removeEventListener('advertisementreceived', received);
        controller.abort();
        this.cancelDiscovery = null;
        if (error !== undefined) reject(error); else resolve();
      };
      const received = event => {
        if (event.device && event.device.id !== device.id) return;
        finish();
      };
      this.cancelDiscovery = () => finish(new Error('Rediscovery cancelled.'));
      device.addEventListener('advertisementreceived', received);
      timer = setTimeout(() => finish(new Error('No advertisement received from the saved board.')), timeoutMs);
      try {
        Promise.resolve(device.watchAdvertisements({ signal: controller.signal })).catch(finish);
      } catch (error) { finish(error); }
    });
  }

  accept(view) {
    try {
      const state = decodeState(view);
      this.onState(state);
      if (this.pending && state.sequence === this.pending.sequence) {
        const pending = this.pending;
        this.pending = null;
        if (state.result === 0) pending.resolve(state);
        else pending.reject(new Error([
          '', 'Board rejected the command.', 'Board queue is full. Try again.',
          'LED output is unavailable; check the board configuration.',
        ][state.result]));
      }
    } catch (error) {
      this.pending?.reject(error);
      this.pending = null;
      this.disconnect();
    }
  }

  async send(operation, rgb) {
    if (!this.ready || this.pending) throw new Error('Connect first and wait for the current command.');
    const sequence = this.sequence = (this.sequence + 1) & 255;
    let timer;
    const ack = new Promise((resolve, reject) => {
      this.pending = { sequence, resolve, reject };
    });
    const bytes = new Uint8Array([1, sequence, operation, ...rgb]);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Board did not confirm within 4 seconds. Reconnect to check its state.')), 4000);
    });
    try {
      // Promise.all observes early disconnect/rejection even while WRITE is pending.
      const command = this.command;
      const write = Promise.resolve().then(() => command.writeValueWithResponse
        ? command.writeValueWithResponse(bytes) : command.writeValue(bytes));
      const [, state] = await Promise.race([Promise.all([write, ack]), timeout]);
      return state;
    } catch (error) {
      this.disconnect();
      throw error;
    } finally {
      clearTimeout(timer);
      this.pending = null;
    }
  }

  disconnect() {
    const device = this.device;
    this.cleanup();
    if (device?.gatt.connected) device.gatt.disconnect();
  }

  cleanup() {
    this.cancelDiscovery?.();
    this.ready = false;
    this.pending?.reject(new Error('Bluetooth disconnected. Reconnect to read the actual LED state.'));
    this.pending = null;
    this.state?.removeEventListener('characteristicvaluechanged', this.receive);
    this.device?.removeEventListener('gattserverdisconnected', this.lost);
    this.state = this.command = this.device = null;
    this.onDisconnect();
  }
}
