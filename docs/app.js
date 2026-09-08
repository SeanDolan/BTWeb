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
    byId('connection').textContent = 'Connected to BTWeb';
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

async function prepareOffline() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    throw new Error('Offline storage is unavailable in this browser. Do not rely on offline reopening.');
  }
  await navigator.serviceWorker.register('./sw.js');
  // A timeout handles restricted browsers without leaving a perpetual "checking" label.
  const worker = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Offline setup timed out. Reopen while online to retry.')), 10000)),
  ]);
  const cached = await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Unable to verify the offline cache.')); }, 3000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.ready === true);
    };
    worker.active.postMessage({ type: 'CHECK_CACHE' }, [channel.port2]);
  });
  if (!cached) throw new Error('Offline cache is incomplete. Reload with internet access.');
  byId('offline').textContent = 'Controller files cached. Now test reopening and Bluetooth control with internet disabled.';
}
prepareOffline().catch(error => { byId('offline').textContent = error.message; });
