// Clicking the toolbar icon (or Alt+S) toggles the side panel.
function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

// Forget tab <-> saved-link pairings when a tab closes, even if no sidebar is open.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { links = {} } = await chrome.storage.session.get('links');
  if (links[tabId]) {
    delete links[tabId];
    await chrome.storage.session.set({ links });
  }
});

// Remember tabs that have played sound, so paused tabs stay in the media drawer.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.audible !== true) return;
  const { mediaTabs = {} } = await chrome.storage.session.get('mediaTabs');
  mediaTabs[tabId] = Date.now();
  await chrome.storage.session.set({ mediaTabs });
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { mediaTabs = {} } = await chrome.storage.session.get('mediaTabs');
  if (mediaTabs[tabId]) {
    delete mediaTabs[tabId];
    await chrome.storage.session.set({ mediaTabs });
  }
});

// Register the media hook (hook.js) on every music site the user has allowed.
const FIXED_HOSTS = ['http://127.0.0.1/*', 'https://accounts.spotify.com/*', 'https://api.spotify.com/*'];
async function syncHooks() {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter((o) => !FIXED_HOSTS.includes(o));
  try { await chrome.scripting.unregisterContentScripts({ ids: ['fs-hook'] }); } catch {}
  if (!matches.length) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id: 'fs-hook', js: ['hook.js'], matches, runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true,
    }]);
  } catch (e) { console.warn('hook registration failed', e); }
}
chrome.runtime.onInstalled.addListener(syncHooks);
chrome.runtime.onStartup.addListener(syncHooks);
chrome.permissions.onAdded.addListener(syncHooks);
chrome.permissions.onRemoved.addListener(syncHooks);
