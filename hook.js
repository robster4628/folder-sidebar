// Runs inside music sites the user has allowed (page context, at page start).
// Keeps track of audio/video elements the page plays (even ones never added to the page)
// and the media-key handlers it registers (next/previous track, play, pause),
// so the sidebar can control volume and skip on sites it has no special support for.
(() => {
  if (window.__fsHooked) return;
  window.__fsHooked = true;
  window.__fsEarly = document.readyState === 'loading'; // false = added after the page had already started
  const refs = new Set();
  const track = (el) => {
    for (const r of refs) if (r.deref() === el) return;
    refs.add(new WeakRef(el));
  };
  window.__fsMedia = () => {
    const out = [];
    for (const r of refs) { const e = r.deref(); if (e) out.push(e); else refs.delete(r); }
    return out;
  };
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    try { track(this); } catch {}
    return origPlay.apply(this, args);
  };
  const actions = {};
  window.__fsActions = actions;
  const ms = navigator.mediaSession;
  if (ms && ms.setActionHandler) {
    const orig = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action, handler) => {
      actions[action] = handler;
      return orig(action, handler);
    };
  }
})();
