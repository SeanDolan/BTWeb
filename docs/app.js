import { BTWebClient } from './ble.js';

const byId = id => document.getElementById(id);
const colours = [...document.querySelectorAll('[data-colour]')];
let busy = false;
let outputAvailable = false;
const supported = window.isSecureContext && Boolean(navigator.bluetooth);
const client = new BTWebClient(navigator.bluetooth, state => {
  outputAvailable = state.outputAvailable;
  byId('state').textContent = `Board reports RGB ${state.rgb.join(', ')} · dropped commands: ${state.dropped}`;
}, () => {
  byId('connection').textContent = 'Disconnected';
  byId('state').textContent = 'Disconnected. Reconnect to read the current LED state.';
  updateButtons();
});

function updateButtons() {
  byId('connect').disabled = !supported || busy || client.ready;
  byId('disconnect').disabled = !client.ready || busy;
  colours.forEach(button => { button.disabled = !client.ready || busy || !outputAvailable; });
}

async function run(action) {
  busy = true;
  byId('message').textContent = '';
  updateButtons();
  try { await action(); }
  catch (error) { byId('message').textContent = error.message || String(error); }
  finally { busy = false; updateButtons(); }
}

byId('connect').addEventListener('click', () => run(async () => {
  byId('connection').textContent = 'Connecting…';
  try {
    await client.connect();
    byId('connection').textContent = `Connected to ${client.device.name || 'MNQ-BT-0001'}`;
    if (!outputAvailable) byId('message').textContent = 'Firmware has no LED output configured.';
  } catch (error) {
    byId('connection').textContent = 'Disconnected';
    throw error;
  }
}));
byId('disconnect').addEventListener('click', () => client.disconnect());
colours.forEach(button => button.addEventListener('click', () => run(async () => {
  await client.send(1, button.dataset.colour.split(',').map(Number));
  byId('message').textContent = 'Colour confirmed by board.';
})));
if (!supported) byId('message').textContent = 'Open the HTTPS page in Bluefy with Bluetooth permission enabled.';
updateButtons();

// Cache the controller where supported; browser storage support is not a UI error.
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // The browser may still retain the page through its own cache.
  });
}
