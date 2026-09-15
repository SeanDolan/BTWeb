import { COMMIT, SITE_ROOT } from './build.js';

export async function latestRelease(fetcher = fetch, root = SITE_ROOT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const url = new URL('version.json', root);
    url.searchParams.set('reload', String(Date.now()));
    const response = await fetcher(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Could not check the latest version.');
    const release = await response.json();
    if (!/^[a-f0-9]{40}$/.test(release.commit) || !Array.isArray(release.assets) ||
        release.entry !== `releases/${release.commit}/controller.html`) {
      throw new Error('The server returned an invalid release.');
    }
    const prefix = `releases/${release.commit}/`;
    if (!release.assets.includes(release.entry) || release.assets.some(path =>
      typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..') ||
      !/^[a-zA-Z0-9/._-]+$/.test(path))) throw new Error('Invalid release files.');
    // Finish downloading the complete controller before leaving a working page.
    await Promise.all(release.assets.map(async path => {
      const result = await fetcher(new URL(path, root), { cache: 'reload', signal: controller.signal });
      if (!result.ok) throw new Error('The latest version is not fully available yet. Try again shortly.');
      await result.arrayBuffer();
    }));
    // Navigate to a permanent page; immutable paths are for assets, not bookmarks.
    const entry = new URL('controller.html', root);
    entry.searchParams.set('reload', String(Date.now()));
    return entry;
  } finally { clearTimeout(timer); }
}

export function installUpdates(document, location, fetcher = fetch) {
  // Existing version-specific bookmarks become a permanent address without
  // reloading or disturbing an active Bluetooth connection.
  if (location?.pathname?.includes('/releases/')) {
    globalThis.history?.replaceState(null, '', new URL('controller.html', SITE_ROOT));
  }
  document.getElementById('commit').textContent = COMMIT;
  const button = document.getElementById('reload-cache');
  const status = document.getElementById('reload-status');
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Downloading the latest version…';
    try { location.replace((await latestRelease(fetcher)).href); }
    catch {
      status.textContent = 'Could not reload. Check your internet connection and try again. Your saved boards are unchanged.';
      button.disabled = false;
    }
  });
}
