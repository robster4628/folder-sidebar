#!/usr/bin/env python3
"""Folder Sidebar cast helper.

Finds Chromecasts / Google Cast speakers on the local network and lets the
Folder Sidebar Chrome extension see what's playing and control it.

Listens on 127.0.0.1 only. Requests carrying an Origin header are accepted only
from Chrome extensions, so ordinary web pages can't use it.
"""
import json
import logging
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import pychromecast

PORT = 47800
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
IDLE_APP_IDS = {None, "E8C28D3C"}  # nothing running / Backdrop (ambient screen)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("cast-helper")

casts = {}  # uuid -> Chromecast
lock = threading.Lock()


def on_found(cc):
    uid = str(cc.uuid)
    with lock:
        if uid in casts:
            return
        casts[uid] = cc
    log.info("found %s (%s)", cc.cast_info.friendly_name, cc.cast_info.model_name)
    threading.Thread(target=_connect, args=(cc,), daemon=True).start()


def _connect(cc):
    try:
        cc.wait(timeout=20)
    except Exception as e:  # noqa: BLE001
        log.warning("could not connect to %s: %s", cc.cast_info.friendly_name, e)


def _refresh_loop():
    """Keep media status fresh for devices that are running an app."""
    while True:
        time.sleep(5)
        with lock:
            items = list(casts.values())
        for cc in items:
            s = cc.status
            if not s or s.app_id in IDLE_APP_IDS:
                continue
            try:
                cc.media_controller.update_status()
            except Exception:  # noqa: BLE001
                pass


def g(obj, name, default=None):
    return getattr(obj, name, default) if obj is not None else default


def describe(uid, cc):
    info = cc.cast_info
    d = {
        "id": uid,
        "name": info.friendly_name,
        "model": info.model_name,
        "type": info.cast_type,
        "connected": cc.status is not None,
        "app": None,
        "idle": True,
    }
    s = cc.status
    if s:
        d.update(
            app=s.display_name,
            volume=round((s.volume_level or 0) * 100),
            muted=bool(s.volume_muted),
            idle=s.app_id in IDLE_APP_IDS or not s.display_name,
        )
    m = cc.media_controller.status
    state = g(m, "player_state")
    if not d["idle"] and state and state != "UNKNOWN":
        images = g(m, "images") or []
        d["media"] = {
            "title": g(m, "title"),
            "artist": g(m, "artist") or g(m, "album_artist") or g(m, "series_title") or g(m, "subtitle"),
            "album": g(m, "album_name"),
            "art": images[0].url if images else None,
            "state": state,  # PLAYING / PAUSED / BUFFERING / IDLE
            "position": g(m, "adjusted_current_time", g(m, "current_time")),
            "duration": g(m, "duration"),
            "canPause": bool(g(m, "supports_pause")),
            "canNext": bool(g(m, "supports_queue_next") or g(m, "supports_skip_forward")),
            "canPrev": bool(g(m, "supports_queue_prev") or g(m, "supports_skip_backward")),
        }
    return d


def act(cc, action, body):
    mc = cc.media_controller
    if action in ("play", "pause", "next", "prev", "stop"):
        try:
            mc.block_until_active(timeout=3)
        except Exception:  # noqa: BLE001
            pass
    if action == "play":
        mc.play()
    elif action == "pause":
        mc.pause()
    elif action == "next":
        mc.queue_next()
    elif action == "prev":
        mc.queue_prev()
    elif action == "stop":
        cc.quit_app()
    elif action == "volume":
        cc.set_volume(max(0, min(100, float(body.get("level", 0)))) / 100)
    elif action == "mute":
        cc.set_volume_muted(bool(body.get("muted", True)))
    else:
        raise ValueError("unknown action")


class Handler(BaseHTTPRequestHandler):
    server_version = "FolderSidebarCast/1"

    def _allowed(self):
        if self.headers.get("Host") not in ALLOWED_HOSTS:  # blocks DNS-rebinding tricks
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin.startswith("chrome-extension://")

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send(self, code, obj=None):
        body = json.dumps(obj if obj is not None else {}).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        if urlparse(self.path).path != "/status":
            return self._send(404, {"error": "not found"})
        with lock:
            items = list(casts.items())
        devices = []
        for uid, cc in items:
            try:
                devices.append(describe(uid, cc))
            except Exception as e:  # noqa: BLE001
                log.warning("status error for %s: %s", uid, e)
        devices.sort(key=lambda d: (d["idle"], d["name"] or ""))
        self._send(200, {"devices": devices})

    def do_POST(self):  # noqa: N802
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "cast":
            return self._send(404, {"error": "not found"})
        _, uid, action = parts
        with lock:
            cc = casts.get(uid)
        if not cc:
            return self._send(404, {"error": "no such device"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            act(cc, action, body)
        except Exception as e:  # noqa: BLE001
            return self._send(400, {"error": str(e)})
        self._send(200, {"ok": True})

    def log_message(self, *args):  # keep the log quiet
        pass


def main():
    browser = pychromecast.get_chromecasts(blocking=False, callback=on_found)
    threading.Thread(target=_refresh_loop, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log.info("listening on http://127.0.0.1:%d", PORT)
    try:
        server.serve_forever()
    finally:
        browser.stop_discovery()


if __name__ == "__main__":
    main()
