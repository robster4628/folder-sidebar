'use strict';
// Media drawer: Chrome tabs playing sound, Chromecasts (through the local cast helper)
// and the user's own Spotify account (Spotify Web API).
// Relies on helpers from sidepanel.js: $, el, toast, modal, buttons, showMenu, confirmBox, state.

const Media = (() => {
  const HELPER = 'http://127.0.0.1:47800';
  const SITE_ORIGINS = ['*://*.youtube.com/*', '*://listen.tidal.com/*', '*://open.spotify.com/*', '*://*.soundcloud.com/*', '*://*.bandcamp.com/*'];
  // [host regex, selectors] — passed into pages as plain strings.
  const SITES = [
    ['(^|\\.)music\\.youtube\\.com$', { play: '#play-pause-button', next: 'ytmusic-player-bar .next-button', prev: 'ytmusic-player-bar .previous-button' }],
    ['(^|\\.)youtube\\.com$', { play: '.ytp-play-button', next: '.ytp-next-button', prev: '.ytp-prev-button' }],
    ['^listen\\.tidal\\.com$', { play: '[data-test="play"], [data-test="pause"]', next: '[data-test="next"]', prev: '[data-test="previous"]' }],
    ['^open\\.spotify\\.com$', { play: '[data-testid="control-button-playpause"]', next: '[data-testid="control-button-skip-forward"]', prev: '[data-testid="control-button-skip-back"]' }],
    ['(^|\\.)soundcloud\\.com$', { play: '.playControl', next: '.skipControl__next', prev: '.skipControl__previous' }],
    ['(^|\\.)bandcamp\\.com$', { play: '.inline_player .playbutton, .playbutton', next: '.inline_player .nextbutton', prev: '.inline_player .prevbutton' }],
  ];
  const ICON = {
    prev: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 2.5h1.6v11H3zM14 2.8v10.4a.5.5 0 0 1-.78.42L5.6 8.42a.5.5 0 0 1 0-.84l7.62-5.2A.5.5 0 0 1 14 2.8z" fill="currentColor"/></svg>',
    next: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M11.4 2.5H13v11h-1.6zM2 2.8v10.4a.5.5 0 0 0 .78.42l7.62-5.2a.5.5 0 0 0 0-.84L2.78 2.38A.5.5 0 0 0 2 2.8z" fill="currentColor"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 2.6v10.8a.6.6 0 0 0 .92.5l8.4-5.4a.6.6 0 0 0 0-1L4.92 2.1A.6.6 0 0 0 4 2.6z" fill="currentColor"/></svg>',
    pause: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3" height="11" rx=".8" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx=".8" fill="currentColor"/></svg>',
    heart: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M8 13.6S2 10 2 5.9A3.1 3.1 0 0 1 8 4.4a3.1 3.1 0 0 1 6 1.5C14 10 8 13.6 8 13.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    hearted: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M8 13.6S2 10 2 5.9A3.1 3.1 0 0 1 8 4.4a3.1 3.1 0 0 1 6 1.5C14 10 8 13.6 8 13.6z" fill="#1ed760" stroke="#1ed760" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    addto: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 4h8M2 7.5h8M2 11h5M12 9v5M9.5 11.5h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    playlists: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 4h9M2 7.5h9M2 11h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 10v4.2a.4.4 0 0 0 .62.33l3.2-2.1a.4.4 0 0 0 0-.66l-3.2-2.1A.4.4 0 0 0 10 10z" fill="currentColor"/></svg>',
    stop: '<svg width="12" height="12" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/></svg>',
    vol: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    muted: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/><path d="M10.5 6l4 4m0-4l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  };
  // Web app to open for a Chromecast app / Spotify, matched by app name.
  const APP_SITES = [
    [/spotify/i, 'open.spotify.com'], [/youtube music/i, 'music.youtube.com'], [/youtube/i, 'www.youtube.com'],
    [/tidal/i, 'listen.tidal.com'], [/soundcloud/i, 'soundcloud.com'], [/pandora/i, 'www.pandora.com'],
    [/apple music/i, 'music.apple.com'], [/amazon music/i, 'music.amazon.com'], [/deezer/i, 'www.deezer.com'],
  ];
  const SPOTIFY_BASE_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
  const SPOTIFY_EXTRA_SCOPES = 'user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public';
  const SPOTIFY_SCOPES = SPOTIFY_BASE_SCOPES + ' ' + SPOTIFY_EXTRA_SCOPES;

  const m = {
    open: false,
    tabs: [],          // items from Chrome tabs
    casts: [],         // items from Chromecasts
    castDevices: 0,
    helper: 'unknown', // 'ok' | 'off' | 'unknown'
    spotify: null,     // item or null
    spotifyAuth: null, // {clientId, access, refresh, expires}
    spotifyError: null,
    spotifyBackoffUntil: 0,
    sitesAllowed: false,
    focusKey: null,    // last item the user touched (mini player prefers it)
    lastPlaying: {},   // key -> time it was last seen playing
    hiddenSig: null,   // mini player dismissed for this track
    dragging: false,
    tick: 0,
  };

  // ---------- code that runs inside music pages ----------
  function probePage(sites) {
    const host = location.hostname;
    const hit = sites.find(([re]) => new RegExp(re).test(host));
    const site = hit ? hit[1] : null;
    const usable = (q) => {
      const e = q && document.querySelector(q);
      return !!(e && e.offsetParent !== null && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    };
    const hooked = typeof window.__fsMedia === 'function' ? window.__fsMedia() : [];
    const els = [...new Set([...document.querySelectorAll('video, audio'), ...hooked])];
    const acts = window.__fsActions || {};
    const live = els.find((e) => !e.paused && !e.ended) ||
      els.filter((e) => e.currentTime > 0).sort((a, b) => (b.duration || 0) - (a.duration || 0))[0] || null;
    const ms = navigator.mediaSession;
    const md = ms && ms.metadata;
    let art = null;
    if (md && md.artwork && md.artwork.length) {
      const size = (a) => parseInt(String(a.sizes || '0').split(/[x ]/)[0], 10) || 0;
      art = [...md.artwork].sort((a, b) => size(b) - size(a))[0].src;
    }
    if (!art && /(^|\.)youtube\.com$/.test(host)) {
      const v = new URLSearchParams(location.search).get('v');
      if (v) art = 'https://i.ytimg.com/vi/' + v + '/mqdefault.jpg';
    }
    const playing = live ? !live.paused && !live.ended : !!(ms && ms.playbackState === 'playing');
    const yt = document.getElementById('movie_player');
    let volume = null;
    if (yt && typeof yt.getVolume === 'function') volume = Math.round(yt.getVolume());
    else if (live || els[0]) volume = Math.round((live || els[0]).volume * 100);
    return {
      hasMedia: els.length > 0 || !!md,
      supported: !!site,
      title: (md && md.title) || document.title,
      artist: (md && md.artist) || '',
      art,
      playing,
      position: live ? live.currentTime : null,
      duration: live && isFinite(live.duration) ? live.duration : null,
      canNext: (!!site && usable(site.next)) || !!acts.nexttrack,
      canPrev: (!!site && usable(site.prev)) || !!acts.previoustrack,
      volume,
      // Added after the page's player was already set up: reload once to get volume / skip.
      lateHook: window.__fsEarly === false && !hooked.length && !acts.nexttrack && !(live && live.isConnected),
    };
  }
  function actOnPage(sites, action, level) {
    const host = location.hostname;
    const hit = sites.find(([re]) => new RegExp(re).test(host));
    const site = hit ? hit[1] : null;
    const click = (q) => { const b = q && document.querySelector(q); if (b) { b.click(); return true; } return false; };
    const hooked = typeof window.__fsMedia === 'function' ? window.__fsMedia() : [];
    const acts = window.__fsActions || {};
    const fire = (name) => { if (typeof acts[name] !== 'function') return false; acts[name]({ action: name }); return true; };
    if (action === 'toggle') {
      if (site && click(site.play)) return true;
      const els = [...new Set([...document.querySelectorAll('video, audio'), ...hooked])];
      const isPlaying = els.some((e) => !e.paused) || (navigator.mediaSession && navigator.mediaSession.playbackState === 'playing');
      if (fire(isPlaying ? 'pause' : 'play')) return true;
      const playing = els.filter((e) => !e.paused);
      if (playing.length) playing.forEach((e) => e.pause());
      else { const e = els.find((x) => x.currentTime > 0) || els[0]; if (e) e.play(); }
      return true;
    }
    if (action === 'volume') {
      const v = Math.max(0, Math.min(100, Number(level) || 0));
      const yt = document.getElementById('movie_player');
      if (yt && typeof yt.setVolume === 'function') {
        yt.setVolume(v);
        if (v > 0 && yt.isMuted && yt.isMuted()) yt.unMute();
      } else {
        new Set([...document.querySelectorAll('video, audio'), ...hooked]).forEach((e) => { e.volume = v / 100; if (v > 0) e.muted = false; });
      }
      return true;
    }
    if (action === 'next') return click(site && site.next) || fire('nexttrack');
    if (action === 'prev') return click(site && site.prev) || fire('previoustrack');
    return false;
  }

  // ---------- Chrome tabs ----------
  async function loadTabs() {
    const [{ mediaTabs = {} }, audible] = await Promise.all([
      chrome.storage.session.get('mediaTabs'),
      chrome.tabs.query({ audible: true }),
    ]);
    const ids = new Set([...Object.keys(mediaTabs).map(Number), ...audible.map((t) => t.id)]);
    const items = [];
    const dropped = [];
    await Promise.all([...ids].map(async (id) => {
      let tab;
      try { tab = await chrome.tabs.get(id); } catch { dropped.push(id); return; }
      if (!tab.url || tab.url.startsWith(chrome.runtime.getURL(''))) return;
      let info = null;
      try {
        await chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', files: ['hook.js'] });
        const [r] = await chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', func: probePage, args: [SITES] });
        info = r && r.result;
      } catch { /* no access to this site */ }
      if (info && !info.hasMedia && !tab.audible) { dropped.push(id); return; }
      let host = '';
      try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch {}
      items.push({
        key: 'tab:' + id, kind: 'tab', tabId: id, windowId: tab.windowId,
        title: (info && info.title) || tab.title || host,
        artist: (info && info.artist) || '',
        source: host,
        art: info && info.art, favicon: favicon(tab.url, tab),
        playing: info ? info.playing : !!tab.audible,
        position: info && info.position, duration: info && info.duration, ts: Date.now(),
        canToggle: !!info, canNext: !!(info && info.canNext), canPrev: !!(info && info.canPrev),
        muted: !!(tab.mutedInfo && tab.mutedInfo.muted),
        volume: info && info.volume != null ? info.volume : null,
        lateHook: !!(info && info.lateHook && info.volume == null),
        limited: !info, // no site access: only mute / jump
        needsAccess: !info && /^https?:/.test(tab.url) ? siteOrigin(host) : null,
        order: mediaTabs[id] || Date.now(),
      });
    }));
    if (dropped.length) {
      for (const id of dropped) delete mediaTabs[id];
      chrome.storage.session.set({ mediaTabs });
    }
    items.sort((a, b) => (b.playing - a.playing) || (b.order - a.order));
    m.tabs = items;
  }
  async function tabAction(item, action, body) {
    if (action === 'mute') return chrome.tabs.update(item.tabId, { muted: !item.muted });
    if (action === 'jump') {
      await chrome.tabs.update(item.tabId, { active: true });
      return chrome.windows.update(item.windowId, { focused: true });
    }
    if (action === 'dismiss') {
      const { mediaTabs = {} } = await chrome.storage.session.get('mediaTabs');
      delete mediaTabs[item.tabId];
      await chrome.storage.session.set({ mediaTabs });
      m.tabs = m.tabs.filter((t) => t !== item);
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: item.tabId }, world: 'MAIN', func: actOnPage,
      args: [SITES, action, body && body.level != null ? body.level : null],
    });
  }
  function siteOrigin(host) {
    if (!host) return null;
    if (/^[\d.]+$/.test(host) || host === 'localhost') return '*://' + host + '/*';
    const parts = host.split('.');
    const base = parts.slice(-2).join('.');
    return '*://*.' + base + '/*'; // also matches the bare domain
  }
  async function allowSite(origin, host) {
    const ok = await chrome.permissions.request({ origins: [origin] });
    if (ok) toast(`Controls turned on for ${host}. If skip doesn't work yet, reload that tab once.`, 6000);
    refresh(true);
  }
  async function allowSites() {
    const ok = await chrome.permissions.request({ origins: SITE_ORIGINS });
    m.sitesAllowed = ok;
    if (ok) toast('Music site controls turned on.');
    refresh(true);
  }

  // ---------- Chromecasts ----------
  async function loadCasts() {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(HELPER + '/status', { signal: ctl.signal });
      clearTimeout(t);
      const { devices = [] } = await r.json();
      m.helper = 'ok';
      m.castDevices = devices.length;
      m.casts = devices.filter((d) => d.media && !d.idle).map((d) => ({
        key: 'cast:' + d.id, kind: 'cast', id: d.id,
        title: d.media.title || d.app || 'Casting',
        artist: d.media.artist || (d.media.title ? d.app : '') || '',
        source: d.name + (d.app ? ' · ' + d.app : ''), device: d.name, app: d.app,
        art: d.media.art,
        playing: d.media.state === 'PLAYING' || d.media.state === 'BUFFERING',
        position: d.media.position, duration: d.media.duration, ts: Date.now(),
        canToggle: true, canNext: true, canPrev: true,
        nextHinted: d.media.canNext, prevHinted: d.media.canPrev,
        volume: d.volume, muted: d.muted,
      }));
    } catch {
      m.helper = 'off';
      m.casts = [];
      m.castDevices = 0;
    }
  }
  async function castAction(item, action, body) {
    const path = action === 'toggle' ? (item.playing ? 'pause' : 'play') : action;
    const r = await fetch(`${HELPER}/cast/${encodeURIComponent(item.id)}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || 'The Chromecast didn’t accept that.');
    }
  }

  // ---------- Spotify ----------
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function saveAuth() { await chrome.storage.local.set({ spotify: m.spotifyAuth }); }
  let refreshing = null;
  async function spToken() {
    const a = m.spotifyAuth;
    if (!a || !a.refresh) return null;
    if (a.access && Date.now() < a.expires - 60000) return a.access;
    if (!refreshing) {
      refreshing = (async () => {
        const r = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: a.clientId }),
        });
        if (!r.ok) {
          if (r.status === 400 || r.status === 401) { a.refresh = null; a.access = null; await saveAuth(); m.spotifyError = 'Spotify sign-in expired. Reconnect below.'; }
          throw new Error('Spotify token refresh failed');
        }
        const j = await r.json();
        a.access = j.access_token;
        a.expires = Date.now() + j.expires_in * 1000;
        if (j.refresh_token) a.refresh = j.refresh_token;
        if (j.scope) a.scope = j.scope;
        await saveAuth();
      })().finally(() => { refreshing = null; });
    }
    await refreshing;
    return a.access;
  }
  async function sp(path, method = 'GET', body, retried) {
    const token = await spToken();
    if (!token) return null;
    const r = await fetch('https://api.spotify.com/v1' + path, {
      method,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && !retried) { m.spotifyAuth.expires = 0; return sp(path, method, body, true); }
    if (r.status === 429) {
      m.spotifyBackoffUntil = Date.now() + (Number(r.headers.get('Retry-After')) || 10) * 1000;
      throw new Error('Spotify is rate-limiting; trying again shortly.');
    }
    if (r.status === 204) return {};
    const text = await r.text();
    let j = {};
    try { j = text ? JSON.parse(text) : {}; } catch {}
    if (!r.ok) {
      const msg = (j.error && j.error.message) || r.statusText;
      throw new Error(r.status === 403 ? `Spotify refused: ${msg}` : msg);
    }
    return j;
  }
  async function loadSpotify() {
    if (!m.spotifyAuth || !m.spotifyAuth.refresh || Date.now() < m.spotifyBackoffUntil) return;
    try {
      const p = await sp('/me/player?additional_types=episode');
      m.spotifyError = null;
      if (!p || !p.item) { m.spotify = null; return; }
      const it = p.item;
      const images = (it.album && it.album.images) || it.images || (it.show && it.show.images) || [];
      m.spotify = {
        key: 'spotify', kind: 'spotify',
        title: it.name,
        artist: it.artists ? it.artists.map((a) => a.name).join(', ') : (it.show ? it.show.name : ''),
        source: 'Spotify', device: p.device ? p.device.name : '', deviceId: p.device && p.device.id,
        art: images.length ? images[Math.min(1, images.length - 1)].url : null,
        playing: !!p.is_playing,
        position: (p.progress_ms || 0) / 1000, duration: (it.duration_ms || 0) / 1000, ts: Date.now(),
        canToggle: true, canNext: true, canPrev: true,
        volume: p.device && p.device.supports_volume !== false ? p.device.volume_percent : null,
        uri: it.uri, isTrack: it.type === 'track',
        liked: likedCache.has(it.uri) ? likedCache.get(it.uri) : null,
      };
      if (it.type === 'track' && !likedCache.has(it.uri) && hasExtraScopes()) checkLiked(it.uri);
    } catch (e) {
      if (!m.spotifyError) m.spotifyError = e.message;
    }
  }
  // ----- likes & playlists -----
  const likedCache = new Map(); // uri -> boolean
  let playlistCache = null, playlistCacheAt = 0;
  function hasExtraScopes() {
    const granted = ((m.spotifyAuth && m.spotifyAuth.scope) || '').split(' ');
    return SPOTIFY_EXTRA_SCOPES.split(' ').every((x) => granted.includes(x));
  }
  function needReconnect() {
    if (hasExtraScopes()) return false;
    toast('Reconnect Spotify (⋯ → Music Settings → Disconnect, then Connect) to turn on likes and playlists.', 7000);
    return true;
  }
  async function checkLiked(uri) {
    likedCache.set(uri, null);
    try {
      let r;
      try { r = await sp('/me/library/contains?uris=' + encodeURIComponent(uri)); }
      catch { r = await sp('/me/tracks/contains?ids=' + uri.split(':').pop()); }
      likedCache.set(uri, Array.isArray(r) ? !!r[0] : null);
      if (m.spotify && m.spotify.uri === uri) { m.spotify.liked = likedCache.get(uri); render(); }
    } catch { likedCache.delete(uri); }
  }
  async function toggleLike(item) {
    if (needReconnect() || !item.uri) return;
    const want = !item.liked;
    const q = encodeURIComponent(item.uri);
    try {
      try { await sp('/me/library?uris=' + q, want ? 'PUT' : 'DELETE'); }
      catch { await sp('/me/tracks?ids=' + item.uri.split(':').pop(), want ? 'PUT' : 'DELETE'); }
      likedCache.set(item.uri, want);
      item.liked = want;
      render();
      toast(want ? 'Added to Liked Songs' : 'Removed from Liked Songs');
    } catch (e) { toast(e.message); }
  }
  async function playlists() {
    if (playlistCache && Date.now() - playlistCacheAt < 5 * 60 * 1000) return playlistCache;
    const out = [];
    let url = '/me/playlists?limit=50';
    while (url && out.length < 300) {
      const r = await sp(url);
      out.push(...((r && r.items) || []).filter(Boolean));
      url = r && r.next ? r.next.replace('https://api.spotify.com/v1', '') : null;
    }
    playlistCache = out; playlistCacheAt = Date.now();
    return out;
  }
  async function addToPlaylistMenu(item, x, y) {
    if (needReconnect() || !item.uri) return;
    try {
      const list = await playlists();
      if (!list.length) return toast('No playlists found.');
      showMenu(x, y, list.map((pl) => ({
        label: pl.name,
        fn: async () => {
          try {
            try { await sp(`/playlists/${pl.id}/items`, 'POST', { uris: [item.uri] }); }
            catch (e) { if (/not found/i.test(e.message)) await sp(`/playlists/${pl.id}/tracks`, 'POST', { uris: [item.uri] }); else throw e; }
            toast(`Added to ${pl.name}`);
          } catch (e) { toast(/forbidden|refused/i.test(e.message) ? `You can't add to “${pl.name}” (not yours).` : e.message); }
        },
      })));
    } catch (e) { toast(e.message); }
  }
  async function playPlaylistMenu(x, y) {
    if (needReconnect()) return;
    try {
      const list = await playlists();
      if (!list.length) return toast('No playlists found.');
      showMenu(x, y, list.map((pl) => ({
        label: pl.name,
        fn: async () => {
          try {
            const dev = m.spotify && m.spotify.deviceId;
            await sp('/me/player/play' + (dev ? '?device_id=' + encodeURIComponent(dev) : ''), 'PUT', { context_uri: pl.uri });
            m.focusKey = 'spotify';
            setTimeout(() => refresh(true), 700);
          } catch (e) {
            toast(/no active device|not found/i.test(e.message) ? 'Start Spotify on a device first (phone, desktop app or web player), then try again.' : e.message, 6000);
          }
        },
      })));
    } catch (e) { toast(e.message); }
  }

  async function spotifyAction(item, action, body) {
    if (action === 'toggle') await sp(item.playing ? '/me/player/pause' : '/me/player/play', 'PUT');
    else if (action === 'next') await sp('/me/player/next', 'POST');
    else if (action === 'prev') await sp('/me/player/previous', 'POST');
    else if (action === 'volume') await sp('/me/player/volume?volume_percent=' + Math.round(body.level), 'PUT');
    else if (action === 'transfer') await sp('/me/player', 'PUT', { device_ids: [body.deviceId], play: true });
  }
  async function spotifyDevicesMenu(item, x, y) {
    try {
      const { devices = [] } = (await sp('/me/player/devices')) || {};
      if (!devices.length) return toast('No Spotify devices available right now.');
      showMenu(x, y, devices.map((d) => ({
        label: (d.is_active ? '✓ ' : ' ') + d.name,
        fn: () => run(item, 'transfer', { deviceId: d.id }),
      })));
    } catch (e) { toast(e.message); }
  }
  async function connectSpotify() {
    const redirect = chrome.identity.getRedirectURL('spotify');
    const prev = (m.spotifyAuth && m.spotifyAuth.clientId) || '';
    const clientId = await modal((box, done) => {
      box.append(el('p', '', 'Connect your Spotify account'));
      const ol = el('ol');
      const li1 = el('li', '', 'Open ');
      const a = el('a', '', 'developer.spotify.com/dashboard');
      a.href = 'https://developer.spotify.com/dashboard'; a.target = '_blank';
      li1.append(a, ' and click Create app (any name and description).');
      const li2 = el('li', '', 'Add this Redirect URI:');
      const code = el('code', '', redirect);
      const copy = el('button', '', 'Copy');
      copy.onclick = () => navigator.clipboard.writeText(redirect).then(() => (copy.textContent = 'Copied'));
      li2.append(code, copy);
      const li3 = el('li', '', 'Tick “Web API”, save, then paste the Client ID from the app’s settings:');
      ol.append(li1, li2, li3);
      box.append(ol);
      const i = el('input'); i.type = 'text'; i.value = prev; i.placeholder = 'Client ID';
      i.onkeydown = (e) => { if (e.key === 'Enter') done(i.value.trim() || null); };
      box.append(i);
      buttons(box, done, 'Connect', 'primary', () => i.value.trim() || null);
    });
    if (!clientId) return;
    try {
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const stateParam = b64url(crypto.getRandomValues(new Uint8Array(12)));
      const url = new URL('https://accounts.spotify.com/authorize');
      url.search = new URLSearchParams({
        client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: SPOTIFY_SCOPES,
        code_challenge_method: 'S256', code_challenge: challenge, state: stateParam,
      });
      const back = new URL(await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true }));
      if (back.searchParams.get('state') !== stateParam) throw new Error('Sign-in was interrupted. Try again.');
      if (back.searchParams.get('error')) throw new Error('Spotify said: ' + back.searchParams.get('error'));
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code: back.searchParams.get('code'),
          redirect_uri: redirect, client_id: clientId, code_verifier: verifier,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error_description || j.error || 'Token exchange failed');
      m.spotifyAuth = { clientId, access: j.access_token, refresh: j.refresh_token, expires: Date.now() + j.expires_in * 1000, scope: j.scope || '' };
      m.spotifyError = null;
      await saveAuth();
      toast('Spotify connected.');
      refresh(true);
    } catch (e) {
      toast(e.message || String(e), 7000);
    }
  }
  async function disconnectSpotify() {
    if (!(await confirmBox('Disconnect Spotify from the sidebar?', 'Disconnect'))) return;
    m.spotifyAuth = m.spotifyAuth ? { clientId: m.spotifyAuth.clientId } : null;
    m.spotify = null;
    await saveAuth();
    render();
  }

  // ---------- combined ----------
  function items() {
    const list = [];
    if (m.spotify) list.push(m.spotify);
    const sp = m.spotify;
    for (const c of m.casts) {
      // Spotify playing on a Chromecast is already shown (with better controls) by the Spotify card.
      if (sp && /spotify/i.test(c.source) && (c.device === sp.device || c.title === sp.title)) continue;
      list.push(c);
    }
    for (const t of m.tabs) {
      // Same for the Spotify web player tab.
      if (sp && t.source === 'open.spotify.com') continue;
      list.push(t);
    }
    return list.sort((a, b) => b.playing - a.playing);
  }
  const PAUSED_GRACE = 3 * 60 * 1000; // keep a paused track in the mini player for 3 minutes
  const sig = (i) => i.key + '|' + i.title;
  function current() {
    const all = items();
    const now = Date.now();
    for (const i of all) if (i.playing) m.lastPlaying[i.key] = now;
    const playing = all.filter((i) => i.playing);
    if (playing.length) return playing.find((i) => i.key === m.focusKey) || playing[0];
    // Nothing playing: only show something the user recently had playing.
    const recent = all
      .filter((i) => now - (m.lastPlaying[i.key] || 0) < PAUSED_GRACE)
      .sort((a, b) => (b.key === m.focusKey) - (a.key === m.focusKey) || m.lastPlaying[b.key] - m.lastPlaying[a.key]);
    return recent[0] || null;
  }
  const posNow = (i) => (i.position == null ? null : i.position + (i.playing ? (Date.now() - i.ts) / 1000 : 0));

  async function run(item, action, body) {
    m.focusKey = item.key;
    try {
      if (item.kind === 'tab') await tabAction(item, action, body);
      else if (item.kind === 'cast') await castAction(item, action, body);
      else await spotifyAction(item, action, body);
      if (action === 'toggle') { item.playing = !item.playing; item.position = posNow(item); item.ts = Date.now(); }
      if (action === 'volume' && body) item.volume = body.level;
      if (action === 'mute') item.muted = !item.muted;
      render();
    } catch (e) {
      toast(e.message || String(e));
    }
    setTimeout(() => refresh(true), item.kind === 'spotify' ? 700 : 350);
  }

  async function openApp(item) {
    if (item.kind === 'tab') return tabAction(item, 'jump');
    const name = item.kind === 'spotify' ? 'Spotify' : item.app || '';
    const hit = APP_SITES.find(([re]) => re.test(name));
    if (!hit) return toast(`No web app known for ${name || 'this'}.`);
    const host = hit[1];
    const tabs = await chrome.tabs.query({ url: `*://${host}/*` });
    const t = tabs.find((x) => x.windowId === state.windowId) || tabs[0];
    if (t) {
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: `https://${host}/`, windowId: state.windowId });
    }
  }

  // ---------- render ----------
  function artBox(item, cls) {
    const a = el('div', cls || 'art');
    if (item.art) { const i = el('img'); i.src = item.art; i.alt = ''; a.append(i); }
    else if (item.favicon) { const i = el('img', 'fav'); i.src = item.favicon; i.alt = ''; a.append(i); }
    else a.textContent = item.kind === 'cast' ? '📡' : '♪';
    return a;
  }
  function btn(label, title, fn, disabled, cls) {
    const b = el('button', cls || '');
    if (ICON[label]) b.innerHTML = ICON[label]; else b.textContent = label;
    b.title = title;
    b.disabled = !!disabled;
    b.onclick = (e) => { e.stopPropagation(); fn(e); };
    return b;
  }
  function volumeSlider(item) {
    const r = el('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = item.volume; r.title = 'Volume';
    r.onpointerdown = () => (m.dragging = true);
    // Tabs follow the slider live; Chromecast and Spotify update when you let go.
    if (item.kind === 'tab') r.oninput = () => tabAction(item, 'volume', { level: Number(r.value) }).catch(() => {});
    r.onchange = () => { m.dragging = false; run(item, 'volume', { level: Number(r.value) }); };
    r.onblur = () => (m.dragging = false);
    return r;
  }
  function card(item) {
    const c = el('div', 'mcard');
    const goTitle = item.kind === 'tab' ? 'Go to this tab' : 'Open the web app';
    const art = artBox(item);
    art.classList.add('jump'); art.title = goTitle; art.onclick = () => openApp(item);
    c.append(art);
    const meta = el('div', 'meta');
    const title = el('div', 't jump', item.title || 'Untitled');
    title.title = goTitle; title.onclick = () => openApp(item);
    meta.append(title);
    if (item.artist) meta.append(el('div', 'a', item.artist));
    const src = el('div', 'src');
    if (item.kind === 'spotify') {
      src.append('Spotify');
      if (item.device) src.append(' on ', btn(item.device + ' ▾', 'Play on another device', (e) => spotifyDevicesMenu(item, e.clientX, e.clientY)));
    } else if (item.kind === 'tab') {
      src.append(btn(item.source + ' ↗', 'Go to this tab', () => run(item, 'jump')));
      src.append(btn('×', 'Remove from this list', () => run(item, 'dismiss')));
    } else src.append(item.source);
    meta.append(src);
    c.append(meta);

    const ctrls = el('div', 'ctrls');
    ctrls.append(
      btn('prev', 'Previous', () => run(item, 'prev'), !item.canPrev),
      btn(item.playing ? 'pause' : 'play', item.playing ? 'Pause' : 'Play', () => run(item, 'toggle'), !item.canToggle, 'pp'),
      btn('next', 'Next', () => run(item, 'next'), !item.canNext),
      el('span', 'grow'),
    );
    if (item.kind === 'tab') {
      ctrls.append(btn(item.muted ? 'muted' : 'vol', item.muted ? 'Unmute tab' : 'Mute tab', () => run(item, 'mute')));
      if (item.volume != null) ctrls.append(volumeSlider(item));
    } else {
      if (item.kind === 'spotify') {
        if (item.isTrack) {
          ctrls.append(btn(item.liked ? 'hearted' : 'heart', item.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs', () => toggleLike(item)));
          ctrls.append(btn('addto', 'Add to playlist', (e) => addToPlaylistMenu(item, e.clientX, e.clientY)));
        }
        ctrls.append(btn('playlists', 'Play a playlist', (e) => playPlaylistMenu(e.clientX, e.clientY)));
      }
      if (item.kind === 'cast') ctrls.append(btn(item.muted ? 'muted' : 'vol', item.muted ? 'Unmute' : 'Mute', () => run(item, 'mute', { muted: !item.muted })));
      if (item.volume != null) ctrls.append(volumeSlider(item));
      if (item.kind === 'cast') ctrls.append(btn('stop', 'Stop casting', () => run(item, 'stop')));
    }
    c.append(ctrls);

    if (item.duration) {
      const bar = el('div', 'bar'), fill = el('div');
      fill.style.width = Math.min(100, (100 * (posNow(item) || 0)) / item.duration) + '%';
      bar.append(fill);
      c.append(bar);
    }
    if (item.lateHook) {
      c.append(btn('Reload this tab once for volume & skip', 'The sidebar connected after this player started', () => chrome.tabs.reload(item.tabId), false, 'linkbtn allow'));
    }
    if (item.needsAccess) {
      c.append(btn(`Allow controls on ${item.source}`, 'Lets the sidebar play, pause, skip and set volume on this site', () => allowSite(item.needsAccess, item.source), false, 'linkbtn allow'));
    }
    return c;
  }
  function openSettings() {
    modal((box, done) => {
      box.append(el('p', '', 'Music settings'));
      const list = el('div', 'msettings');
      const row = (dotCls, text, ...btns) => {
        const r = el('div', 'srow');
        r.append(el('i', 'dot ' + dotCls), el('span', '', text), ...btns);
        list.append(r);
      };
      // Each action closes this dialog first, since it may open its own.
      const then = (fn) => () => { done(null); fn(); };
      row(m.sitesAllowed ? 'ok' : '', m.sitesAllowed ? 'Music site controls on' : 'Music site controls off',
        ...(m.sitesAllowed ? [] : [btn('Turn on', 'YouTube, YouTube Music, Tidal, Spotify web, SoundCloud, Bandcamp', then(allowSites), false, 'linkbtn')]));
      if (m.helper === 'ok') row('ok', `Chromecast helper running · ${m.castDevices} device${m.castDevices === 1 ? '' : 's'}`);
      else row('off', 'Chromecast helper not running', btn('How?', 'Set up the helper', then(helperHelp), false, 'linkbtn'));
      const connected = m.spotifyAuth && m.spotifyAuth.refresh;
      if (connected) row(m.spotifyError ? 'off' : 'ok', m.spotifyError || 'Spotify connected', btn('Disconnect', '', then(disconnectSpotify), false, 'linkbtn'));
      else row('', m.spotifyError || 'Spotify not connected', btn('Connect', '', then(connectSpotify), false, 'linkbtn'));
      box.append(list);
      const b = el('div', 'btns'); const ok = el('button', 'primary', 'Done'); ok.onclick = () => done(true); b.append(ok); box.append(b);
    });
  }
  function helperHelp() {
    modal((box, done) => {
      box.append(el('p', '', 'The Chromecast helper is a small background app on this Mac. To install it, run this in Terminal from your Folder Sidebar folder:'));
      box.append(el('code', '', 'bash cast-helper/install.sh'));
      box.append(el('p', '', 'If macOS asks about finding devices on your local network, click Allow.'));
      const b = el('div', 'btns'); const ok = el('button', 'primary', 'OK'); ok.onclick = () => done(true); b.append(ok); box.append(b);
    });
  }
  function renderMini() {
    const mini = $('#miniPlayer');
    const cur = current();
    $('#mediaBtn').classList.toggle('playing', items().some((i) => i.playing));
    $('#mediaBtn').classList.toggle('active', m.open);
    if (m.open || !cur || m.hiddenSig === sig(cur)) { mini.hidden = true; return; }
    mini.hidden = false;
    mini.replaceChildren(artBox(cur, 'art'));
    const meta = el('div', 'meta');
    meta.append(el('div', 't', cur.title || ''), el('div', 'a', cur.artist || cur.source || ''));
    mini.append(meta,
      btn(cur.playing ? 'pause' : 'play', cur.playing ? 'Pause' : 'Play', () => run(cur, 'toggle'), !cur.canToggle),
      btn('next', 'Next', () => run(cur, 'next'), !cur.canNext),
      btn('×', 'Hide until the next track', () => { m.hiddenSig = sig(cur); renderMini(); }, false, 'hide'));
  }
  function render() {
    renderMini();
    if (!m.open || m.dragging) return;
    const list = $('#mediaList');
    list.replaceChildren();
    const all = items();
    if (!all.length) list.append(el('div', 'mempty', 'Nothing playing. Sources are set up in ⋯ → Music Settings.'));
    for (const i of all) list.append(card(i));
    if (!m.spotify && m.spotifyAuth && m.spotifyAuth.refresh) {
      list.append(btn('Play a Spotify playlist…', 'Pick one of your playlists', (e) => playPlaylistMenu(e.clientX, e.clientY), false, 'linkbtn sp-play'));
    }
  }

  // ---------- polling ----------
  let busy = false;
  async function refresh(force) {
    if (busy && !force) return;
    busy = true;
    const t = m.tick++;
    try {
      const jobs = [];
      if (force || m.open || t % 3 === 0) jobs.push(loadTabs());
      if (force || (m.open ? t % 2 === 0 : t % 5 === 0)) jobs.push(loadCasts());
      if (force || (m.open ? t % 4 === 0 : t % 15 === 0)) jobs.push(loadSpotify());
      await Promise.all(jobs.map((p) => p.catch(() => {})));
    } finally { busy = false; }
    render();
  }
  function toggleDrawer(open) {
    m.open = open == null ? !m.open : open;
    $('#mediaDrawer').classList.toggle('open', m.open);
    render();
    if (m.open) refresh(true);
  }

  async function init() {
    const [{ spotify }, sites] = await Promise.all([
      chrome.storage.local.get('spotify'),
      chrome.permissions.contains({ origins: SITE_ORIGINS }),
    ]);
    m.spotifyAuth = spotify || null;
    m.sitesAllowed = sites;
    chrome.permissions.onAdded.addListener(async () => { m.sitesAllowed = await chrome.permissions.contains({ origins: SITE_ORIGINS }); });
    chrome.permissions.onRemoved.addListener(async () => { m.sitesAllowed = await chrome.permissions.contains({ origins: SITE_ORIGINS }); });
    $('#mediaBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleDrawer(); });
    $('#miniPlayer').addEventListener('click', () => toggleDrawer(true));
    chrome.tabs.onUpdated.addListener((id, info) => { if ('audible' in info || 'mutedInfo' in info) refresh(true); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.open && $('#modal').hidden) toggleDrawer(false); });
    setInterval(() => { if (!document.hidden) refresh(false); else renderMini(); }, 1000);
    refresh(true);
  }

  return { init, state: m, refresh, toggleDrawer, openSettings };
})();

Media.init();
