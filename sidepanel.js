'use strict';
// Folder Sidebar — Arc-style sidebar backed by Chrome bookmarks.
// Layout in Bookmarks:  Other bookmarks / Arc Sidebar / ★ Pinned   (the top grid)
//                                                   / 🌎 Graphics  (one folder per space)

const ROOT_TITLE = 'Arc Sidebar';
const PINNED_TITLE = '★ Pinned';
const FALLBACK_COLORS = ['#f0eee4', '#ededf6', '#e3f0e4', '#f2edeb', '#e6eef4', '#f4ecf2'];

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const state = {
  windowId: null,
  rootId: null,
  pinnedId: null,
  apps: [],
  spaces: [],
  activeSpaceId: null,
  byId: new Map(),        // bookmark id -> node (with .path)
  parentOf: new Map(),    // bookmark id -> parent id
  expanded: new Set(),
  colors: {},             // space title -> hex (synced)
  links: {},              // tabId -> bookmarkId (session)
  bmToTab: new Map(),     // bookmark id -> tab
  linkedTabIds: new Set(),
  windowTabs: [],
  activeTabId: null,
  filter: '',
  busy: false,            // suppress reloads during bulk work
};

// ---------- utils ----------
const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function splitIcon(title) {
  const first = (seg.segment(title)[Symbol.iterator]().next().value || {}).segment || '';
  if (first && /\p{Extended_Pictographic}/u.test(first)) return { icon: first, name: title.slice(first.length).trim() };
  return { icon: null, name: title };
}
function norm(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.href;
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch { return url || ''; }
}
function favicon(url, tab) {
  if (tab && tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) return tab.favIconUrl;
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', url || '');
  u.searchParams.set('size', '32');
  return u.toString();
}
const FOLDER_SVG = (open) => open
  ? '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.3 1.4h6a1 1 0 0 1 1 1V6H4.2a1 1 0 0 0-.95.68L1.5 12V4.5z" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M3.25 6.7A1 1 0 0 1 4.2 6h10.3l-1.9 6.3a1 1 0 0 1-.95.7H1.5z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>'
  : '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 4a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

