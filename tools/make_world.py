#!/usr/bin/env python3
"""THE WHOLE WORLD (tbuuol 2026-10-29, design/map-world-v2.png): one level, src/levels/world.json, on the terrain
module's ground (src/modules/terrain.js, the same function the map is painted with). The zones' own files stay where
their things are made (edit those, then run this again):

    python3 tools/make_world.py

Each place is a zone's things moved onto the map -- turned by a quarter turn if need be, and lifted to the ground it
stands on (its pad: flat ground the terrain makes for it): Blockshire on its cliff 14 m above the sea, Saltwind on the
bay with the sea to its west, the Pirate Ship moored at Saltwind's dock. The creatures of these zones are spread over
the Greenwood and the bay; the rest of the world is open land, its people still to come. Coordinates: metres, x east,
z south, Blockshire's middle at (0, 0); I(px, py) is a pixel of the draft (2 m each). The first, small world's builder
is make_world_v1.py."""
from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEVELS = ROOT / "src" / "levels"
OUT = LEVELS / "world.json"
VERSION = 3


def I(px, py):
    return [(px - 300) * 2, (py - 790) * 2]


def load(name: str) -> dict:
    return json.loads((LEVELS / f"{name}.json").read_text())["data"]


class Place:
    """A zone's things moved: turned by `turn` degrees (as three.js turns a group by +turn: -z goes to -x for 90),
    then shifted by `at`."""
    def __init__(self, at, turn=0):
        self.at, self.turn = at, turn % 360

    def xz(self, p):
        x, z = p[0], p[1]
        if self.turn == 90:
            x, z = z, -x
        elif self.turn == 180:
            x, z = -x, -z
        elif self.turn == 270:
            x, z = -z, x
        return [round(x + self.at[0], 2), round(z + self.at[1], 2)]

    def p3(self, p):
        x, z = self.xz([p[0], p[2]])
        return [x, p[1], z]

    def rect(self, r):
        a, b = self.xz([r[0], r[1]]), self.xz([r[2], r[3]])
        return [min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])]

    def thing(self, o):
        o = json.loads(json.dumps(o))
        for k in ("pos", "lookAt", "center", "from", "to", "face"):
            if k in o and isinstance(o[k], list) and o[k] and isinstance(o[k][0], (int, float)):
                o[k] = self.p3(o[k]) if len(o[k]) == 3 else self.xz(o[k])
        if "walk" in o:
            o["walk"] = [self.xz(w) for w in o["walk"]]
        if "rect" in o:
            o["rect"] = self.rect(o["rect"])
        if self.turn:
            o["rot"] = ((o.get("rot") or 0) + self.turn) % 360
        return o


