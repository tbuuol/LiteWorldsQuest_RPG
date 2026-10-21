#!/usr/bin/env python3
"""Hand our own stuck P test transactions to the network again, peer by peer.

    python3 tools/relay_mempool.py [txid ...]      (default: every transaction in the local node's mempool)

Why: a node announces a transaction it was handed with sendrawtransaction once, and never again (it is not a wallet
transaction). A burst of a few megabytes of inscription pieces can lose some on the way to the miner (2026-10-21:
14 pieces waited hours while ~30 blocks were mined). This speaks the plain peer-to-peer protocol (Pepecoin testnet:
magic fe c1 db cc, port 44874) to the local node's peers and sends each transaction's exact bytes again: the same
signed transaction, so it can be mined at most once and costs nothing more. A peer that refuses one says why
('reject'), and that is printed.
"""
from __future__ import annotations

import base64
import hashlib
import json
import socket
import struct
import sys
import time
import urllib.request

MAGIC = bytes.fromhex("fec1dbcc")
COOKIE = "/var/lib/arcade/.pepecoin-testnet/testnet3/.cookie"
RPC = "http://127.0.0.1:44873/"


def rpc(method, params=()):
    auth = base64.b64encode(open(COOKIE).read().strip().encode()).decode()
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "1.0", "id": 1, "method": method, "params": list(params)}).encode(),
                                 headers={"Authorization": "Basic " + auth, "Content-Type": "text/plain"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())["result"]


def msg(command: str, payload: bytes) -> bytes:
    check = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    return MAGIC + command.encode().ljust(12, b"\0") + struct.pack("<I", len(payload)) + check + payload


def varstr(s: bytes) -> bytes:
    return bytes([len(s)]) + s


def netaddr() -> bytes:
    return struct.pack("<Q", 0) + bytes(10) + b"\xff\xff" + bytes(4) + struct.pack(">H", 0)


def read_msg(sock) -> tuple[str, bytes]:
    head = b""
    while len(head) < 24:
        chunk = sock.recv(24 - len(head))
        if not chunk:
            raise ConnectionError("closed")
        head += chunk
    if head[:4] != MAGIC:
        raise ConnectionError("wrong network")
    cmd = head[4:16].rstrip(b"\0").decode(errors="replace")
    n = struct.unpack("<I", head[16:20])[0]
    body = b""
    while len(body) < n:
        chunk = sock.recv(n - len(body))
        if not chunk:
            raise ConnectionError("closed")
        body += chunk
    return cmd, body


def relay(host: str, port: int, raws: list[bytes], height: int) -> str:
    s = socket.create_connection((host, port), timeout=15)
    try:
        version = (struct.pack("<iQq", 70015, 0, int(time.time())) + netaddr() + netaddr()
                   + struct.pack("<Q", int.from_bytes(hashlib.sha256(host.encode()).digest()[:8], "little"))
                   + varstr(b"/lwq-relay:0.1/") + struct.pack("<i", height) + b"\x01")
        s.sendall(msg("version", version))
        got_verack = False
        deadline = time.time() + 15
        while not got_verack and time.time() < deadline:
            cmd, body = read_msg(s)
            if cmd == "version":
                s.sendall(msg("verack", b""))
            elif cmd == "verack":
                got_verack = True
            elif cmd == "ping":
                s.sendall(msg("pong", body))
        if not got_verack:
            return "no handshake"
        for raw in raws:
            s.sendall(msg("tx", raw))
        rejects = []
        s.settimeout(3)
        end = time.time() + 6
        while time.time() < end:
            try:
                cmd, body = read_msg(s)
            except (socket.timeout, ConnectionError):
                break
            if cmd == "reject":
                n = body[0]; what = body[1:1 + n].decode(); code = body[1 + n]; m = body[2 + n]; reason = body[3 + n:3 + n + m].decode(errors="replace")
                rejects.append(f"{what} {code:#x} {reason}")
            elif cmd == "ping":
                s.sendall(msg("pong", body))
        return f"sent {len(raws)}" + (f", refused: {rejects}" if rejects else ", none refused")
    finally:
        s.close()


def main() -> int:
    txids = sys.argv[1:] or list(rpc("getrawmempool"))
    raws = [bytes.fromhex(rpc("getrawtransaction", [t])) for t in txids]
    height = rpc("getblockcount")
    peers = [p["addr"] for p in rpc("getpeerinfo")]
    print(f"{len(raws)} transactions ({sum(map(len, raws)) / 1024:.0f} KB) to {len(peers)} peers")
    for addr in peers:
        host, _, port = addr.rpartition(":")
        host = host.strip("[]")
        try:
            print(f"  {addr}: {relay(host, int(port), raws, height)}")
        except Exception as exc:  # noqa: BLE001 -- a peer that will not talk is only one peer
            print(f"  {addr}: {exc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
