#!/usr/bin/env python3
"""ONE WORLD (tbuuol 2026-10-28): the zones' levels laid side by side into one level, src/levels/world.json, kept by one
house in one room. The zones stay their own files (edit those, then run this again):

    python3 tools/make_world.py

Layout, as on the world map (design/worldmap-draft.png): Blockshire stays where it was (its raiders, paths and fence
need no moving); the Beach lies north of it, past the hills, with a valley cut through them; the sea is beyond the
Beach, and the Pirate Ship lies at the end of the long dock, boarded over a gap in its rail (part of the open world
for now; instances come later). Portals between the zones are gone: they are walked."""
from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEVELS = ROOT / "src" / "levels"
OUT = LEVELS / "world.json"
VERSION = 1

BEACH = (0.0, -170.0)                       # where the Beach's (0, 0) lies in the world
SHIP = {"pos": [17.4, -203.0], "length": 30, "beam": 8, "deck": 0.7, "rot": 180}   # beside the long dock (x 12, z -185..-212),
# bow to the shore and the captain's quarterdeck out to sea, so his broadside does not reach the dock
PASS = {"a": [-30, -30], "b": [-6, -150], "w": 6, "fall": 12, "y": [0, 0.25]}   # the valley from Blockshire to the Beach


def load(name: str) -> dict:
    return json.loads((LEVELS / f"{name}.json").read_text())["data"]


def mv(p, d):
    """A point [x, z] (or [x, y, z]) moved by d = (dx, dz)."""
    if p is None:
        return None
    if len(p) == 3:
        return [round(p[0] + d[0], 2), p[1], round(p[2] + d[1], 2)]
    return [round(p[0] + d[0], 2), round(p[1] + d[1], 2)] + list(p[2:])


def mv_rect(r, d):
    return [round(r[0] + d[0], 2), round(r[1] + d[1], 2), round(r[2] + d[0], 2), round(r[3] + d[1], 2)] + list(r[4:])


def moved(obj: dict, d, keys=("pos", "lookAt", "center", "from", "to", "face", "at")) -> dict:
    o = json.loads(json.dumps(obj))
    for k in keys:
        if k in o and isinstance(o[k], list) and o[k] and isinstance(o[k][0], (int, float)):
            o[k] = mv(o[k], d)
    if "walk" in o and isinstance(o["walk"], list):
        o["walk"] = [mv(w, d) for w in o["walk"]]
    if "rect" in o:
        o["rect"] = mv_rect(o["rect"], d)
    return o


def pass_clear(ps, half=10, step=0.08):
    """Boxes along the valley, kept free of trees and rocks."""
    (ax, az), (bx, bz) = ps["a"], ps["b"]
    out, t = [], 0.0
    while t <= 1.0001:
        x, z = ax + (bx - ax) * t, az + (bz - az) * t
        out.append([round(x - half, 1), round(z - half, 1), round(x + half, 1), round(z + half, 1)])
        t += step
    return out