let toastTimer;
function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- modal dialogs ----------
function modal(build) {
  return new Promise((resolve) => {
    const m = $('#modal'), box = m.querySelector('.box');
    box.replaceChildren();
    const done = (v) => { m.hidden = true; document.removeEventListener('keydown', key, true); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    document.addEventListener('keydown', key, true);
    m.onclick = (e) => { if (e.target === m) done(null); };
    build(box, done);
    m.hidden = false;
    const f = box.querySelector('input'); if (f) { f.focus(); f.select && f.select(); }
  });
}
function buttons(box, done, okLabel, okClass, getValue) {
  const b = el('div', 'btns');
  const cancel = el('button', '', 'Cancel'); cancel.onclick = () => done(null);
  const ok = el('button', okClass || 'primary', okLabel || 'OK'); ok.onclick = () => done(getValue());
  b.append(cancel, ok); box.append(b);
  return ok;
}
function askText(label, value = '', type = 'text') {
  return modal((box, done) => {
    box.append(el('p', '', label));
    const i = el('input'); i.type = type; i.value = value;
    i.onkeydown = (e) => { if (e.key === 'Enter') done(i.value.trim() || null); };
    box.append(i);
    buttons(box, done, 'OK', 'primary', () => i.value.trim() || null);
  });
}
function askColor(label, value) {
  return modal((box, done) => {
    box.append(el('p', '', label));
    const i = el('input'); i.type = 'color'; i.value = value || '#f0eee4';
    i.oninput = () => document.documentElement.style.setProperty('--space', i.value);
    box.append(i);
    buttons(box, done, 'Set', 'primary', () => i.value);
  });
}
function confirmBox(msg, okLabel = 'OK', danger = false) {
  return modal((box, done) => {
    box.append(el('p', '', msg));
    buttons(box, done, okLabel, danger ? 'danger' : 'primary', () => true);
  });
}

// ---------- bookmarks root ----------
async function ensureRoot() {
  const [tree] = await chrome.bookmarks.getTree();
  const other = tree.children.find((c) => c.folderType === 'other') || tree.children[1] || tree.children[0];
  const kids = await chrome.bookmarks.getChildren(other.id);
  let root = kids.find((c) => !c.url && c.title === ROOT_TITLE);
  if (!root) root = await chrome.bookmarks.create({ parentId: other.id, title: ROOT_TITLE });
  const rk = await chrome.bookmarks.getChildren(root.id);
  let pinned = rk.find((c) => !c.url && c.title === PINNED_TITLE);
  if (!pinned) pinned = await chrome.bookmarks.create({ parentId: root.id, title: PINNED_TITLE, index: 0 });
  state.rootId = root.id;
  state.pinnedId = pinned.id;
}

// ---------- load ----------
async function load() {
  let rootNode;
  try { [rootNode] = await chrome.bookmarks.getSubTree(state.rootId); }
  catch { await ensureRoot(); [rootNode] = await chrome.bookmarks.getSubTree(state.rootId); }
  const kids = rootNode.children || [];
  if (!kids.some((k) => k.id === state.pinnedId)) { await ensureRoot(); return load(); }

  state.byId.clear(); state.parentOf.clear();
  const index = (n, path) => {
    n.path = path;
    state.byId.set(n.id, n);
    for (const c of n.children || []) { state.parentOf.set(c.id, n.id); index(c, n.url ? path : [...path, n.title]); }
  };
  for (const k of kids) index(k, []);

  state.apps = (kids.find((k) => k.id === state.pinnedId).children || []).filter((c) => c.url);
  state.spaces = kids.filter((k) => !k.url && k.id !== state.pinnedId);
  if (!state.spaces.some((s) => s.id === state.activeSpaceId)) state.activeSpaceId = state.spaces[0] ? state.spaces[0].id : null;

  const [allTabs, sess] = await Promise.all([chrome.tabs.query({}), chrome.storage.session.get('links')]);
  state.links = sess.links || {};
  state.windowTabs = allTabs.filter((t) => t.windowId === state.windowId);
  const active = state.windowTabs.find((t) => t.active);
  state.activeTabId = active ? active.id : null;

  // Pair open tabs with saved links: explicit pairings first, then exact URL matches.
  state.bmToTab.clear(); state.linkedTabIds.clear();
  const tabById = new Map(allTabs.map((t) => [t.id, t]));
  for (const [tabId, bmId] of Object.entries(state.links)) {
    const t = tabById.get(Number(tabId));
    if (t && state.byId.has(bmId) && !state.bmToTab.has(bmId)) { state.bmToTab.set(bmId, t); state.linkedTabIds.add(t.id); }
  }
  const urlIdx = new Map();
  for (const n of state.byId.values()) if (n.url && !state.bmToTab.has(n.id)) {
    const k = norm(n.url);
    if (!urlIdx.has(k)) urlIdx.set(k, []);
    urlIdx.get(k).push(n.id);
  }
  // Prefer tabs in this window when matching by URL.
  const ordered = [...allTabs].sort((a, b) => (b.windowId === state.windowId) - (a.windowId === state.windowId));
  for (const t of ordered) {
    if (state.linkedTabIds.has(t.id)) continue;
    const ids = urlIdx.get(norm(t.url || t.pendingUrl));
    const id = ids && ids.find((i) => !state.bmToTab.has(i));
    if (id) { state.bmToTab.set(id, t); state.linkedTabIds.add(t.id); }
  }
  const activeChanged = state.activeTabId !== state.lastRevealedTabId;
  state.lastRevealedTabId = state.activeTabId;
  if (activeChanged && !state.filter) revealActive();
  render();
  if (activeChanged) {
    const row = document.querySelector('#tree .row.active');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
}

// When the active tab is a saved link, switch to its space and open the folders around it.
function revealActive() {
  if (state.activeTabId == null) return;
  let bmId = null;
  for (const [id, t] of state.bmToTab) if (t.id === state.activeTabId) { bmId = id; break; }
  if (!bmId) return;
  const chain = [];
  for (let p = state.parentOf.get(bmId); p && p !== state.rootId; p = state.parentOf.get(p)) chain.push(p);
  const spaceId = chain[chain.length - 1];
  if (!spaceId || spaceId === state.pinnedId || !state.spaces.some((s) => s.id === spaceId)) return;
  let changed = false;
  for (const f of chain.slice(0, -1)) if (!state.expanded.has(f)) { state.expanded.add(f); changed = true; }
  if (changed) saveExpanded();
  if (spaceId !== state.activeSpaceId) {
    state.activeSpaceId = spaceId;
    chrome.storage.local.set({ activeSpace: spaceId });
  }
}
let loadTimer;
function scheduleLoad() {
  if (state.busy) return;
  clearTimeout(loadTimer);
  loadTimer = setTimeout(load, 40);
}

// ---------- render ----------
function render() {
  const space = state.byId.get(state.activeSpaceId);
  const color = (space && state.colors[space.title]) ||
    FALLBACK_COLORS[Math.max(0, state.spaces.findIndex((s) => s.id === state.activeSpaceId)) % FALLBACK_COLORS.length];
  document.documentElement.style.setProperty('--space', color);

  renderApps();
  renderSpaces();
  const searching = !!state.filter;
  for (const id of ['#spaceName', '#tree', '#newTab', '#todayDivider', '#today']) $(id).hidden = searching;
  $('#results').hidden = !searching;
  if (searching) { renderResults(); return; }

  const name = $('#spaceName');
  name.replaceChildren();
  if (space) {
    const { icon, name: n } = splitIcon(space.title);
    if (icon) name.append(el('span', '', icon));
    name.append(el('span', '', n));
  }
  const tree = $('#tree');
  const scroll = $('#scroller').scrollTop;
  tree.replaceChildren();
  if (!space) {
    tree.append(el('div', 'empty', 'No spaces yet. Use ⋯ → Import from Arc, or + to make a space.'));
  } else {
    tree.dataset.parent = space.id;
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        if (n.url) tree.append(bmRow(n, depth));
        else {
          tree.append(folderRow(n, depth));
          if (state.expanded.has(n.id)) walk(n.children || [], depth + 1);
        }
      }
    };
    walk(space.children || [], 0);
    if (!(space.children || []).length) tree.append(el('div', 'empty', 'Drag tabs here to save them.'));
  }

  const today = $('#today');
  today.replaceChildren();
  const loose = state.windowTabs.filter((t) => !state.linkedTabIds.has(t.id) && !(t.url || '').startsWith(chrome.runtime.getURL('')));
  for (const t of loose) today.append(tabRow(t));
  $('#scroller').scrollTop = scroll;
}

