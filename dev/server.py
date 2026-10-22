#!/usr/bin/env python3
"""LiteWorldsQuest dev server: the game in a stand-in for the arcade viewer, without inscribing anything.

    python3 dev/server.py [--port 8765]
    then open  http://localhost:8765/?as=alice   and, in a second tab,  http://localhost:8765/?as=bob

What it serves, and what it stands in for:
  /                      dev/viewer.html: frames the game exactly as the arcade does (sandbox, opaque origin) and
                         answers the page's postMessage doors -- realtime (tabs of this browser meet over a
                         BroadcastChannel; the fast lane is "direct") and storage (this browser's localStorage, per ?as=)
  /content/game          dist/liteworldsquest.html, rebuilt on every load, with the arcade's Content-Security-Policy
  /content/<id>          any other inscription, fetched once from the local arcade node (three.js) and kept in dev/cache
  /r/realtime.js         the arcade's own SDK (copied from arcade/web/templates), unchanged
  /r/storage.js          the same
  /r/wallet              a pretend wallet (tag "dev", 100 coins), the shape inscription-api.md gives
  /r/send, /r/send/<id>  payment requests; the viewer shows each one with Approve / Refuse, as the wallet would
Nothing here touches a real wallet or the chain.
"""
from __future__ import annotations

import argparse
import importlib
import itertools
import json
import pathlib
import secrets
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEV = ROOT / "dev"
CACHE = DEV / "cache"
FAKE = DEV / "fakechain"
NODE = "http://127.0.0.1:8420"
sys.path.insert(0, str(ROOT))
import build  # noqa: E402

CSP = ("sandbox allow-scripts allow-pointer-lock; default-src 'self' data: blob:; "
       "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline' data:; "
       "img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
       "frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'")
WALLET = {"network": "test", "mainnet": False, "addresses": ["nDevWa11etAddressXXXXXXXXXXXXXXXX"], "tag": "dev",
          "coin": {"spendable": 100.0, "ticker": "PEP TEST"}, "tokens": [], "inscriptions": 0}
REQUESTS: dict[str, dict] = {}
LOCK = threading.Lock()
BUILD_LOCK = threading.Lock()   # one build at a time: every build rewrites the same files in dist/


def fresh_page(release: bool) -> bytes:
    """Build with the newest build.py and read the page back, without another tab's build writing in between."""
    with BUILD_LOCK:
        importlib.reload(build)
        return build.build(release=release).read_bytes()
TXIDS = (secrets.token_hex(32) for _ in itertools.count())


