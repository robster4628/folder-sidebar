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
