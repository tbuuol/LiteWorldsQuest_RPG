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


async def sync(frame, store: Store) -> tuple[int, int]:
    """One round with a house in store mode: the records it waits for, then what changed. (given, taken)"""
    wants = await frame.evaluate("window.LWQGAME.houseWants()")
    given = 0
    if wants:
        given = await frame.evaluate("json => window.LWQGAME.houseGive(json)", json.dumps(store.get(wants)))
    taken = json.loads(await frame.evaluate("window.LWQGAME.houseTake()") or "{}")
    if taken:
        store.put(taken)
    return given, len(taken)
