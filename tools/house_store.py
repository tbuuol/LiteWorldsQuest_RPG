#!/usr/bin/env python3
"""The house's database of players (Etappe 4): one SQLite file instead of players.json, shared by every zone's house.

    store = Store(path)              .publisher/players.sqlite (WAL: several houses may use it at once)
    store.get(addresses)  -> {address: record | None}
    store.put({address: record})     what a house handed back (only what changed)
    store.daily(backups)  -> (day, sha256, n) | None   once a day: a copy of the file, and a fingerprint of every record
    await sync(frame, store)         a house in store mode: give it the records it waits for, take what changed

A record is the rpg module's JSON (v 2). The fingerprint is sha256 over "address\\trecord\\n" sorted by address, kept
in the table `hashes` (later written to the chain, so nobody can quietly change a record afterwards)."""
from __future__ import annotations

import hashlib
import json
import pathlib
import sqlite3
import time


class Store:
    def __init__(self, path: pathlib.Path):
        self.path = pathlib.Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path), timeout=30, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS players (addr TEXT PRIMARY KEY, rec TEXT NOT NULL, updated REAL NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS hashes (day TEXT PRIMARY KEY, sha TEXT NOT NULL, n INTEGER NOT NULL, at REAL NOT NULL)")
        # Genesis' plots (2026-11-07): who owns which, as the game keeps it ([tag, address, bought at, deed])
        self.db.execute("CREATE TABLE IF NOT EXISTS plots (plot TEXT PRIMARY KEY, own TEXT NOT NULL, updated REAL NOT NULL)")
        # what owners built on their plots (2026-11-07): the pieces of each plot, as the game keeps them
        self.db.execute("CREATE TABLE IF NOT EXISTS built (plot TEXT PRIMARY KEY, pieces TEXT NOT NULL, updated REAL NOT NULL)")
        # the shops' stock, kept by the house (2026-11-08): what lies on each counter, and what buyers are owed
        self.db.execute("CREATE TABLE IF NOT EXISTS shops (plot TEXT PRIMARY KEY, stock TEXT NOT NULL, updated REAL NOT NULL)")

    def shops(self) -> dict:
        out = {}
        for p, stock in self.db.execute("SELECT plot, stock FROM shops"):
            try:
                out[p] = json.loads(stock)
            except ValueError:
                pass
        return out

    def put_shops(self, changed: dict) -> int:
        now = time.time()
        with self.db:
            for p, stock in changed.items():
                if not stock:
                    self.db.execute("DELETE FROM shops WHERE plot = ?", (p,))
                else:
                    self.db.execute("INSERT INTO shops (plot, stock, updated) VALUES (?, ?, ?) ON CONFLICT(plot) DO UPDATE SET "
                                    "stock = excluded.stock, updated = excluded.updated", (p, json.dumps(stock, separators=(",", ":")), now))
        return len(changed)

    def built(self) -> dict:
        out = {}
        for p, pieces in self.db.execute("SELECT plot, pieces FROM built"):
            try:
                out[p] = json.loads(pieces)
            except ValueError:
                pass
        return out

    def put_built(self, changed: dict) -> int:
        now = time.time()
        with self.db:
            for p, pieces in changed.items():
                if not pieces:
                    self.db.execute("DELETE FROM built WHERE plot = ?", (p,))
                else:
                    self.db.execute("INSERT INTO built (plot, pieces, updated) VALUES (?, ?, ?) ON CONFLICT(plot) DO UPDATE SET "
                                    "pieces = excluded.pieces, updated = excluded.updated", (p, json.dumps(pieces, separators=(",", ":")), now))
        return len(changed)

    def plots(self) -> dict:
        out = {}
        for p, own in self.db.execute("SELECT plot, own FROM plots"):
            try:
                out[p] = json.loads(own)
            except ValueError:
                pass
        return out

    def put_plots(self, changed: dict) -> int:
        now = time.time()
        with self.db:
            for p, own in changed.items():
                if own is None:
                    self.db.execute("DELETE FROM plots WHERE plot = ?", (p,))
                else:
                    self.db.execute("INSERT INTO plots (plot, own, updated) VALUES (?, ?, ?) ON CONFLICT(plot) DO UPDATE SET "
                                    "own = excluded.own, updated = excluded.updated", (p, json.dumps(own, separators=(",", ":")), now))
        return len(changed)

    def get(self, addresses) -> dict:
        out = {a: None for a in addresses}
        for a in addresses:
            row = self.db.execute("SELECT rec FROM players WHERE addr = ?", (a,)).fetchone()
            if row:
                try:
                    out[a] = json.loads(row[0])
                except ValueError:
                    out[a] = None
        return out

    def put(self, records: dict) -> int:
        now = time.time()
        with self.db:
            for a, rec in records.items():
                if rec is None:
                    continue
                self.db.execute("INSERT INTO players (addr, rec, updated) VALUES (?, ?, ?) "
                                "ON CONFLICT(addr) DO UPDATE SET rec = excluded.rec, updated = excluded.updated",
                                (a, json.dumps(rec, separators=(",", ":"), sort_keys=True), now))
        return len(records)

    def count(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM players").fetchone()[0]

    def fingerprint(self) -> tuple[str, int]:
        h, n = hashlib.sha256(), 0
        for a, rec in self.db.execute("SELECT addr, rec FROM players ORDER BY addr"):
            h.update(f"{a}\t{rec}\n".encode())
            n += 1
        return h.hexdigest(), n

    def daily(self, backups: pathlib.Path, keep: int = 14):
        """Once a day: a copy of the database beside it (the last `keep` kept) and the day's fingerprint."""
        day = time.strftime("%Y-%m-%d")
        if self.db.execute("SELECT 1 FROM hashes WHERE day = ?", (day,)).fetchone():
            return None
        backups = pathlib.Path(backups)
        backups.mkdir(parents=True, exist_ok=True)
        copy = sqlite3.connect(str(backups / f"players-{day}.sqlite"))
        with copy:
            self.db.backup(copy)
        copy.close()
        for old in sorted(backups.glob("players-*.sqlite"))[:-keep]:
            old.unlink()
        sha, n = self.fingerprint()
        self.db.execute("INSERT OR REPLACE INTO hashes (day, sha, n, at) VALUES (?, ?, ?, ?)", (day, sha, n, time.time()))
        return day, sha, n


#: who holds whose record: {address: zone}. A ZONE CHANGE TAKES A SECOND NOW (2026-10-28, no reload): the zone a player
#: comes to may ask for the record before the zone they left has handed it back -- it waits until that house has.
HELD: dict[str, str] = {}


def release(zone: str) -> None:
    """A zone's house stops: whatever it held is in the database (its last sync), so nobody waits for it."""
    for a in [a for a, z in HELD.items() if z == zone]:
        del HELD[a]


async def sync(frame, store: Store, zone: str = "") -> tuple[int, int]:
    """One round with a house in store mode: what changed, then the records it waits for. (given, taken)"""
    raw = json.loads(await frame.evaluate("window.LWQGAME.houseTake2 ? window.LWQGAME.houseTake2() : null") or "null")
    held = raw is not None   # an older game says nobody who left: no holding then
    if raw is None:
        raw = {"rec": json.loads(await frame.evaluate("window.LWQGAME.houseTake()") or "{}"), "gone": []}
    taken = raw.get("rec") or {}
    if taken:
        store.put(taken)
    for a in raw.get("gone") or []:
        if HELD.get(a) == zone:
            del HELD[a]
    # Genesis' plots: the whole book once, when the game has not had it; then what changed, back into the database
    if await frame.evaluate("window.LWQGAME.housePlotsLoaded ? window.LWQGAME.housePlotsLoaded() : true") is False:
        await frame.evaluate("json => window.LWQGAME.housePlots(json)", json.dumps(store.plots()))
    elif await frame.evaluate("!!window.LWQGAME.housePlotsTake"):
        changed = json.loads(await frame.evaluate("window.LWQGAME.housePlotsTake()") or "{}")
        if changed:
            store.put_plots(changed)
    # and what was built on them, the same way
    if await frame.evaluate("window.LWQGAME.houseBuiltLoaded ? window.LWQGAME.houseBuiltLoaded() : true") is False:
        await frame.evaluate("json => window.LWQGAME.houseBuilt(json)", json.dumps(store.built()))
    elif await frame.evaluate("!!window.LWQGAME.houseBuiltTake"):
        changed = json.loads(await frame.evaluate("window.LWQGAME.houseBuiltTake()") or "{}")
        if changed:
            store.put_built(changed)
    # and the shops' stock, the same way
    if await frame.evaluate("window.LWQGAME.houseShopsLoaded ? window.LWQGAME.houseShopsLoaded() : true") is False:
        await frame.evaluate("json => window.LWQGAME.houseShops(json)", json.dumps(store.shops()))
    elif await frame.evaluate("!!window.LWQGAME.houseShopsTake"):
        changed = json.loads(await frame.evaluate("window.LWQGAME.houseShopsTake()") or "{}")
        if changed:
            store.put_shops(changed)
    wants = await frame.evaluate("window.LWQGAME.houseWants()")
    if held:
        wants = [a for a in wants if HELD.get(a, zone) == zone]
    given = 0
    if wants:
        given = await frame.evaluate("json => window.LWQGAME.houseGive(json)", json.dumps(store.get(wants)))
        if held:
            for a in wants:
                HELD[a] = zone
    return given, len(taken)