function baseRow(kind, id, depth, label) {
  const r = el('div', 'row ' + kind);
  r.dataset.kind = kind; r.dataset.id = id;
  r.style.setProperty('--depth', depth);
  r.draggable = true;
  const ico = el('span', 'ico');
  r.append(ico, el('span', 'label', label));
  return { r, ico };
}
function img(src) { const i = el('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; return i; }
function closeBtn(title) { const x = el('button', 'x', '×'); x.title = title; x.dataset.action = 'close'; return x; }

function folderRow(n, depth) {
  const open = state.expanded.has(n.id);
  const { r, ico } = baseRow('folder', n.id, depth, n.title || 'Untitled');
  ico.innerHTML = FOLDER_SVG(open);
  if (!open && (n.children || []).some((c) => c.url && state.bmToTab.has(c.id))) r.classList.add('has-open');
  return r;
}
function bmRow(n, depth) {
  const tab = state.bmToTab.get(n.id);
  const { r, ico } = baseRow('bm', n.id, depth, n.title || n.url);
  r.title = n.url;
  ico.append(img(favicon(n.url, tab)));
  if (tab) {
    r.classList.add('open');
    if (tab.id === state.activeTabId) r.classList.add('active');
    r.append(closeBtn('Close tab (keeps the saved link)'));
  }
  return r;
}
function tabRow(t) {
  const { r, ico } = baseRow('tab', String(t.id), 0, t.title || t.url);
  r.title = t.url;
  ico.append(img(favicon(t.url, t)));
  if (t.id === state.activeTabId) r.classList.add('active');
  r.append(closeBtn('Close tab'));
  return r;
}
function renderApps() {
  const g = $('#apps');
  g.replaceChildren();
  for (const a of state.apps) {
    const tab = state.bmToTab.get(a.id);
    const t = el('div', 'tile');
    t.dataset.kind = 'app'; t.dataset.id = a.id; t.draggable = true; t.title = a.title + '\n' + a.url;
    t.append(img(favicon(a.url, tab)));
    if (tab) t.classList.add('open');
    if (tab && tab.id === state.activeTabId) t.classList.add('active');
    g.append(t);
  }
}
function renderSpaces() {
  const box = $('#spaces');
  box.replaceChildren();
  for (const s of state.spaces) {
    const { icon, name } = splitIcon(s.title);
    const b = el('button', 'space' + (s.id === state.activeSpaceId ? ' active' : ''), icon || (name[0] || '?').toUpperCase());
    b.dataset.kind = 'space'; b.dataset.id = s.id; b.title = name;
    box.append(b);
  }
}
function renderResults() {
  const box = $('#results');
  box.replaceChildren();
  const terms = state.filter.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (s) => terms.every((t) => s.toLowerCase().includes(t));
  let count = 0;
  const spaceTitle = (n) => { // first element of path is the space folder title
    return n.path && n.path.length ? n.path.join(' › ') : '';
  };
  for (const n of state.byId.values()) {
    if (!n.url || count >= 200) continue;
    if (!hit((n.title || '') + ' ' + n.url + ' ' + n.path.join(' '))) continue;
    const r = bmRow(n, 0);
    r.append(el('span', 'sub', spaceTitle(n)));
    box.append(r); count++;
  }
  for (const t of state.windowTabs) {
    if (state.linkedTabIds.has(t.id) || !hit((t.title || '') + ' ' + t.url)) continue;
    const r = tabRow(t); r.append(el('span', 'sub', 'Open tab')); box.append(r); count++;
  }
  if (!count) box.append(el('div', 'empty', 'No matches.'));
}

// ---------- actions ----------
async function setLink(tabId, bmId) {
  const { links = {} } = await chrome.storage.session.get('links');
  for (const k of Object.keys(links)) if (links[k] === bmId) delete links[k];
  if (bmId) links[tabId] = bmId; else delete links[tabId];
  await chrome.storage.session.set({ links });
}
async function openBookmark(id, forceNew) {
  const bm = state.byId.get(id);
  if (!bm || !bm.url) return;
  const tab = state.bmToTab.get(id);
  if (tab && !forceNew) {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== state.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch { /* tab vanished; open fresh */ }
  }
  const t = await chrome.tabs.create({ windowId: state.windowId, url: bm.url, active: true });
  if (!forceNew) await setLink(t.id, id);
}
async function saveTab(tabId, parentId, index) {
  const t = await chrome.tabs.get(tabId);
  const opts = { parentId, title: t.title || t.url, url: t.url || t.pendingUrl };
  if (index != null) opts.index = index;
  const bm = await chrome.bookmarks.create(opts);
  await setLink(tabId, bm.id);
  return bm;
}
function isInside(id, ancestorId) {
  for (let p = id; p; p = state.parentOf.get(p)) if (p === ancestorId) return true;
  return false;
}
async function moveNode(id, parentId, index) {
  if (id === parentId || isInside(parentId, id)) return toast("Can't move a folder inside itself.");
  const opts = { parentId };
  if (index != null) opts.index = index;
  await chrome.bookmarks.move(id, opts);
}
async function newFolder(parentId) {
  const name = await askText('Folder name', 'New Folder');
  if (!name) return;
  const f = await chrome.bookmarks.create({ parentId, title: name, index: 0 });
  state.expanded.add(f.id);
  if (parentId !== state.activeSpaceId) state.expanded.add(parentId);
  saveExpanded();
}
async function deleteNode(id) {
  const n = state.byId.get(id);
  if (!n) return;
  if (!n.url) {
    const count = countLinks(n);
    if (!(await confirmBox(`Delete “${n.title}”${count ? ` and the ${count} saved link${count > 1 ? 's' : ''} inside it` : ''}?`, 'Delete', true))) return;
    await chrome.bookmarks.removeTree(id);
  } else {
    await chrome.bookmarks.remove(id);
  }
}
const countLinks = (n) => (n.children || []).reduce((s, c) => s + (c.url ? 1 : countLinks(c)), 0);
function saveExpanded() { chrome.storage.local.set({ expanded: [...state.expanded] }); }
function setSpace(id) {
  if (!id || id === state.activeSpaceId) return;
  state.activeSpaceId = id;
  chrome.storage.local.set({ activeSpace: id });
  render();
}
function shiftSpace(d) {
  const i = state.spaces.findIndex((s) => s.id === state.activeSpaceId);
  const n = state.spaces[i + d];
  if (n) setSpace(n.id);
}
async function setColors(patch) {
  Object.assign(state.colors, patch);
  for (const k of Object.keys(patch)) if (patch[k] == null) delete state.colors[k];
  await chrome.storage.sync.set({ colors: state.colors });
}
async function renameSpace(id, oldTitle, newTitle) {
  if (!newTitle || newTitle === oldTitle) return;
  const c = state.colors[oldTitle];
  if (c) await setColors({ [newTitle]: c, [oldTitle]: null });
  await chrome.bookmarks.update(id, { title: newTitle });
}

function startRename(row) {
  const id = row.dataset.id;
  const n = state.byId.get(id);
  if (!n) return;
  row.classList.add('editing'); row.draggable = false;
  const i = el('input', 'rename'); i.value = n.title;
  row.querySelector('.label').after(i);
  i.focus(); i.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return; finished = true;
    const v = i.value.trim();
    if (save && v && v !== n.title) await chrome.bookmarks.update(id, { title: v });
    else render();
  };
  i.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); };
  i.onblur = () => finish(true);
  i.onclick = (e) => e.stopPropagation();
}

