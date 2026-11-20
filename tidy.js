'use strict';
// Arc-style tab cleanup, shared by the background worker and the sidebar.
//  - Loose tabs (not saved in the sidebar) idle longer than the limit are closed and archived.
//  - Saved-link tabs idle longer than the limit are closed (the link stays in its folder).
// Never touched: the tab on screen in each window, Chrome-pinned tabs, tabs playing sound.

const TIDY_DEFAULTS = { archiveHours: 12, closeSavedHours: 12 };
const ARCHIVE_MAX = 200;
const SIDEBAR_ROOT = 'Arc Sidebar';

async function tidySettings() {
  const { tidy } = await chrome.storage.sync.get('tidy');
  return Object.assign({}, TIDY_DEFAULTS, tidy || {});
}

function tidyNorm(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.href;
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch { return url || ''; }
}

// Which open tabs are saved links in the sidebar: explicit pairings, then exact URL matches.
async function savedTabIds(tabs) {
  const saved = new Set();
  const { links = {} } = await chrome.storage.session.get('links');
  for (const id of Object.keys(links)) saved.add(Number(id));
  const roots = (await chrome.bookmarks.search({ title: SIDEBAR_ROOT })).filter((b) => !b.url);
  const urls = new Set();
  for (const r of roots) {
    const [tree] = await chrome.bookmarks.getSubTree(r.id);
    const walk = (n) => { if (n.url) urls.add(tidyNorm(n.url)); (n.children || []).forEach(walk); };
    walk(tree);
  }
  for (const t of tabs) if (urls.has(tidyNorm(t.url || t.pendingUrl))) saved.add(t.id);
  return saved;
}

async function archiveTabs(tabs) {
  if (!tabs.length) return;
  const { archive = [] } = await chrome.storage.local.get('archive');
  const now = Date.now();
  const add = tabs
    .filter((t) => t.url && /^(https?|file):/.test(t.url))
    .map((t) => ({ url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || '', closedAt: now }));
  const seen = new Set(add.map((a) => a.url));
  const next = [...add, ...archive.filter((a) => !seen.has(a.url))].slice(0, ARCHIVE_MAX);
  await chrome.storage.local.set({ archive: next });
}

async function closeTabsSafely(tabs) {
  // Never close a window's last tab: give it a fresh new tab first.
  const byWindow = new Map();
  for (const t of tabs) byWindow.set(t.windowId, (byWindow.get(t.windowId) || 0) + 1);
  for (const [windowId, n] of byWindow) {
    const all = await chrome.tabs.query({ windowId });
    if (all.length <= n) await chrome.tabs.create({ windowId, active: false });
  }
  await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
}

async function runTidy() {
  const s = await tidySettings();
  if (!s.archiveHours && !s.closeSavedHours) return { archived: 0, closed: 0 };
  const now = Date.now();
  const self = chrome.runtime.getURL('');
  const tabs = await chrome.tabs.query({});
  const saved = await savedTabIds(tabs);
  const toArchive = [], toClose = [];
  for (const t of tabs) {
    if (t.active || t.pinned || t.audible || !t.lastAccessed) continue;
    if ((t.url || '').startsWith(self)) continue;
    const idleHours = (now - t.lastAccessed) / 3600000;
    if (saved.has(t.id)) { if (s.closeSavedHours && idleHours >= s.closeSavedHours) toClose.push(t); }
    else if (s.archiveHours && idleHours >= s.archiveHours) toArchive.push(t);
  }
  await archiveTabs(toArchive);
  const all = [...toArchive, ...toClose];
  if (all.length) await closeTabsSafely(all);
  return { archived: toArchive.length, closed: toClose.length };
}