class Handler(BaseHTTPRequestHandler):
    server_version = "lwq-dev"

    def log_message(self, fmt, *args):  # quieter: only what is not a plain 200
        if args and str(args[1]) not in ("200", "202", "204"):
            sys.stderr.write("%s %s\n" % (self.command, fmt % args))

    def send(self, status: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # The game runs in an opaque origin, so every answer it reads is a cross-origin one, as on the arcade.
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def json(self, status: int, obj):
        self.send(status, json.dumps(obj).encode(), "application/json")

    def do_OPTIONS(self):
        self.send(204, b"", "text/plain", {"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                                            "Access-Control-Allow-Headers": "Content-Type"})

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/download/liteworldsquest.html":   # the page to inscribe, as a file to save
            body = fresh_page(release=True)
            return self.send(200, body, "text/html; charset=utf-8",
                             {"Content-Disposition": 'attachment; filename="liteworldsquest.html"'})
        if path in ("/", "/index.html"):
            return self.send(200, (DEV / "viewer.html").read_bytes(), "text/html; charset=utf-8")
        if path in ("/content/game", "/content/release"):
            try:
                body = fresh_page(release=path.endswith("release"))   # build.py changes while the server runs
            except SystemExit as exc:
                return self.send(500, str(exc).encode(), "text/plain")
            return self.send(200, body, "text/html; charset=utf-8", {"Content-Security-Policy": CSP})
        if path == "/content/release-bundle":   # the release page's packed modules, until the bundle is inscribed
            f = ROOT / "dist" / "release" / "bundle.json.gz"
            return self.send(200, f.read_bytes(), "application/gzip") if f.is_file() else self.send(404, b"build the release first", "text/plain")
        if path.startswith("/content/assets/"):
            f = ROOT / "dist" / "assets" / path[len("/content/assets/"):]
            if f.is_file() and f.parent == ROOT / "dist" / "assets":
                ctype = {".webp": "image/webp", ".png": "image/png", ".glb": "model/gltf-binary"}.get(f.suffix, "application/octet-stream")
                return self.send(200, f.read_bytes(), ctype, {"Cache-Control": "public, max-age=3600"})
            return self.send(404, b"no such asset", "text/plain")
        staged = (FAKE / path[len("/content/"):]).resolve() if path.startswith("/content/") else None
        if staged and staged.parent == FAKE.resolve() and staged.is_file():   # dev/fakechain only, no ../
            meta = staged.with_name(staged.name + ".type")   # an update staged as if inscribed
            ctype = meta.read_text() if meta.is_file() else "application/octet-stream"
            return self.send(200, staged.read_bytes(), ctype)
        if path == "/r/inscriptions":
            listing = FAKE / "listing.json"   # what the page's registry lookup finds: the staged update, if any
            return self.send(200, listing.read_bytes() if listing.exists() else b"[]", "application/json")
        if path.startswith("/content/"):
            return self.content(path[len("/content/"):])
        if path in ("/r/realtime.js", "/r/storage.js"):
            return self.send(200, (DEV / path[3:]).read_bytes(), "text/javascript; charset=utf-8")
        if path == "/r/wallet":
            return self.json(200, WALLET)
        if path.startswith("/r/send/"):
            with LOCK:
                req = REQUESTS.get(path[len("/r/send/"):])
            return self.json(200, req) if req else self.json(404, {"error": "no such request"})
        if path == "/dev/requests":
            with LOCK:
                return self.json(200, [r for r in REQUESTS.values() if r["status"] == "pending"])
        self.send(404, b"not here", "text/plain")

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        n = int(self.headers.get("Content-Length") or 0)
        try:
            said = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self.json(400, {"error": "that is not JSON"})
        if path == "/r/send":
            if said.get("kind") != "coins" or not said.get("to") or not str(said.get("amount", "")).strip():
                return self.json(400, {"error": "a coins request names to and amount"})
            req = {"id": secrets.token_hex(8), "status": "pending", "kind": "coins", "to": said["to"],
                   "amount": str(said["amount"]), "label": str(said.get("label") or ""),
                   "note": str(said.get("note") or ""), "at": time.time()}
            with LOCK:
                REQUESTS[req["id"]] = req
            return self.json(202, req)
        if path == "/dev/decide":
            with LOCK:
                req = REQUESTS.get(str(said.get("id")))
                if not req or req["status"] != "pending":
                    return self.json(404, {"error": "no such pending request"})
                if said.get("yes"):
                    req.update(status="sent", txid=next(TXIDS), confirmations=0, confirmed=False)
                    WALLET["coin"]["spendable"] = round(WALLET["coin"]["spendable"] - 0.01, 8)   # only the fee leaves
                else:
                    req.update(status="denied")
            return self.json(200, req)
        self.send(404, b"not here", "text/plain")

    def content(self, ident: str):
        if not ident.replace("i", "").isalnum() or len(ident) > 80:
            return self.send(404, b"no such inscription", "text/plain")
        CACHE.mkdir(exist_ok=True)
        body, meta = CACHE / ident, CACHE / (ident + ".type")
        if not body.exists():
            try:
                with urllib.request.urlopen(f"{NODE}/content/{ident}", timeout=120) as r:
                    data, ctype = r.read(), r.headers.get("Content-Type", "application/octet-stream")
            except Exception as exc:  # noqa: BLE001
                return self.send(502, f"the local arcade node did not give {ident}: {exc}".encode(), "text/plain")
            body.write_bytes(data)
            meta.write_text(ctype)
        return self.send(200, body.read_bytes(), meta.read_text())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    print(f"LiteWorldsQuest dev: http://localhost:{a.port}/?as=alice  (and ?as=bob in another tab)")
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