// ---------- context menu ----------
function showMenu(x, y, items) {
  const m = $('#menu');
  m.replaceChildren();
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(el('hr')); continue; }
    const b = el('button', it.danger ? 'danger' : '', it.label);
    b.onclick = () => { hideMenu(); it.fn(); };
    m.append(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
function hideMenu() { $('#menu').hidden = true; }

async function currentTab() {
  const [t] = await chrome.tabs.query({ active: true, windowId: state.windowId });
  return t;
}

function menuFor(kind, id, row) {
  const n = state.byId.get(id);
  const copy = (u) => navigator.clipboard.writeText(u).then(() => toast('Link copied'));
  if (kind === 'folder') return [
    { label: 'New Folder Inside', fn: () => newFolder(id) },
    { label: 'Save Current Tab Here', fn: async () => { const t = await currentTab(); if (t) { await saveTab(t.id, id); state.expanded.add(id); saveExpanded(); } } },
    { label: 'Open All', fn: () => (n.children || []).filter((c) => c.url).forEach((c) => openBookmark(c.id)) },
    '-',
    { label: 'Rename', fn: () => startRename(row) },
    { label: 'Delete Folder…', danger: true, fn: () => deleteNode(id) },
  ];
  if (kind === 'bm' || kind === 'app') {
    const tab = state.bmToTab.get(id);
    return [
      { label: 'Open in New Tab', fn: () => openBookmark(id, true) },
      { label: 'Copy Link', fn: () => copy(n.url) },
      tab && tab.url && norm(tab.url) !== norm(n.url) ? { label: 'Update Link to Current Page', fn: () => chrome.bookmarks.update(id, { url: tab.url }) } : null,
      kind === 'bm' ? { label: 'Add to Pinned Grid', fn: () => chrome.bookmarks.create({ parentId: state.pinnedId, title: n.title, url: n.url }) } : null,
      '-',
      kind === 'bm' ? { label: 'Rename', fn: () => startRename(row) } : null,
      { label: 'Edit URL…', fn: async () => { const u = await askText('URL', n.url, 'url'); if (u) chrome.bookmarks.update(id, { url: u }).catch((e) => toast(e.message)); } },
      tab ? { label: 'Close Tab', fn: () => chrome.tabs.remove(tab.id) } : null,
      { label: kind === 'app' ? 'Remove from Pinned Grid' : 'Delete Saved Link', danger: true, fn: () => deleteNode(id) },
    ];
  }
  if (kind === 'tab') {
    const tabId = Number(id);
    const t = state.windowTabs.find((x) => x.id === tabId);
    return [
      state.activeSpaceId ? { label: 'Save to This Space', fn: () => saveTab(tabId, state.activeSpaceId) } : null,
      { label: 'Add to Pinned Grid', fn: () => saveTab(tabId, state.pinnedId) },
      t ? { label: 'Copy Link', fn: () => copy(t.url) } : null,
      '-',
      { label: 'Close Tab', fn: () => chrome.tabs.remove(tabId) },
    ];
  }
  if (kind === 'space') {
    const s = state.byId.get(id);
    const { icon, name } = splitIcon(s.title);
    return [
      { label: 'Rename Space…', fn: async () => { const v = await askText('Space name', name); if (v) renameSpace(id, s.title, (icon ? icon + ' ' : '') + v); } },
      { label: 'Change Icon…', fn: async () => { const v = await askText('Emoji for this space', icon || ''); if (v != null) renameSpace(id, s.title, (v ? v + ' ' : '') + name); } },
      { label: 'Change Color…', fn: async () => { const prev = state.colors[s.title]; const v = await askColor('Space color', prev); if (v) await setColors({ [s.title]: v }); render(); } },
      { label: 'New Folder', fn: () => newFolder(id) },
      '-',
      { label: 'Delete Space…', danger: true, fn: () => deleteNode(id) },
    ];
  }
  return [];
}

// ---------- import ----------
async function runImport(file) {
  let data;
  try { data = parseArcSidebar(JSON.parse(await file.text())); }
  catch (e) { return toast('Import failed: ' + e.message, 6000); }
  const { stats } = data;
  const msg = `Import ${data.spaces.length} spaces, ${stats.folders} folders and ${stats.links} links from Arc?` +
    (stats.notes.length ? `\n\nArc Notes can't be imported: ${stats.notes.join(', ')}.` : '') +
    (stats.splitViews ? `\n\n${stats.splitViews} split views will become ordinary links.` : '') +
    (state.spaces.length ? '\n\nYour existing spaces are kept; the imported ones are added after them.' : '');
  if (!(await confirmBox(msg, 'Import'))) return;

  state.busy = true;
  let done = 0, failed = [];
  const total = stats.links + stats.folders + data.spaces.length + data.topApps.length;
  const tick = () => { done++; if (done % 10 === 0) toast(`Importing… ${done}/${total}`, 0); };
  const write = async (parentId, nodes) => {
    for (const n of nodes) {
      try {
        if (n.type === 'link') await chrome.bookmarks.create({ parentId, title: n.title, url: n.url });
        else { const f = await chrome.bookmarks.create({ parentId, title: n.title }); await write(f.id, n.children); }
      } catch (e) { failed.push(n.title); }
      tick();
    }
  };
  try {
    const existingApps = new Set(state.apps.map((a) => norm(a.url)));
    for (const a of data.topApps) {
      if (!existingApps.has(norm(a.url))) {
        try { await chrome.bookmarks.create({ parentId: state.pinnedId, title: a.title, url: a.url }); } catch { failed.push(a.title); }
      }
      tick();
    }
    const colors = {};
    let firstSpace = null;
    for (const s of data.spaces) {
      const f = await chrome.bookmarks.create({ parentId: state.rootId, title: (s.icon ? s.icon + ' ' : '') + s.title });
      if (s.color) colors[f.title] = s.color;
      firstSpace = firstSpace || f.id;
      tick();
      await write(f.id, s.children);
    }
    await setColors(colors);
    if (firstSpace && !state.activeSpaceId) state.activeSpaceId = firstSpace;
  } finally {
    state.busy = false;
    await load();
  }
  toast(`Imported ${done - failed.length} items.` + (failed.length ? ` ${failed.length} couldn't be saved (unsupported URLs): ${failed.slice(0, 5).join(', ')}` : ''), 8000);
}

let importMode = 'all';
async function restoreColors(file) {
  let data;
  try { data = parseArcSidebar(JSON.parse(await file.text())); }
  catch (e) { return toast('Could not read that file: ' + e.message, 6000); }
  const patch = {};
  let n = 0;
  for (const s of data.spaces) {
    if (!s.color) continue;
    const title = (s.icon ? s.icon + ' ' : '') + s.title;
    if (state.spaces.some((x) => x.title === title)) { patch[title] = s.color; n++; }
  }
  await setColors(patch);
  render();
  toast(n ? `Restored colors for ${n} space${n > 1 ? 's' : ''}.` : 'No matching space names found.');
}

// ---------- drag & drop ----------
let drag = null;     // {kind, id}
let dropT = null;    // {el, zone}
let hoverTimer = null;
function clearDrop() {
  document.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((e) => e.classList.remove('drop-before', 'drop-after', 'drop-into'));
  dropT = null;
}
function targetFor(e) {
  const t = e.target.closest('[data-kind], #tree, #apps, #today');
  if (!t) return null;
  const kind = t.dataset.kind;
  const rect = t.getBoundingClientRect();
  if (kind === 'folder') {
    const y = (e.clientY - rect.top) / rect.height;
    return { el: t, zone: y < 0.25 ? 'before' : y > 0.75 && !state.expanded.has(t.dataset.id) ? 'after' : 'into' };
  }
  if (kind === 'bm') return { el: t, zone: e.clientY - rect.top < rect.height / 2 ? 'before' : 'after' };
  if (kind === 'app') return { el: t, zone: e.clientX - rect.left < rect.width / 2 ? 'before' : 'after' };
  if (kind === 'space') return { el: t, zone: 'into' };
  if (kind === 'tab' || t.id === 'today') return { el: $('#today'), zone: 'into' };
  if (t.id === 'tree' && state.activeSpaceId) return { el: t, zone: 'into' };
  if (t.id === 'apps') return { el: t, zone: 'into' };
  return null;
}
function allowed(target) {
  if (!drag || !target) return false;
  const k = target.el.dataset.kind;
  if (target.el.id === 'today') return drag.kind === 'bm' && state.bmToTab.has(drag.id);
  if (drag.kind === 'folder' && (k === 'app' || target.el.id === 'apps')) return false;
  if (target.el.dataset.id === drag.id && drag.kind !== 'tab') return false;
  return true;
}
async function performDrop(target) {
  const k = target.el.dataset.kind, tid = target.el.dataset.id;
  if (target.el.id === 'today') { // unpin: forget saved link, keep tab open
    const tab = state.bmToTab.get(drag.id);
    await chrome.bookmarks.remove(drag.id);
    if (tab) await setLink(tab.id, null);
    return;
  }
  let parentId, index;
  if (k === 'space') parentId = tid;
  else if (target.el.id === 'tree') parentId = state.activeSpaceId;
  else if (target.el.id === 'apps') parentId = state.pinnedId;
  else if (target.zone === 'into') { parentId = tid; state.expanded.add(tid); saveExpanded(); }
  else {
    const n = state.byId.get(tid);
    parentId = n.parentId;
    index = n.index + (target.zone === 'after' ? 1 : 0);
  }
  if (drag.kind === 'tab') await saveTab(Number(drag.id), parentId, index);
  else await moveNode(drag.id, parentId, index);
}

// ---------- events ----------
function wire() {
  const app = $('#app');

  app.addEventListener('click', async (e) => {
    hideMenu();
    const x = e.target.closest('[data-action="close"]');
    const r = e.target.closest('[data-kind]');
    if (!r) return;
    const { kind, id } = r.dataset;
    if (x) {
      e.stopPropagation();
      const tab = kind === 'tab' ? { id: Number(id) } : state.bmToTab.get(id);
      if (tab) chrome.tabs.remove(tab.id);
      return;
    }
    if (r.classList.contains('editing')) return;
    const forceNew = e.metaKey || e.ctrlKey;
    if (kind === 'folder') {
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      saveExpanded(); render();
    } else if (kind === 'bm' || kind === 'app') openBookmark(id, forceNew);
    else if (kind === 'tab') chrome.tabs.update(Number(id), { active: true });
    else if (kind === 'space') setSpace(id);
  });
  app.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const r = e.target.closest('[data-kind]');
    if (!r) return;
    if (r.dataset.kind === 'bm' || r.dataset.kind === 'app') openBookmark(r.dataset.id, true);
    if (r.dataset.kind === 'tab') chrome.tabs.remove(Number(r.dataset.id));
  });
  app.addEventListener('dblclick', (e) => {
    const r = e.target.closest('.row[data-kind="bm"], .row[data-kind="folder"]');
    if (r && !e.target.closest('.x')) startRename(r);
  });
  app.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = e.target.closest('[data-kind]');
    if (r) return showMenu(e.clientX, e.clientY, menuFor(r.dataset.kind, r.dataset.id, r));
    if (e.target.closest('#scroller') && state.activeSpaceId) {
      showMenu(e.clientX, e.clientY, [
        { label: 'New Folder', fn: () => newFolder(state.activeSpaceId) },
        { label: 'Save Current Tab to This Space', fn: async () => { const t = await currentTab(); if (t) saveTab(t.id, state.activeSpaceId); } },
      ]);
    }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu')) hideMenu(); }, true);

  $('#newTab').addEventListener('click', () => chrome.tabs.create({ windowId: state.windowId }));
  $('#addSpace').addEventListener('click', async () => {
    const name = await askText('Name for the new space', '');
    if (!name) return;
    const f = await chrome.bookmarks.create({ parentId: state.rootId, title: name });
    state.activeSpaceId = f.id;
    chrome.storage.local.set({ activeSpace: f.id });
  });
  $('#menuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.top - 8, [
      { label: 'Import from Arc…', fn: () => { importMode = 'all'; $('#importFile').click(); } },
      { label: 'Restore Space Colors from Arc…', fn: () => { importMode = 'colors'; $('#importFile').click(); } },
      { label: 'Music Settings…', fn: () => Media.openSettings() },
      '-',
      { label: 'Collapse All Folders', fn: () => { state.expanded.clear(); saveExpanded(); render(); } },
      { label: 'Open Bookmark Manager', fn: () => chrome.tabs.create({ url: 'chrome://bookmarks/?id=' + state.rootId }) },
      { label: 'Keyboard Shortcut…', fn: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) },
    ]);
    // open upward from the footer
    const m = $('#menu'); m.style.top = Math.max(4, r.top - m.getBoundingClientRect().height - 4) + 'px';
  });
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await (importMode === 'colors' ? restoreColors(f) : runImport(f));
  });

  const filter = $('#filter');
  filter.addEventListener('input', () => { state.filter = filter.value.trim(); render(); });
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { filter.value = ''; state.filter = ''; render(); filter.blur(); }
    if (e.key === 'Enter') { const first = $('#results [data-kind]'); if (first) first.click(); }
  });

  // Two-finger horizontal swipe switches spaces, like Arc.
  let swipe = 0, swipeLock = 0;
  $('#scroller').addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = Date.now();
    if (now < swipeLock) return;
    swipe += e.deltaX;
    if (Math.abs(swipe) > 90) { shiftSpace(swipe > 0 ? 1 : -1); swipe = 0; swipeLock = now + 450; }
  }, { passive: true });

  // Drag & drop
  app.addEventListener('dragstart', (e) => {
    const r = e.target.closest('[data-kind]');
    if (!r || r.dataset.kind === 'space') return e.preventDefault();
    drag = { kind: r.dataset.kind, id: r.dataset.id };
    const n = state.byId.get(r.dataset.id);
    const url = n ? n.url : (state.windowTabs.find((t) => String(t.id) === r.dataset.id) || {}).url;
    if (url) e.dataTransfer.setData('text/uri-list', url);
    e.dataTransfer.setData('text/plain', url || r.textContent);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => r.classList.add('dragging'));
  });
  app.addEventListener('dragover', (e) => {
    const t = targetFor(e);
    if (!allowed(t)) { clearDrop(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropT && dropT.el === t.el && dropT.zone === t.zone) return;
    clearDrop();
    t.el.classList.add('drop-' + t.zone);
    dropT = t;
    clearTimeout(hoverTimer);
    const k = t.el.dataset.kind;
    if (k === 'folder' && t.zone === 'into' && !state.expanded.has(t.el.dataset.id)) {
      const fid = t.el.dataset.id;
      hoverTimer = setTimeout(() => { state.expanded.add(fid); saveExpanded(); render(); }, 700);
    }
    if (k === 'space') {
      const sid = t.el.dataset.id;
      hoverTimer = setTimeout(() => setSpace(sid), 600);
    }
  });
  app.addEventListener('drop', async (e) => {
    e.preventDefault();
    clearTimeout(hoverTimer);
    const t = dropT;
    clearDrop();
    if (!t || !drag) return;
    const d = drag;
    try { await performDrop(t); } catch (err) { toast(err.message || String(err)); }
    drag = d === drag ? null : drag;
  });
  app.addEventListener('dragend', () => {
    clearTimeout(hoverTimer); clearDrop(); drag = null;
    document.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
  });

  // Live updates
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded'])
    chrome.bookmarks[ev] && chrome.bookmarks[ev].addListener(scheduleLoad);
  for (const ev of ['onCreated', 'onRemoved', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced'])
    chrome.tabs[ev].addListener(scheduleLoad);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.url || info.title || info.favIconUrl || info.status === 'complete') scheduleLoad();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.links) scheduleLoad();
    if (area === 'sync' && changes.colors) { state.colors = changes.colors.newValue || {}; render(); }
  });
}

// ---------- init ----------
(async function init() {
  const win = await chrome.windows.getCurrent();
  state.windowId = win.id;
  const saved = await chrome.storage.local.get(['expanded', 'activeSpace']);
  const synced = await chrome.storage.sync.get('colors');
  state.expanded = new Set(saved.expanded || []);
  state.colors = synced.colors || {};
  state.activeSpaceId = saved.activeSpace || null;
  await ensureRoot();
  wire();
  await load();
})();