def main() -> None:
    blk, bch, shp = load("blockshire"), load("beach"), load("pirateship")
    sx, sz = SHIP["pos"]
    L, W = SHIP["length"], SHIP["beam"]
    footprint = [sx - W / 2, sz - L / 2, sx + W / 2, sz + L / 2]
    clear = pass_clear(PASS)

    env = dict(blk["env"])
    env.update({
        "terrain": "world",
        "parts": [
            {"terrain": "hills", "flat": blk["env"].get("flat", 30), "rect": [-400, -115, 400, 400], "band": 15},
            {"terrain": "coast", "at": list(BEACH), "shore": bch["env"].get("shore", -18), "inland": bch["env"].get("inland", 45),
             "rect": [-400, -1200, 400, -100], "band": 15},
            {"terrain": "ship", "over": True, "ship": dict(SHIP), "rect": footprint},
        ],
        "passes": [PASS],
        "grounds": [{"rect": [-220, -148, 220, 140], "mat": "grass"}, {"rect": [-220, -400, 220, -148], "mat": "sand"}],
    })
    env.pop("ground", None)

    bforest = dict(blk["forest"])
    bforest["clear"] = list(bforest.get("clear", [])) + clear
    sforest = moved(bch["forest"], BEACH)
    sforest["at"] = list(BEACH)
    sforest["outer"] = 60                   # palms on the Beach, not up in Blockshire's hills
    sforest["ridges"] = False               # the horizon once, from Blockshire's forest
    sforest["clear"] = [mv_rect(c, BEACH) for c in bch["forest"].get("clear", [])] + clear \
        + [[footprint[0] - 4, footprint[1] - 4, footprint[2] + 4, footprint[3] + 6]]   # no palm in the ship's rigging

    water = dict(bch["water"])
    water["pos"] = [0, -380]                # the sea ends in the Beach's hills (z -120), never under Blockshire

    ship = dict(shp["ships"][0])
    ship.update({"pos": [sx, sz], "deck": SHIP["deck"], "length": L, "beam": W, "rot": 180, "gaps": [[4, 7, 1]]})   # by the dock (turned: +1 is the dock side)
    wreck = [moved(s, BEACH) for s in bch["ships"] if s.get("list")]   # the old wreck in the cove stays; the decor ship goes

    def areas(src, d, respawn, turn=False):
        out = []
        for a in src["wild"]["areas"]:
            if turn:   # the pirate level's ship, turned round with it
                a = dict(a, center=[-a["center"][0], -a["center"][1]])
            a = moved(a, d)
            a["respawn"] = respawn
            out.append(a)
        return out

    species = {}
    for src in (blk, bch, shp):
        species.update(src["wild"]["species"])
    if "captain" in species:   # he keeps to his quarterdeck: nobody on the dock is in his sight
        species["captain"] = dict(species["captain"], sight=min(species["captain"].get("sight", 6), 4))
    wild = {
        "zone": blk["wild"].get("zone", "Greenwood"), "from": blk["wild"].get("from", 28), "respawn": blk["wild"].get("respawn", 25),
        "waterY": bch["wild"].get("waterY", -0.75), "species": species,
        "areas": areas(blk, (0, 0), blk["wild"].get("respawn", 25)) + areas(bch, BEACH, bch["wild"].get("respawn", 30))
                 + areas(shp, (sx, sz), shp["wild"].get("respawn", 120), turn=True),
    }

    quests, seen = [], set()
    for src in (blk, bch, shp):
        for q in src.get("quests", []):
            if q["id"] not in seen:
                seen.add(q["id"])
                quests.append(q)

    dock_foot = mv([12, 0.4, -13], BEACH)   # the fallen wake where the dock meets the sand, not among the crew
    world = {
        "id": "world", "title": "LiteWorldsQuest", "zoneElse": blk["wild"].get("zone", "Greenwood"),
        "from": ["blockshire", "beach", "pirateship"],
        "spawn": blk["spawn"], "spawnYaw": blk.get("spawnYaw", 0),
        "env": env,
        "edge": [{"c": [0, 0], "r": 100}, {"a": PASS["a"], "b": PASS["b"], "r": 9}, {"rect": [-150, -262, 60, -125]}],
        "zones": [
            {"name": "The Pirate Ship", "rect": footprint},
            *[moved(z, BEACH) for z in bch.get("zones", [])],
            {"name": bch.get("title", "Beach"), "rect": [-150, -262, 60, -140]},
            {"name": blk.get("title", "Blockshire"), "rect": [-24, -24, 24, 32]},
        ],
        "revives": [
            {"at": [0, 0], "spawn": blk["spawn"], "yaw": blk.get("spawnYaw", 0)},
            {"at": list(BEACH), "spawn": mv(bch["spawn"], BEACH), "yaw": bch.get("spawnYaw", 0), "text": bch.get("revive")},
            {"at": [sx, sz], "spawn": dock_foot, "yaw": 0, "text": shp.get("revive")},
        ],
        # Blockshire, as it was
        **{k: blk[k] for k in ("defense", "fence", "forge", "grass", "paths", "resources", "solids", "well") if k in blk},
        "fire": [blk["fire"], moved(bch["fire"], BEACH)],
        "forest": [bforest, sforest],
        "huts": blk.get("huts", []) + [moved(h, BEACH) for h in bch.get("huts", [])],
        "npcs": blk.get("npcs", []) + [moved(n, BEACH) for n in bch.get("npcs", [])],
        "props": blk.get("props", []) + [moved(p, BEACH) for p in bch.get("props", [])],
        "docks": [moved(d, BEACH) for d in bch.get("docks", [])],
        "ships": [ship] + wreck,
        "water": water,
        "wild": wild,
        "quests": quests,
    }
    OUT.write_text(json.dumps({"lwq": "module", "name": "level.world", "api": 1, "v": VERSION, "data": world}, indent=1,
                              ensure_ascii=False) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB, {len(wild['areas'])} areas, {len(quests)} quests, "
          f"{len(world['npcs'])} people")


if __name__ == "__main__":
    main()
