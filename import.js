// Parses Arc's StorableSidebar.json into a plain tree:
// { topApps: [{title,url}], spaces: [{title, icon, color, children}], stats }
// node = {type:'link', title, url} | {type:'folder', title, children}
function parseArcSidebar(json) {
  const containers = json && json.sidebar && json.sidebar.containers;
  if (!Array.isArray(containers)) throw new Error("This doesn't look like Arc's StorableSidebar.json.");
  const main = containers.find((c) => c && Array.isArray(c.items) && Array.isArray(c.spaces));
  if (!main) throw new Error('No spaces found in this file.');

  const pairs = (arr) => {
    const m = new Map();
    for (let i = 0; i + 1 < arr.length; i += 2) if (typeof arr[i] === 'string') m.set(arr[i], arr[i + 1]);
    return m;
  };
  const items = pairs(main.items);
  const spaces = pairs(main.spaces);
  const stats = { links: 0, folders: 0, splitViews: 0, notes: [], skipped: 0 };
  const seen = new Set();

  const kids = (it) => (it.childrenIds || []).flatMap(convert);
  function convert(id) {
    const it = items.get(id);
    if (!it || seen.has(id)) return [];
    seen.add(id);
    const d = it.data || {};
    if (d.tab) {
      const url = d.tab.savedURL;
      if (!url) { stats.skipped++; return []; }
      stats.links++;
      return [{ type: 'link', title: (it.title || d.tab.savedTitle || url).trim(), url }];
    }
    if (d.list) {
      stats.folders++;
      return [{ type: 'folder', title: (it.title || 'Untitled').trim(), children: kids(it) }];
    }
    if (d.splitView) { stats.splitViews++; return kids(it); } // flatten: its tabs become normal links
    if (d.itemContainer) return kids(it);
    if (d.arcDocument) { stats.notes.push(it.title || 'Untitled note'); return []; }
    stats.skipped++;
    return kids(it);
  }

  const toHex = (c) => {
    if (!c || typeof c.red !== 'number') return null;
    const h = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return '#' + h(c.red) + h(c.green) + h(c.blue);
  };

  const outSpaces = [];
  for (const s of spaces.values()) {
    if (!s || !Array.isArray(s.containerIDs)) continue;
    const cids = pairs(s.containerIDs);
    const info = s.customInfo || {};
    const iconType = info.iconType || {};
    const icon = iconType.emoji_v2 || (typeof iconType.emoji === 'number' ? String.fromCodePoint(iconType.emoji) : null);
    const pal = info.windowTheme && info.windowTheme.semanticColorPalette &&
      info.windowTheme.semanticColorPalette.appearanceBased;
    const color = toHex(pal && pal.light && pal.light.background);
    const children = cids.has('pinned') ? convert(cids.get('pinned')) : [];
    const unpinned = cids.has('unpinned') ? convert(cids.get('unpinned')) : [];
    if (unpinned.length) children.push({ type: 'folder', title: 'Unpinned (from Arc)', children: unpinned });
    outSpaces.push({ title: (s.title || 'Space').trim(), icon, color, children });
  }

  // Top apps: prefer the default profile's container.
  const topApps = [];
  const ta = Array.isArray(main.topAppsContainerIDs) ? main.topAppsContainerIDs : [];
  const tops = [];
  for (let i = 0; i + 1 < ta.length; i += 2) tops.push({ profile: ta[i], id: ta[i + 1] });
  tops.sort((a, b) => (b.profile && b.profile.default ? 1 : 0) - (a.profile && a.profile.default ? 1 : 0));
  const flatten = (nodes) => nodes.flatMap((n) => (n.type === 'link' ? [n] : flatten(n.children)));
  for (const t of tops) {
    const links = flatten(convert(t.id));
    if (links.length) { topApps.push(...links); break; }
  }

  return { topApps, spaces: outSpaces, stats };
}

if (typeof module !== 'undefined') module.exports = { parseArcSidebar };
