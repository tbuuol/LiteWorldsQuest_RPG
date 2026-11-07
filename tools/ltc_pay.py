#!/usr/bin/env python3
"""Plots paid in Litecoin testnet (tbuuol 2026-11-07: "bau es gleich auf Litecoin Test").

A game page can only ask the arcade's wallet to pay in the arcade's own coin, so a plot's price is an invoice: the
house names its own tLTC address and an amount no other open invoice has (the price plus a few litoshi), the buyer
sends exactly that from any Litecoin testnet wallet, and this module finds the payment on the node that runs on this
machine (omnilited, -testnet, with a txindex) -- in its mempool and in each new block. The node's own wallet, which
the arcade uses, is never touched: the house's key is made here, once, and kept in .publisher/ltc-house.json (0600).

    Pay(store)          .ensure_key() -> address ; .invoice(plot, addr, tag, price) -> {...} ; .watch() -> [paid]
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import random
import secrets
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEY = ROOT / ".publisher" / "ltc-house.json"
CLI = [str(pathlib.Path.home() / "Litecoin/omnilite-0.18.2/bin/omnilite-cli"), "-datadir=" + str(pathlib.Path.home() / "Litecoin/data"), "-testnet"]
LIFE = 30 * 60   # an invoice is open this long

# --- a key and its address (secp256k1, P2PKH on Litecoin testnet: version 0x6f, WIF 0xef) --------------------------
P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def _add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0:
        return None
    lam = (3 * a[0] * a[0] * pow(2 * a[1], -1, P)) % P if a == b else ((b[1] - a[1]) * pow(b[0] - a[0], -1, P)) % P
    x = (lam * lam - a[0] - b[0]) % P
    return x, (lam * (a[0] - x) - a[1]) % P


def _mul(k, pt=G):
    out = None
    while k:
        if k & 1:
            out = _add(out, pt)
        pt = _add(pt, pt)
        k >>= 1
    return out


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58check(payload: bytes) -> str:
    raw = payload + hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    n, out = int.from_bytes(raw, "big"), ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + out


def new_key() -> dict:
    k = secrets.randbelow(N - 1) + 1
    x, y = _mul(k)
    pub = (b"\x03" if y & 1 else b"\x02") + x.to_bytes(32, "big")
    h160 = hashlib.new("ripemd160", hashlib.sha256(pub).digest()).digest()
    return {"address": b58check(b"\x6f" + h160), "wif": b58check(b"\xef" + k.to_bytes(32, "big") + b"\x01"), "made": time.time()}


def rpc(*args):
    run = subprocess.run(CLI + [str(a) for a in args], capture_output=True, text=True, timeout=60)
    if run.returncode:
        raise RuntimeError(run.stderr.strip()[:200])
    out = run.stdout.strip()
    try:
        return json.loads(out)
    except ValueError:
        return out


class Pay:
    def __init__(self, store):
        self.db = store.db
        self.db.execute("CREATE TABLE IF NOT EXISTS invoices (plot TEXT PRIMARY KEY, addr TEXT NOT NULL, tag TEXT, sats INTEGER NOT NULL, "
                        "made REAL NOT NULL, paid TEXT, done INTEGER NOT NULL DEFAULT 0)")
        self.db.execute("CREATE TABLE IF NOT EXISTS ltc_seen (k TEXT PRIMARY KEY, v TEXT)")
        self.key = self.ensure_key()

    def ensure_key(self) -> dict:
        if KEY.exists():
            return json.loads(KEY.read_text())
        k = new_key()
        KEY.write_text(json.dumps(k))
        os.chmod(KEY, 0o600)
        return k

    def open(self) -> list:
        """invoices not paid and not run out: [{plot, addr, tag, amount, until, to}]"""
        now, out = time.time(), []
        with self.db:
            self.db.execute("DELETE FROM invoices WHERE done = 0 AND paid IS NULL AND made < ?", (now - LIFE,))
        for plot, addr, tag, sats, made in self.db.execute("SELECT plot, addr, tag, sats, made FROM invoices WHERE done = 0 AND paid IS NULL"):
            out.append({"plot": plot, "addr": addr, "tag": tag, "amount": f"{sats / 1e8:.8f}", "until": int((made + LIFE) * 1000), "to": self.key["address"]})
        return out

    def invoice(self, plot: str, addr: str, tag: str, price: str) -> dict | None:
        """a new invoice for this plot, or the one that is open (None: someone else's is open)"""
        for inv in self.open():
            if inv["plot"] == plot:
                return inv if inv["addr"] == addr else None
        taken = {s for (s,) in self.db.execute("SELECT sats FROM invoices WHERE done = 0 AND paid IS NULL")}
        base = round(float(price) * 1e8)
        sats = base + random.randint(1, 999)
        while sats in taken:
            sats = base + random.randint(1, 999)
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO invoices (plot, addr, tag, sats, made, paid, done) VALUES (?, ?, ?, ?, ?, NULL, 0)",
                            (plot, addr, tag, sats, time.time()))
        return next(i for i in self.open() if i["plot"] == plot)

    def _outputs(self, tx: dict):
        for vout in tx.get("vout", []):
            spk = vout.get("scriptPubKey", {})
            addrs = spk.get("addresses") or ([spk["address"]] if spk.get("address") else [])
            if self.key["address"] in addrs:
                yield round(float(vout["value"]) * 1e8)

    def watch(self) -> list:
        """payments found since the last look: [{plot, addr, tag, txid}] (each marked paid; done() once the game has it)"""
        want = {sats: plot for plot, sats in self.db.execute("SELECT plot, sats FROM invoices WHERE done = 0 AND paid IS NULL")}
        if not want:
            return self.unfinished()
        seen = {k: v for k, v in self.db.execute("SELECT k, v FROM ltc_seen")}
        txids = set(rpc("getrawmempool"))
        height = int(rpc("getblockcount"))
        last = int(seen.get("height") or height - 1)
        for h in range(max(last + 1, height - 5), height + 1):
            blk = rpc("getblock", rpc("getblockhash", h), 1)
            txids.update(blk.get("tx", []))
        for txid in txids:
            if seen.get("tx:" + txid):
                continue
            try:
                tx = rpc("getrawtransaction", txid, 1)
            except RuntimeError:
                continue
            for sats in self._outputs(tx):
                if sats in want:
                    with self.db:
                        self.db.execute("UPDATE invoices SET paid = ? WHERE plot = ? AND paid IS NULL", (txid, want[sats]))
            with self.db:
                self.db.execute("INSERT OR REPLACE INTO ltc_seen (k, v) VALUES (?, ?)", ("tx:" + txid, "1"))
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO ltc_seen (k, v) VALUES ('height', ?)", (str(height),))
        return self.unfinished()

    def unfinished(self) -> list:
        return [{"plot": p, "addr": a, "tag": t, "txid": x} for p, a, t, x in
                self.db.execute("SELECT plot, addr, tag, paid FROM invoices WHERE done = 0 AND paid IS NOT NULL")]

    def done(self, plot: str) -> None:
        with self.db:
            self.db.execute("UPDATE invoices SET done = 1 WHERE plot = ? AND paid IS NOT NULL", (plot,))


if __name__ == "__main__":   # a look at the key's address and the node
    k = new_key()
    print("a fresh key would be", k["address"], "| node height", rpc("getblockcount"))


async def sync(frame, pay: "Pay", tick: int) -> None:
    """One round with a house whose game sells plots for tLTC: new asks get an invoice, the open ones are told again (a
    restarted game knows them so), and every 10 s the chain is looked at for payments."""
    asks = json.loads(await frame.evaluate("window.LWQGAME.housePlotAsks ? window.LWQGAME.housePlotAsks() : '[]'") or "[]")
    for ask in asks:
        inv = pay.invoice(str(ask["plot"]), str(ask["addr"]), str(ask.get("tag") or ""), str(ask["price"]))
        await frame.evaluate("a => window.LWQGAME.housePlotInvoice(a)", {"ask": ask, "inv": inv})
    if asks or tick % 10 == 0:
        await frame.evaluate("l => window.LWQGAME.housePlotInvoices(l)", pay.open())
    if tick % 10 == 0:
        for paid in pay.watch():
            if await frame.evaluate("p => window.LWQGAME.housePlotPaid(p)", paid):
                pay.done(paid["plot"])
