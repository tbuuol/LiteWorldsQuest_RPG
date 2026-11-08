#!/usr/bin/env python3
"""A plot's deed as an inscription (tbuuol 2026-11-08: "Ja, bauen"): when a plot of Genesis is paid for, the publisher
key inscribes a small JSON deed on Pepecoin testnet -- plot, kind, size, where, the buyer, the payment -- and hands
it to the buyer's address. The deed's creator is the game's publisher, so anyone can tell a real one; later, whoever
holds it owns the plot.

One job per plot in the house's database (table deeds), one step at a time, each step a run of arcade-publish:
    new      -> inscribe                         -> minted (the inscription's id)
    minted   -> hand it on (once it can be: confirmed)  -> sent
    sent     -> the game is told (housePlotDeed)  -> told
A step that fails is tried again later. About 1 coin a deed, paid by the publisher key.

    python3 tools/deeds.py            the jobs and where they stand
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARC = pathlib.Path("/var/lib/arcade/.dogecoinarcade")
WORK = ROOT / ".publisher" / "work"
LOG = ROOT / ".publisher" / "log" / "deeds.log"
BASE = [str(ARC / "venv/bin/arcade-publish"), "-testnet", "--key", str(ROOT / ".publisher/publish.key"),
        "--datadir", "/var/lib/arcade/.pepecoin-testnet", "--journal", str(ROOT / ".publisher/journal")]
KIND = {"house": "House", "workshop": "Workshop", "shop": "Shop"}


def log(*parts) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(p) for p in parts) + "\n")


def setup(db) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS deeds (plot TEXT PRIMARY KEY, addr TEXT NOT NULL, tag TEXT, paytx TEXT, "
               "state TEXT NOT NULL, insc TEXT, sendtx TEXT, err TEXT, tries INTEGER NOT NULL DEFAULT 0, updated REAL NOT NULL)")


def enqueue(db, plot: str, addr: str, tag: str, paytx: str) -> None:
    setup(db)
    with db:
        db.execute("INSERT OR IGNORE INTO deeds (plot, addr, tag, paytx, state, updated) VALUES (?, ?, ?, ?, 'new', ?)",
                   (plot, addr, tag, paytx, time.time()))


def plot_of(plot: str) -> dict:
    world = json.loads((ROOT / "src/levels/world.json").read_text())["data"]
    for place in world["places"]:
        for p in place.get("plots") or []:
            if p["id"] == plot:
                return p
    raise KeyError(plot)


def deed_json(plot: str, addr: str, tag: str, paytx: str) -> dict:
    p = plot_of(plot)
    x0, z0, x1, z1 = p["rect"]
    return {"lwq": "deed", "name": f"Genesis Deed {plot}", "city": "Genesis", "plot": plot, "kind": p["kind"],
            "size": [round(x1 - x0), round(z1 - z0)], "rect": p["rect"], "owner": addr, "tag": tag,
            "paid": {"chain": "ltctest", "txid": paytx},
            "description": f"Deed to plot {plot} ({KIND.get(p['kind'], p['kind'])}, {round(x1 - x0)} x {round(z1 - z0)} m) "
                           f"in the city of Genesis, LiteWorldsQuest. Whoever holds this deed owns the plot."}


def run(args: list, timeout: int = 1800) -> tuple[int, str]:
    r = subprocess.run(BASE + args, cwd=str(ARC / "src"), capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout + r.stderr)


def tail_json(out: str) -> dict | None:
    try:
        return json.loads(out[out.index("{"):])
    except ValueError:
        return None


def relay(txids: list) -> None:
    if txids:
        subprocess.run([sys.executable, str(ROOT / "tools/relay_mempool.py"), *txids], capture_output=True, timeout=200)


def step(db) -> tuple[str, str] | None:
    """One step of the oldest open job. Returns (plot, inscription) when a deed is ready to tell the game."""
    setup(db)
    row = db.execute("SELECT plot, addr, tag, paytx, state, insc, tries FROM deeds WHERE state != 'told' "
                     "ORDER BY updated LIMIT 1").fetchone()
    if not row:
        return None
    plot, addr, tag, paytx, state, insc, tries = row
    now = time.time()

    def save(**kw):
        cols = ", ".join(f"{k} = ?" for k in kw) + ", updated = ?, tries = ?"
        with db:
            db.execute(f"UPDATE deeds SET {cols} WHERE plot = ?", (*kw.values(), now, 0 if "state" in kw else tries + 1, plot))

    if state == "new":
        WORK.mkdir(parents=True, exist_ok=True)
        card = deed_json(plot, addr, tag, paytx)
        f = WORK / f"deed-{plot}.json"
        f.write_text(json.dumps(card, separators=(",", ":")))
        code, out = run(["--type", "application/json", "--name", f"Genesis Deed {plot}", "--json", json.dumps(card, separators=(",", ":")), str(f)])
        got = tail_json(out) if code == 0 else None
        if not got or not got.get("id"):
            save(err=out[-300:]); log("inscribe failed", plot, out[-200:].replace("\n", " "))
            return None
        relay(got.get("txids") or [])
        save(state="minted", insc=got["id"], err=None); log("inscribed", plot, got["id"])
        return None
    if state == "minted":
        code, out = run(["--send-nft", insc, addr, "--intent", f"deed-{plot}"], timeout=600)
        got = tail_json(out) if code == 0 else None
        if not got:
            save(err=out[-300:])   # not confirmed yet, most likely: again later
            if tries % 10 == 0:
                log("hand-on waits", plot, out[-160:].replace("\n", " "))
            return None
        tx = got.get("txid") or ",".join(got.get("txids") or [])
        relay([t for t in [got.get("txid"), *(got.get("txids") or [])] if t])
        save(state="sent", sendtx=tx, err=None); log("handed on", plot, "to", addr, tx)
        return plot, insc
    if state == "sent":
        return plot, insc
    return None


def told(db, plot: str) -> None:
    with db:
        db.execute("UPDATE deeds SET state = 'told', updated = ? WHERE plot = ? AND state = 'sent'", (time.time(), plot))


if __name__ == "__main__":
    import sqlite3
    db = sqlite3.connect(str(ROOT / ".publisher/beta-players.sqlite"))
    setup(db)
    for r in db.execute("SELECT plot, state, insc, sendtx, tries, err FROM deeds"):
        print(r[:5], (r[5] or "")[-120:])


def step_at(path) -> tuple[str, str] | None:
    """step() on a connection of its own (the house runs it in a thread beside its loop)."""
    import sqlite3
    db = sqlite3.connect(str(path), timeout=30)
    try:
        return step(db)
    finally:
        db.close()