def main() -> None:
    blk, bch, shp = load("blockshire"), load("beach"), load("pirateship")

    # ---- Blockshire: where it was, on its cliff ------------------------------------------------------------------
    LIFT = 14.0
    # no fence any more, and no raids (tbuuol 2026-10-29): the village is open to the Greenwood
    blockshire = {k: blk[k] for k in ("solids", "huts", "fire", "grass", "paths", "props", "resources", "forge", "well", "npcs") if k in blk}
    if blk.get("forest", {}).get("trees"):   # the village's own few trees, placed by hand
        blockshire["forest_trees"] = blk["forest"]["trees"]
    blockshire["lift"] = LIFT

    # ---- Saltwind: the Beach's village turned so its sea lies west, on the bay's east shore ---------------------
    SW = Place([242, -460], turn=90)   # the Beach's shore (its z -18) falls on the bay's shore (x 224)
    saltwind = {
        "lift": 0,
        "huts": [SW.thing(h) for h in bch.get("huts", [])],
        "npcs": [SW.thing(n) for n in bch.get("npcs", [])],
        "props": [SW.thing(p) for p in bch.get("props", [])],
        "docks": [SW.thing(d) for d in bch.get("docks", [])],
    }
    if bch.get("fire"):
        saltwind["fire"] = SW.thing(bch["fire"])
    for n in saltwind["npcs"]:
        n.pop("rot", None)
    long_dock = max(saltwind["docks"], key=lambda d: abs(d["from"][0] - d["to"][0]) + abs(d["from"][1] - d["to"][1]))
    dz = long_dock["from"][1]

    # ---- the Pirate Ship: moored south of the long dock, bow to the shore, the captain's quarterdeck out to sea ---
    L, B, D = 30, 8, 0.7
    sx, sz = 212.0, round(dz - 1.2 - B / 2 - 0.2, 2)
    ship = dict(shp["ships"][0])
    ship.update({"pos": [sx, sz], "rot": 90, "deck": D, "length": L, "beam": B, "walk": True, "gaps": [[-4, -1, -1]]})
    AFT = L / 2 - 8
    deck = {"rect": [sx - L / 2, sz - B / 2, sx + L / 2, sz + B / 2], "y": D, "quarter": D + 2.1, "axis": "x", "aftAt": sx - AFT, "aftSign": -1}

    def ship_xz(p):   # a point of the pirate level's ship (its own frame) in the world: the group turns by -rot
        return [round(sx - p[1], 2), round(sz + p[0], 2)]
    wreck = [dict(s, pos=I(150, 570), rot=200) for s in bch.get("ships", []) if s.get("list")]
    saltwind["ships"] = [ship] + wreck

    # ---- the creatures of these zones, spread over the Greenwood and the bay --------------------------------------
    sp = {}
    for src in (blk, bch, shp):
        sp.update(src["wild"]["species"])
    if "captain" in sp:
        sp["captain"] = dict(sp["captain"], sight=min(sp["captain"].get("sight", 6), 4))

    def A(species, at, r, n, respawn=30):
        return {"species": species, "center": at, "r": r, "count": n, "respawn": respawn}
    areas = [
        A("boar", [-95, -45], 14, 4, 25), A("boar", [85, -70], 14, 4, 25), A("boar", [-60, -150], 14, 4, 25), A("boar", [120, -150], 14, 4, 25),
        A("wolf", [-230, -110], 16, 4), A("wolf", [40, -240], 16, 4), A("wolf", [-150, -250], 16, 4), A("wolf", [200, -40], 16, 4),
        A("spider", [-330, -10], 14, 4, 35), A("spider", [-260, -300], 14, 4, 35), A("spider", [150, -300], 14, 3, 35),
        A("crab", I(255, 470), 14, 5), A("crab", I(330, 488), 12, 4), A("crab", I(395, 640), 12, 4),
        A("siren", I(262, 585), 14, 4, 40), A("drowned", I(195, 455), 12, 4, 40),
    ]
    for a in shp["wild"]["areas"]:   # the crew, where they stood on their ship
        areas.append(dict(a, center=ship_xz(a["center"]), respawn=shp["wild"].get("respawn", 120)))
    wild = {"zone": "Greenwood", "from": 28, "respawn": 25, "waterY": bch["wild"].get("waterY", -0.75), "species": sp, "areas": areas}

    quests, seen = [], set()
    for src in (blk, bch, shp):
        for q in src.get("quests", []):
            if q["id"] not in seen:
                seen.add(q["id"])
                quests.append(q)

    def zone(name, a, b):
        (x0, z0), (x1, z1) = I(*a), I(*b)
        return {"name": name, "rect": [min(x0, x1), min(z0, z1), max(x0, x1), max(z0, z1)]}
    zones = [
        {"name": "The Pirate Ship", "rect": deck["rect"]},
        {"name": "Blockshire", "rect": [-30, -30, 30, 40]},
        zone("Saltwind", (385, 530), (440, 590)),
        zone("Mermaid Cove", (200, 540), (330, 640)),
        zone("Beach", (170, 440), (420, 690)),
        zone("Goblin Village", (545, 380), (700, 545)),
        zone("Valley", (290, 130), (650, 340)),
        zone("Troll Clifftop", (680, 20), (960, 330)),
        zone("Minotaur Fortress", (1060, 100), (1400, 340)),
        zone("Unicorn Glade", (720, 310), (1150, 650)),
        zone("Harpy Nest", (1150, 380), (1520, 680)),
        zone("Naga Swamp", (1200, 680), (1536, 1024)),
        zone("Old Cemetery", (900, 660), (1200, 1000)),
        zone("Genesis", (560, 650), (800, 880)),
        zone("Mountains", (950, 0), (1536, 380)),
    ]
    spawn = [blk["spawn"][0], blk["spawn"][1] + LIFT, blk["spawn"][2]]
    env = dict(blk["env"])
    env.pop("flat", None)
    env.update({"ground": 0})
    world = {
        "id": "world", "title": "LiteWorldsQuest", "zoneElse": "Greenwood",
        "from": ["blockshire", "beach", "pirateship"],
        "spawn": spawn, "spawnYaw": blk.get("spawnYaw", 0),
        "env": env,
        "land": {"pads": [{"at": [0, 0], "r": 62, "y": LIFT, "rim": 40},
                          {"at": [SW.at[0] + 6, SW.at[1]], "r": 24, "y": 0.25, "rim": 14, "landOnly": True}],
                 "decks": [deck]},
        "places": [blockshire, saltwind],
        "defense": {k: v for k, v in (blk.get("defense") or {}).items() if k != "spawns"},   # the guards and the priest; no raider waves
        "wild": wild, "quests": quests, "zones": zones,
        "revives": [
            {"at": [0, 0], "spawn": spawn, "yaw": blk.get("spawnYaw", 0)},
            {"at": SW.at, "spawn": SW.p3(bch["spawn"]), "yaw": 0, "text": bch.get("revive")},
            {"at": [sx, sz], "spawn": [long_dock["from"][0] + 4, 0.4, dz], "yaw": 0, "text": shp.get("revive")},
        ],
    }
    OUT.write_text(json.dumps({"lwq": "module", "name": "level.world", "api": 1, "v": VERSION, "data": world}, indent=1,
                              ensure_ascii=False) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB, {len(areas)} areas, {len(quests)} quests, "
          f"long dock {long_dock['from']} -> {long_dock['to']}, ship at {sx},{sz}")


if __name__ == "__main__":
    main()
