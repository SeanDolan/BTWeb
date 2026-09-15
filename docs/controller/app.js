import { DeviceRegistry } from './devices.js';
import { SITE_ROOT } from './build.js';
import { installUpdates } from './updates.js';

const byId = id => document.getElementById(id);
const supported = window.isSecureContext && Boolean(navigator.bluetooth);
const colours = [
  { name: 'Red', css: 'red', rgb: [255, 0, 0] },
  { name: 'Blue', css: 'blue', rgb: [0, 0, 255] },
  { name: 'Green', css: 'green', rgb: [0, 255, 0] },
  { name: 'Off', css: 'off', rgb: [0, 0, 0] },
];
let storage;
try { storage = window.localStorage; } catch { /* Optional. */ }
const views = new Map();
const registry = new DeviceRegistry(navigator.bluetooth, storage, render);

function render() {
  for (const [id, view] of views) {
    if (!registry.rows.has(id)) { view.tr.remove(); views.delete(id); }
  }
  byId('empty').hidden = registry.rows.size > 0;
  for (const row of registry.rows.values()) {
    let view = views.get(row.id);
    if (!view) {
      const tr = document.createElement('tr');
      const cell = document.createElement('th');
      cell.scope = 'row';
      const name = document.createElement('span');
      name.className = 'device-name';
      const status = document.createElement('span');
      status.className = 'device-status';
      status.setAttribute('role', 'status');
      const action = document.createElement('button');
      action.className = 'connection-action';
      action.addEventListener('click', async () => {
        byId('message').textContent = '';
        try {
          if (row.client?.ready) registry.disconnect(row);
          else await registry.connect(row);
        } catch (error) { byId('message').textContent = error.message; }
      });
      const remove = document.createElement('button');
      remove.className = 'connection-action';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => registry.remove(row));
      cell.append(name, status, action, remove);
      tr.append(cell);
      const buttons = colours.map(colour => {
        const td = document.createElement('td');
        const button = document.createElement('button');
        button.className = 'swatch ' + colour.css;
        button.addEventListener('click', () => registry.colour(row, colour.rgb));
        td.append(button);
        tr.append(td);
        return button;
      });
      byId('devices').append(tr);
      view = { tr, name, status, action, remove, buttons };
      views.set(row.id, view);
    }
    view.name.textContent = row.name;
    view.status.textContent = row.message;
    view.action.textContent = row.client?.ready ? 'Disconnect' : 'Connect';
    view.action.disabled = !supported || row.busy;
    view.remove.disabled = row.busy;
    view.remove.setAttribute('aria-label', 'Remove ' + row.name);
    view.action.setAttribute('aria-label', view.action.textContent + ' ' + row.name);
    view.buttons.forEach((button, index) => {
      const colour = colours[index];
      button.disabled = row.busy || !row.client?.ready || !row.state?.outputAvailable;
      button.setAttribute('aria-label', row.name + ': ' + colour.name);
      button.setAttribute('aria-pressed', String(Boolean(row.client?.ready &&
        row.state?.rgb.every((value, i) => value === colour.rgb[i]))));
    });
  }
}

byId('connect').disabled = !supported;
byId('connect').addEventListener('click', async () => {
  byId('connect').disabled = true;
  byId('message').textContent = '';
  try { await registry.choose(); }
  catch (error) { if (error.name !== 'NotFoundError') byId('message').textContent = error.message; }
  finally { byId('connect').disabled = !supported; }
});
if (!supported) byId('message').textContent = 'Open the HTTPS page in Bluefy with Bluetooth permission enabled.';
render();
installUpdates(document, window.location);
if (supported) registry.restore();
document.addEventListener('visibilitychange', () => {
  if (supported && document.visibilityState === 'visible') registry.restore();
});

// Cache silently where supported; Bluefy may also retain its own browser cache.
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('sw.js', SITE_ROOT)).catch(() => {});
}
