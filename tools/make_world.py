#!/usr/bin/env python3
"""THE WHOLE WORLD (tbuuol 2026-10-29, design/map-world-v2.png): one level, src/levels/world.json, on the terrain
module's ground (src/modules/terrain.js, the same function the map is painted with). The zones' own files stay where
their things are made (edit those, then run this again):

    python3 tools/make_world.py

Each place is a zone's things moved onto the map -- turned by a quarter turn if need be, and lifted to the ground it
stands on (its pad: flat ground the terrain makes for it): Blockshire on its cliff 14 m above the sea, Saltwind on the
bay with the sea to its west, the Pirate Ship at a dock of its own on the bay's north shore. The creatures live in
areas shaped to the land (few, some or many) round Blockshire, on the beach and on the Goblin Village's island; things
to gather lie out in the land; Genesis has its city wall. The terrain is read through tools/terrain_probe.cjs (node).
The rest of the world is open land, its people still to come. Coordinates: metres, x east,
z south, Blockshire's middle at (0, 0); I(px, py) is a pixel of the draft (2 m each). The first, small world's builder
is make_world_v1.py."""
from __future__ import annotations

import glob
import json
import math
import pathlib
import random
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEVELS = ROOT / "src" / "levels"
OUT = LEVELS / "world.json"
VERSION = 23


def probe(land: dict, points: list) -> list:
    """The terrain at these points ([[walk, coast, river, road, slope], ...]): tools/terrain_probe.cjs, the game's own
    terrain module run by node (the one Playwright brings, if there is no other)."""
    node = shutil.which("node") or (glob.glob(str(ROOT / "tools/.venv/lib/python3.*/site-packages/playwright/driver/node")) or [None])[0]
    if not node:
        raise SystemExit("make_world.py needs node (or tools/.venv's Playwright) to read the terrain")
    out = subprocess.run([node, str(ROOT / "tools" / "terrain_probe.cjs")], input=json.dumps({"land": land, "points": points}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def inside(poly, x, z) -> bool:
    hit = False
    for i in range(len(poly)):
        (xi, zi), (xj, zj) = poly[i], poly[i - 1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            hit = not hit
    return hit


def box(poly):
    xs, zs = [p[0] for p in poly], [p[1] for p in poly]
    return min(xs), min(zs), max(xs), max(zs)


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
        if isinstance(o.get("walk"), list):
            o["walk"] = [self.xz(w) for w in o["walk"]]
        if "rect" in o:
            o["rect"] = self.rect(o["rect"])
        if self.turn:
            o["rot"] = ((o.get("rot") or 0) + self.turn) % 360
        return o


#: GENESIS (tbuuol 2026-11-07): the city players will build, inside the wall. Its plan -- streets, plaza, the two halls,
#: the plots -- is design/genesis/plots.json (design/genesis/plan.py, the map tbuuol approved); here it becomes a place
#: on its flat ground (a pad at GEN_Y), with the fountain, the town hall's registrar and the guild's master.
GEN, GEN_Y = (790, -40), 7.0
PLAN = ROOT / "design" / "genesis" / "plan2.json"   # the second plan (2026-11-10); plots.json was the first


def make_genesis(ring: list) -> dict:
    plan = json.loads(PLAN.read_text())
    cx, cz = plan["centre"]
    strips = []
    for _, a, b, c, e, w in plan["streets"]:   # each street cut to where it is inside the wall (3 m short of it)
        n = max(2, int(math.hypot(c - a, e - b) // 2))
        pts = [(a + (c - a) * i / n, b + (e - b) * i / n) for i in range(n + 1)]
        pts = [q for q in pts if inside(ring, *q) and all(math.hypot(q[0] - r[0], q[1] - r[1]) > 3 for r in ring)]
        if len(pts) > 1:
            strips.append([round(pts[0][0], 1), round(pts[0][1], 1), round(pts[-1][0], 1), round(pts[-1][1], 1), w])
    halls, npcs = [], []
    KEEPER = {
        "townhall": ("registrar", "Registrar Aldous", "Town Hall", "#2f4f7a", {"person": "i", "skin": "#e0b48c", "shirt": "#2f4f7a", "pants": "#2a2a30", "hair": "#7a6a5a", "beard": "#8a7a6a", "robe": "#2f4f7a"},
                     ["Welcome to Genesis, traveller. This city is not built yet -- it will be built by those who live in it.",
                      "Every plot inside the wall has its number: houses to the north and south, workshops in the east, shops along the gate street.",
                      "Soon you will buy a plot here. Its deed is yours, and what you build on it is yours too.",
                      "Own two plots side by side, and you may build one great building over both."]),
        "guild": ("guildmaster", "Guildmaster Rowan", "Adventurers' Guild", "#7a2a2a", {"person": "i", "skin": "#c98b62", "shirt": "#5a3a22", "pants": "#3b2f25", "hair": "#2a1a10", "beard": "#2a1a10", "hood": "#7a2a2a"},
                  ["The Adventurers' Guild. Out there are boars, wolves, goblins and worse, and the city needs what they guard.",
                   "Soon this board will hold work for every day: hunts, deliveries, things to fetch. Come back, and come back again.",
                   "Until then: Blockshire's elder and the people of Saltwind have tasks for you."]),
        "tavern": ("innkeeper", "Mabel the Innkeeper", "The Green Boar Inn", "#6a4a1a", {"person": "f", "skin": "#e8c09c", "shirt": "#8a5a2a", "pants": "#4a3a2a", "hair": "#9a5a2a"},
                   ["Come in, come in! A warm fire and a cold ale, that is what the Green Boar is for.",
                    "Everyone who comes through the west gate stops here first. You hear things, at an inn.",
                    "They say raiders camp south of Blockshire, and spiders nest under Greenwood. Mind yourself."]),
        "temple": ("priestess", "Sister Elowen", "Temple of the Light", "#d8cfa8", {"person": "c", "skin": "#e8c09c", "shirt": "#e9e2cf", "pants": "#c9bfa5", "hair": "#c9a04a", "hood": "#d8cfb6", "robe": "#e9e2cf"},
                   ["Peace be with you. The temple's doors are open to all who come to Genesis.",
                    "One day the light will bless those who ask. For now, rest a while; this is a quiet place."]),
        "stables": ("stablemaster", "Hob the Stablemaster", "Stables", "#5a3a22", {"person": "m", "skin": "#c98b62", "shirt": "#5a4a2a", "pants": "#3a2a1a", "hair": "#3a2a1a", "beard": "#3a2a1a"},
                    ["Stables, aye. No horses yet -- the roads east are not safe enough to bring them in.",
                     "When there are mounts, you'll find them here, by the east gate."]),
    }
    DOOR = {"townhall": 1, "guild": 1, "tavern": 1, "temple": -1, "stables": -1}   # +1: the door on the south side, -1: north
    for b in plan["buildings"]:
        x0, z0, x1, z1 = b["rect"]
        dz = DOOR[b["id"]]
        dep = 22 if b["id"] in ("townhall", "guild") else round(z1 - z0 - 2, 1)
        hx, hz = (x0 + x1) / 2, (z1 - 1 - dep / 2) if dz > 0 else (z0 + 1 + dep / 2)   # against the street its door is on
        nid, name, sign, banner, look, lines = KEEPER[b["id"]]
        halls.append({"id": b["id"], "pos": [round(hx, 1), round(hz, 1)], "size": [round(x1 - x0 - (8 if dep == 22 else 4), 1), dep],
                      "rot": 180 if dz > 0 else 0, "sign": sign, "banner": banner})
        npc = {"id": nid, "name": name, "pos": [round(hx, 1), round(hz - dz * (dep / 2 - 2), 1)], "lookAt": [round(hx, 1), round(hz + dz * dep / 2, 1)],
               "talkTurn": True, "look": look, "lines": lines}
        if b["id"] == "townhall":   # the registry of plots (engine: E on him opens it)
            npc.update({"office": "plots", "greet": "Welcome to the registry of Genesis. Pick a plot on the plan, and it can be yours."})
        if b["id"] == "guild":   # the guild's board: three tasks a day (engine: E on him opens it)
            npc.update({"office": "guild", "greet": "The board has work for you, as every day."})
        npcs.append(npc)
    props = []
    for k in range(8):   # benches round the plaza, facing the fountain
        t = (k + 0.5) / 8 * 2 * math.pi
        props.append({"kind": "bench", "pos": [round(cx + 16 * math.cos(t), 1), round(cz + 16 * math.sin(t), 1)], "rot": round(90 - math.degrees(t), 1) % 180})
    for k in range(12):   # lanterns on the plaza's edge, between the streets that come in (never in their way)
        t = (k + 0.5) / 12 * 2 * math.pi
        props.append({"kind": "lamppost", "pos": [round(cx + (plan["plaza_r"] - 2) * math.cos(t), 1), round(cz + (plan["plaza_r"] - 2) * math.sin(t), 1)]})
    for x0, z0, x1, z1, w in strips:   # and along every street, both sides, every 24 m
        L = math.hypot(x1 - x0, z1 - z0)
        for i in range(1, int(L // 24)):
            px, pz = x0 + (x1 - x0) * i * 24 / L, z0 + (z1 - z0) * i * 24 / L
            if math.hypot(px - cx, pz - cz) < plan["plaza_r"] + 4:
                continue
            nx, nz = -(z1 - z0) / L * (w / 2 + 0.4), (x1 - x0) / L * (w / 2 + 0.4)
            props.append({"kind": "lamppost", "pos": [round(px + nx * (1 if i % 2 else -1), 1), round(pz + nz * (1 if i % 2 else -1), 1)]})
    # the plots: the game's three kinds (house, shop, workshop) and their size; the price grows with the ground
    BASE = {"house": (0.05, 320), "shop": (0.08, 168), "workshop": (0.12, 572)}
    plots = []
    for p in plan["plots"]:
        kind = p["kind"] if p["kind"] in ("shop", "workshop") else "house"
        w, d = p["rect"][2] - p["rect"][0], p["rect"][3] - p["rect"][1]
        price = max(0.02, round(BASE[kind][0] * w * d / BASE[kind][1], 3))
        plots.append({"id": p["id"], "kind": kind, "size": p["kind"], "rect": p["rect"], "price": f"{price:g}"})
    # the squares: a few trees, benches and a lantern round each (the ground there is left green)
    trees = []
    for _, (sx, sz), h in plan.get("squares", []):
        for k, (ax, az) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            trees.append([round(sx + ax * (h - 3), 1), round(sz + az * (h - 3), 1), 1.0 + 0.1 * k, "oak"])
        props += [{"kind": "bench", "pos": [sx, sz - 5], "rot": 0}, {"kind": "bench", "pos": [sx, sz + 5], "rot": 0},
                  {"kind": "lamppost", "pos": [sx + 5, sz]}]
    # GARDENS by the wall (tbuuol's plan, 2026-11-10): the strips no plot fits in get trees, every 7 m or so
    taken = [q["rect"] for q in plots] + [b["rect"] for b in plan["buildings"]] + [[sx - h, sz - h, sx + h, sz + h] for _, (sx, sz), h in plan.get("squares", [])]
    for sx_, a, b_, c, e, w in plan["streets"]:
        taken.append([min(a, c) - (w / 2 if a == c else 0) - 2, min(b_, e) - (w / 2 if b_ == e else 0) - 2, max(a, c) + (w / 2 if a == c else 0) + 2, max(b_, e) + (w / 2 if b_ == e else 0) + 2])
    rnd = random.Random(707)
    for gz in range(-236, 136, 7):
        for gx in range(562, 1060, 7):
            x, z = gx + rnd.uniform(-2, 2), gz + rnd.uniform(-2, 2)
            if not inside(ring, x, z) or min(math.hypot(x - r[0], z - r[1]) for r in ring) < 4 or math.hypot(x - cx, z - cz) < plan["plaza_r"] + 3:
                continue
            if any(r[0] - 3 < x < r[2] + 3 and r[1] - 3 < z < r[3] + 3 for r in taken):
                continue
            trees.append([round(x, 1), round(z, 1), round(0.9 + rnd.random() * 0.4, 2), "oak" if rnd.random() < 0.7 else "pine"])
    return {"id": "genesis", "lift": GEN_Y, "paths": {"paved": True, "circles": [[cx, cz, plan["plaza_r"]]], "strips": strips},
            "fountain": {"pos": [cx, cz], "r": plan["fountain_r"]}, "halls": halls, "npcs": npcs, "props": props, "plots": plots,
            "forest_trees": trees}



#: THE SPIDER CAVE (tbuuol 2026-11-10: "richtig schön groß", a Broodmother at the end): laid out in
#: design/spidercave/layout.py, hollowed out of the northern mountains' rock (the mountain is 98 m and more over all of
#: it; nobody walks up there), its mouth in Greenwood Deep. The cave's own metres: the entrance grotto at 0, 0.
CAVE_AT, CAVE_Y = (2000, -1480), 40.0
CAVE_MOUTH, CAVE_FACE = (-290.0, -20.0), (-270.0, -20.0)


#: the cave's spiders (stage 2): its own kinds, drawn as the forest's spider (model), small or big (size)
CAVE_SPECIES = {
    "cave_spider": {"name": "Cave Spider", "lvl": 8, "hp": 95, "dmg": 11, "speed": 3.3, "aggressive": True, "sight": 8, "def": 1,
                    "model": "spider", "color": "#2a2228", "loot": [["spider_silk", 0.6], ["venom_sac", 0.25]], "codex": ["evade", "toughness", "herbalism"]},
    "spiderling": {"name": "Spiderling", "lvl": 4, "hp": 30, "dmg": 4, "speed": 4.2, "aggressive": True, "sight": 9, "def": 0,
                   "model": "spider", "color": "#5a4636", "size": 0.55, "loot": [["spider_silk", 0.3]], "codex": ["evade", "toughness"]},
    "broodmother": {"name": "The Broodmother", "lvl": 16, "hp": 1800, "dmg": 24, "speed": 2.6, "aggressive": True, "sight": 11, "def": 3,
                    "model": "spider", "color": "#2a0f22", "size": 3.0, "cd": 2.0, "range": 2.0,
                    "boss": {"aoe": {"every": 11, "first": 5, "radius": 6, "dmg": 32, "warn": 1.8, "name": "Venom Spray"},
                             "adds": {"at": [0.75, 0.5, 0.25], "species": "spiderling", "n": 4, "mat": 1, "home": True},
                             "web": {"every": 14, "first": 8, "s": 3, "name": "The Broodmother's web"}},
                    "loot": [["broodfang", 0.3], ["silkweave_mantle", 0.3], ["venom_ring", 0.3], ["carapace_shield", 0.2],
                             ["brood_carapace", 1], ["spider_silk", 1], ["spider_silk", 1], ["venom_sac", 1], ["venom_sac", 0.5]],
                    "codex": ["evade", "toughness", "str"]},
    "brood_guard": {"name": "Brood Guardian", "lvl": 11, "hp": 190, "dmg": 15, "speed": 3.0, "aggressive": True, "sight": 7, "def": 2,
                    "model": "spider", "color": "#3a1e2e", "size": 1.45, "loot": [["spider_silk", 0.8], ["venom_sac", 0.45]], "codex": ["evade", "toughness", "herbalism"]},
}


def cave_spots(L, where, n, seed):
    """n places to stand in a chamber (its id) or along a tunnel (its index), in the cave's metres, well inside the rock."""
    rnd = random.Random(seed)
    if isinstance(where, str):
        cid, _, (cx, cz), (rx, rz), *_ = next(c for c in L.CHAMBERS if c[0] == where)
        out = []
        while len(out) < n:
            a, d = rnd.random() * 2 * math.pi, math.sqrt(rnd.random()) * 0.65
            out.append([round(cx + math.cos(a) * rx * d, 1), round(cz + math.sin(a) * rz * d, 1)])
        return out, [cx, cz], max(rx, rz) + 2
    pts = L.TUNNELS[where][0]
    segs = list(zip(pts, pts[1:])); total = sum(math.dist(a[:2], b[:2]) for a, b in segs)
    out = []
    for k in range(n):
        t, acc = (k + 0.5) / n * total, 0
        for a, b in segs:
            ln = math.dist(a[:2], b[:2])
            if acc + ln >= t:
                f = (t - acc) / ln; out.append([round(a[0] + (b[0] - a[0]) * f, 1), round(a[1] + (b[1] - a[1]) * f, 1)]); break
            acc += ln
    mid = out[len(out) // 2]
    return out, mid, total / 2 + 3

#: THE RAIDERS' CAMP (tbuuol 2026-11-10: "südlich von Blockshire, weil die Wachen auch südlich stehen"): a ring of
#: stakes on the gentle land between the gate and the cliff; by day its raiders and their chief keep it, by night the
#: raids on the gate set out from its opening.
CAMP, CAMP_R, CAMP_Y = (-60.0, 120.0), 17.0, 13.3


#: THE GREENWOOD'S PLACES (tbuuol 2026-11-10: "die Welt ist immer noch sehr leer"; the accepted proposal,
#: design/greenwood-proposal.png): something every 150 m or so between Blockshire and Genesis. Each is a place of its
#: own on a flattened pad (its things stand on its height), with its people; resource nodes stand on the ground.
def make_greenwood():
    look = lambda **k: dict({"person": "m", "skin": "#d9a882", "pants": "#3b2f25"}, **k)
    def hut(i, pos, size, rot, **k):
        return dict({"id": i, "pos": list(pos), "size": list(size), "rot": rot, "chimney": True, "lit": True, "trim": "#6a4a2e",
                     "inside": ["bed", "table", "shelf"], "door": {"id": "door_" + i, "label": "Door", "opens": "hand"}}, **k)
    places, pads, nodes = [], [], []
    def place(pid, centre, y, r, **things):
        pads.append({"at": list(centre), "r": r, "y": y, "rim": 10, "landOnly": True})
        places.append(dict({"id": pid, "lift": y}, **things))
    # the hunter's lodge, at the edge of Greenwood North where the wolves are
    hx, hz = -80, -160
    place("hunters", (hx, hz), 10.6, 12,
          huts=[hut("hunter", (hx, hz - 3), (5, 4), 180)], fire={"pos": [hx + 4, hz + 4]},
          props=[{"kind": "stump", "pos": [hx - 4, hz + 3], "axe": True}, {"kind": "logpile", "pos": [hx + 5, hz - 4], "rot": 90},
                 {"kind": "barrel", "pos": [hx - 3, hz - 5]}],
          npcs=[{"id": "hunter_wynn", "name": "Wynn the Hunter", "pos": [hx + 1, hz + 3], "lookAt": [hx + 4, hz + 4], "talkTurn": True,
                 "look": look(skin="#c98b62", shirt="#4a5a2a", hair="#3a2a1a", beard="#3a2a1a", hood="#3a4a22"),
                 "lines": ["Mind the wolves to the north. They hunt in threes, and they do not give up.",
                           "Pelts and fangs, that is what the forest pays with. Bring me some, one day I'll make it worth your while.",
                           "Deeper west the trees turn black with webs. I don't go there any more."]}])
    # the lumber camp: the oak Genesis is built from
    lx, lz = 120, -120
    place("lumbercamp", (lx, lz), 12.8, 14,
          huts=[hut("bunkhouse", (lx - 4, lz - 4), (7, 5), 180, inside=["bed", "bed", "table"])],
          fire={"pos": [lx + 5, lz + 3]},
          props=[{"kind": "logpile", "pos": [lx + 6, lz - 6], "rot": 0}, {"kind": "logpile", "pos": [lx + 9, lz - 3], "rot": 90},
                 {"kind": "logpile", "pos": [lx - 8, lz + 5], "rot": 20}, {"kind": "stump", "pos": [lx + 2, lz + 7], "axe": True},
                 {"kind": "stump", "pos": [lx - 3, lz + 8], "axe": True}, {"kind": "cart", "pos": [lx + 10, lz + 6], "rot": 70},
                 {"kind": "crate", "pos": [lx - 1, lz - 9]}],
          npcs=[{"id": "foreman_tamsin", "name": "Foreman Tamsin", "pos": [lx + 2, lz + 1], "lookAt": [lx + 5, lz + 3], "talkTurn": True,
                 "look": look(person="f", skin="#e0b48c", shirt="#7a3a22", hair="#7a3a1a", gloves="#4a3a2a"),
                 "lines": ["Every beam in Genesis comes through this camp. Or it will, once there's a city to speak of.",
                           "The oaks round here are good and straight. Take an axe to them if you need logs for your own walls.",
                           "Raiders took two of our carts last week. If you see Grimwald, give him one from me."]}])
    for k in range(10):   # oaks to fell round the camp
        a = k / 10 * 2 * math.pi + 0.3
        nodes.append({"id": f"lc.tree.{k + 1}", "kind": "tree", "pos": [round(lx + math.cos(a) * 19, 1), round(lz + math.sin(a) * 17, 1)], "ground": True})
    # the wayside inn by the bridge on the road to Genesis
    ix, iz = 232, 0
    place("wayside", (ix, iz), 11.3, 12,
          huts=[hut("wayside_inn", (ix, iz), (9, 6), 0, inside=["table", "table", "bed", "shelf", "rug"], rug="#7a3a22")],
          fire={"pos": [ix - 7, iz + 6]},
          props=[{"kind": "bench", "pos": [ix - 4, iz + 6], "rot": 0}, {"kind": "bench", "pos": [ix + 4, iz + 6], "rot": 0},
                 {"kind": "barrel", "pos": [ix + 6, iz - 2]}, {"kind": "barrel", "pos": [ix + 6.6, iz - 1.2]}, {"kind": "lamppost", "pos": [ix + 5.5, iz + 4]},
                 {"kind": "cart", "pos": [ix - 9, iz - 2], "rot": 90},
                 {"kind": "signpost", "pos": [ix + 2, iz + 12], "signs": [["Genesis", 0], ["Blockshire", 180]]}],
          npcs=[{"id": "hennick", "name": "Old Hennick", "pos": [ix + 1, iz + 5], "lookAt": [ix + 1, iz + 10], "talkTurn": True,
                 "look": look(skin="#e8c09c", shirt="#5a4a2a", hair="#d8d8d8", beard="#e6e6e6"),
                 "lines": ["Halfway between Blockshire and Genesis -- a good place for a rest, and a better one for news.",
                           "The spiders have a cave under Greenwood Deep, they say. Far to the west, by the black trees.",
                           "At night the raiders come up from their camp south of the village. You'll see their fire from the cliff."]}])
    # a farm with its windmill on the South Fields, east of the raiders
    fx, fz = 150, 110
    place("farm", (fx, fz), 12.0, 18,
          huts=[hut("farmhouse", (fx - 6, fz - 6), (7, 5), 180), hut("barn", (fx + 6, fz - 7), (8, 6), 180, chimney=False, lit=False, inside=[])],
          windmill={"pos": [fx + 10, fz + 9], "face": 200},
          fence={"rect": [fx - 14, fz + 1, fx + 4, fz + 15]},
          props=[{"kind": "haystack", "pos": [fx - 9, fz + 6]}, {"kind": "haystack", "pos": [fx - 4, fz + 10]}, {"kind": "haystack", "pos": [fx - 10, fz + 11]},
                 {"kind": "cart", "pos": [fx + 1, fz - 1], "rot": 30}, {"kind": "barrel", "pos": [fx - 1, fz - 9]}],
          npcs=[{"id": "farmer_hal", "name": "Farmer Hal", "pos": [fx - 2, fz - 1], "lookAt": [fx - 6, fz + 6], "talkTurn": True,
                 "look": look(skin="#c98b62", shirt="#8a7a4a", hair="#8a6a3a", beard="#8a6a3a"),
                 "lines": ["The boars get into the fields every night. Every single night.",
                           "Flax and wheat, that's what we grow. Genesis will need bread, once people live there.",
                           "The mill grinds when the wind is up. Listen -- you can hear the sails from the road."]}])
    for k in range(6):   # flax to pull at the field's edge
        nodes.append({"id": f"farm.herb.{k + 1}", "kind": "herb", "pos": [round(fx - 12 + k * 3, 1), round(fz + 18, 1)], "ground": True})
    # the stone circle in a clearing north of the road
    sx, sz = 380, -150
    place("stonecircle", (sx, sz), 5.3, 13, stoneCircle={"c": [sx, sz], "r": 8, "n": 9})
    for k in range(5):   # herbs that grow where the old stones stand
        a = k / 5 * 2 * math.pi
        nodes.append({"id": f"sc.herb.{k + 1}", "kind": "herb", "pos": [round(sx + math.cos(a) * 12, 1), round(sz + math.sin(a) * 12, 1)], "ground": True})
    # the old watchtower on the cliff
    tx, tz = 348, 138
    place("watchtower", (tx, tz), 10.9, 9, watchtower={"pos": [tx, tz], "rot": 180},
          npcs=[{"id": "sentry_ulf", "name": "Old Ulf", "pos": [tx, tz - 4.5], "lookAt": [tx, tz - 10], "talkTurn": True,
                 "look": look(skin="#d9a882", shirt="#5d6470", hair="#9a9a9a", helm="#9aa1ab", armor="#9aa1ab"),
                 "lines": ["From up there you see the whole coast: the village on its cliff, the raiders' fire, Genesis' wall.",
                           "Thirty years I've watched this sea. The pirates come from the west, mark my words.",
                           "When the moon is up, the raiders move. I light the beacon, and Blockshire's guards get ready."]}])
    # a signpost where the road leaves Blockshire
    places.append({"id": "signs", "lift": 14.0, "props": [{"kind": "signpost", "pos": [40, 6], "signs": [["Genesis", 0], ["Beach", -90]]}]})
    return places, pads, nodes


#: GENESIS' SURROUNDINGS (the same proposal, 2026-11-10): a merchants' camp at the west gate, fields and a mill south
#: of the wall, a mine at the quarry, a tourney ground before the new east gate.
def make_outskirts():
    look = lambda **k: dict({"person": "m", "skin": "#d9a882", "pants": "#3b2f25"}, **k)
    places, pads, nodes = [], [], []
    def place(pid, centre, y, r, **things):
        pads.append({"at": list(centre), "r": r, "y": y, "rim": 10, "landOnly": True})
        places.append(dict({"id": pid, "lift": y}, **things))
    # the merchants' camp by the west gate, south of the road
    cx, cz = 522, -12
    place("caravan", (cx, cz), 7.0, 15,
          tents=[{"pos": [cx - 7, cz + 2], "rot": 90, "color": "#2e4a6a"}, {"pos": [cx + 7, cz + 3], "rot": -90, "color": "#6a5a2e"},
                 {"pos": [cx, cz + 8], "rot": 180, "color": "#5a2e5a"}],
          fire={"pos": [cx, cz + 1]},
          props=[{"kind": "cart", "pos": [cx - 10, cz - 6], "rot": 80}, {"kind": "cart", "pos": [cx + 10, cz - 6], "rot": 100},
                 {"kind": "crate", "pos": [cx - 3, cz - 5]}, {"kind": "crate", "pos": [cx - 2, cz - 6]}, {"kind": "barrel", "pos": [cx + 3, cz - 5]},
                 {"kind": "barrel", "pos": [cx + 4, cz - 6]}, {"kind": "lamppost", "pos": [cx + 2, cz - 8]}],
          npcs=[{"id": "merchant_ysolde", "name": "Ysolde the Merchant", "pos": [cx - 1, cz - 3], "lookAt": [cx, cz - 12], "talkTurn": True,
                 "look": look(person="f", skin="#c98b62", shirt="#2e4a6a", hair="#1a1a1a", hood="#5a2e5a"),
                 "lines": ["Silks from the coast, iron from the hills, salt from Saltwind -- whatever Genesis needs, we bring it.",
                           "We camp outside the wall. The city's levy is ten in a hundred, and we'd rather keep that tenth.",
                           "Once the shops in town are open, we'll trade with them. Until then, the road is our market."]}])
    # the fields and the mill south of the wall
    fx, fz = 610, 148
    place("genesis_fields", (fx + 8, fz), 7.6, 26,
          windmill={"pos": [fx - 18, fz - 4], "face": 150},
          fence={"rect": [fx - 8, fz - 10, fx + 36, fz + 6]},
          props=[{"kind": "haystack", "pos": [fx - 2, fz - 4]}, {"kind": "haystack", "pos": [fx + 6, fz]}, {"kind": "haystack", "pos": [fx + 22, fz - 3]},
                 {"kind": "haystack", "pos": [fx + 30, fz + 1]}, {"kind": "cart", "pos": [fx + 14, fz - 13], "rot": 0}])
    for k in range(10):
        nodes.append({"id": f"gf.herb.{k + 1}", "kind": "herb", "pos": [round(fx - 6 + (k % 5) * 4 + (20 if k >= 5 else 0), 1), round(fz - 6 + (k % 2) * 6, 1)], "ground": True})
    # the mine at the north end of the quarry: a timbered mouth into the hill, ore to break round it
    mx, mz = 488, -160
    place("mine", (mx, mz), 5.7, 9, props=[{"kind": "cart", "pos": [mx + 4, mz + 6], "rot": 20}, {"kind": "logpile", "pos": [mx - 5, mz + 5], "rot": 90},
                                             {"kind": "lamppost", "pos": [mx + 3, mz + 2]}])
    places[-1]["mineMouth"] = {"pos": [mx, mz], "face": [mx, mz + 20]}
    for k in range(8):
        a = math.pi * (0.15 + k / 8 * 0.7)
        nodes.append({"id": f"mine.rock.{k + 1}", "kind": "rock", "pos": [round(mx + math.cos(a) * 10, 1), round(mz + math.sin(a) * 9, 1)], "ground": True})
    # the tourney ground before the east gate
    tx, tz = 1100, -40
    place("tourney", (tx, tz), 10.0, 22,
          fence={"rect": [tx - 16, tz - 10, tx + 16, tz + 10], "gate": [tx - 3, tx + 3]},
          banner=[{"pos": [tx - 17, tz - 11], "rot": 0, "color": "#2f4f7a"}, {"pos": [tx + 17, tz - 11], "rot": 0, "color": "#7a2a2a"},
                  {"pos": [tx - 17, tz + 11], "rot": 180, "color": "#7a2a2a"}, {"pos": [tx + 17, tz + 11], "rot": 180, "color": "#2f4f7a"}],
          props=[{"kind": "bench", "pos": [tx - 8, tz - 13], "rot": 0}, {"kind": "bench", "pos": [tx, tz - 13], "rot": 0}, {"kind": "bench", "pos": [tx + 8, tz - 13], "rot": 0},
                 {"kind": "stump", "pos": [tx - 6, tz]}, {"kind": "stump", "pos": [tx + 6, tz]}],
          npcs=[{"id": "aldric", "name": "Sir Aldric", "pos": [tx, tz - 4], "lookAt": [tx, tz + 4], "talkTurn": True,
                 "look": look(skin="#e0b48c", shirt="#5d6470", hair="#8a6a4a", beard="#8a6a4a", helm="#9aa1ab", armor="#9aa1ab", gloves="#5a4a3a"),
                 "lines": ["The lists of Genesis! Empty now, but one day the city's champions will meet here.",
                           "Keep your guard up and your feet under you. The rest is practice.",
                           "When the city has a council, there will be tourneys, and prizes worth fighting for."]}])
    return places, pads, nodes


#: QUESTS FOR THE NEW PLACES (2026-11-10): each place's keeper has work, most of it leading somewhere new
GREENWOOD_QUESTS = [
    {"id": "gw_wolves", "npc": "hunter_wynn", "giver": "Wynn the Hunter", "title": "Wolf Trouble",
     "offer": "The wolves of Greenwood North have grown bold. Bring down six of them, and I'll give you a mantle of their skins.",
     "done": "Six! The forest is quieter already. Here -- it'll keep the rain off.",
     "need": {"kill": {"wolf": 6}}, "reward": {"items": ["wolfskin_mantle"], "sk": {"anatomy": 15}}},
    {"id": "gw_fangs", "npc": "hunter_wynn", "giver": "Wynn the Hunter", "title": "A Ring of Fangs", "after": "gw_wolves",
     "offer": "Wolf fangs make a fine ring, if you know how. Bring me four, and I'll show you -- and give you the plans.",
     "done": "Good fangs, sharp ones. The plans are yours -- a jeweler's work, at a jeweler's bench.",
     "need": {"bring": {"wolf_fang": 4}}, "reward": {"bp": ["fang_ring"], "sk": {"smithing": 10}}},
    {"id": "gw_oak", "npc": "foreman_tamsin", "giver": "Foreman Tamsin", "title": "Oak for Genesis",
     "offer": "Genesis needs beams, and my crew is short. Fell ten oaks round the camp and bring me the logs.",
     "done": "Ten good logs. That's a roof for somebody. Take this axe, it's better than the one you've got.",
     "need": {"bring": {"oak_log": 10}}, "reward": {"items": ["copper_axe"], "mats": {"stone_block": 4}, "sk": {"woodcutting": 20}}},
    {"id": "gw_boars", "npc": "farmer_hal", "giver": "Farmer Hal", "title": "Boars in the Fields",
     "offer": "Eight boars, every night, in my fields. Thin them out for me, and you'll have boots fit for mud.",
     "done": "Ha! Maybe I'll get a harvest this year after all. The boots are yours.",
     "need": {"kill": {"boar": 8}}, "reward": {"items": ["leather_boots"], "mats": {"flax": 3}, "sk": {"anatomy": 10}}},
    {"id": "gw_camp", "npc": "sentry_ulf", "giver": "Old Ulf", "title": "The Raiders' Camp",
     "offer": "Every night I light the beacon because of them. Go to their camp south of Blockshire and break it: six raiders.",
     "done": "Six fewer to watch for. You fight well -- better than I did at your age.",
     "need": {"kill": {"camp_raider": 6}}, "reward": {"items": ["iron_helm"], "sk": {"toughness": 15}}},
    {"id": "gw_chief", "npc": "sentry_ulf", "giver": "Old Ulf", "title": "Grimwald", "after": "gw_camp",
     "offer": "Their chief is Grimwald. As long as he lives, they'll keep coming. End it.",
     "done": "Grimwald is gone? Then tonight I'll sleep. Take this ring -- it was my captain's.",
     "need": {"kill": {"raider_chief": 1}}, "reward": {"items": ["iron_ring", "lucky_coin"], "sk": {"toughness": 20}}},
    {"id": "gw_spiders", "npc": "hennick", "giver": "Old Hennick", "title": "Into the Dark",
     "offer": "Travellers vanish near the black trees in the west. There's a cave there, full of spiders. Kill ten, and come tell me what you saw.",
     "done": "A whole nest, under our feet... Here, something for your trouble, and keep your lantern lit.",
     "need": {"kill": {"cave_spider": 10}}, "reward": {"items": ["leather_cap"], "mats": {"wild_herb": 4}, "sk": {"evade": 15}}},
    {"id": "gw_brood", "npc": "hennick", "giver": "Old Hennick", "title": "The Broodmother", "after": "gw_spiders",
     "offer": "Where there are that many, there's a mother. Deep in that cave, past the chasm. Kill her, if you can.",
     "done": "You did it? Then Greenwood owes you more than I can pay. Take this, at least.",
     "need": {"kill": {"broodmother": 1}}, "reward": {"items": ["bone_amulet"], "mats": {"pearl": 2}, "sk": {"toughness": 25}}},
    {"id": "gw_silk", "npc": "merchant_ysolde", "giver": "Ysolde the Merchant", "title": "Silk for the Road",
     "offer": "Spider silk sells well on the coast. Bring me six, and I'll give you the plans for silk gloves.",
     "done": "Beautiful, strong silk. The plans, as promised -- a tailor's work.",
     "need": {"bring": {"spider_silk": 6}}, "reward": {"bp": ["silk_gloves"], "sk": {"tailoring": 10}}},
    # THE FIRST REFINING BLUEPRINTS (2026-11-10): one quest for each craft, from the people who work with the stuff
    {"id": "rf_smith", "npc": "odo", "giver": "Odo the Smith", "title": "Bars and Blades", "after": "smith1",
     "offer": "Ore is only the start. Bring me four lumps of copper ore, and I'll show you how to pour bars -- and what to make of them.",
     "done": "Good ore. Bars, blades, hilts, rivets, buckles: here are the plans. A longknife is the first thing a smith makes from his own parts.",
     "need": {"bring": {"copper_ore": 4}}, "reward": {"bp": ["copper_bar", "copper_blade", "sword_hilt", "rivets", "buckle", "copper_longknife"], "sk": {"smithing": 10}}},
    {"id": "rf_carpenter", "npc": "foreman_tamsin", "giver": "Foreman Tamsin", "title": "Planks and Handles",
     "offer": "A log is no use to a carpenter until it's sawn. Bring me four oak logs and I'll teach you planks, handles and shield boards.",
     "done": "There you are. Saw, plane, and mind the grain -- the plans are yours. Antler makes good buttons, too.",
     "need": {"bring": {"oak_log": 4}}, "reward": {"bp": ["oak_plank", "wooden_handle", "shield_boards", "antler_buttons", "buckler_board"], "sk": {"woodworking": 10}}},
    {"id": "rf_tanner", "npc": "hunter_wynn", "giver": "Wynn the Hunter", "title": "Hides into Leather",
     "offer": "The deer in the glades give the best hides around. Bring me two, and I'll show you how to tan them and cut straps.",
     "done": "Nice and clean. Tanning, straps, and the jerkin I wear myself -- the plans are yours.",
     "need": {"bring": {"deer_hide": 2}}, "reward": {"bp": ["deer_leather", "boar_leather", "leather_strap", "hunters_jerkin"], "sk": {"tailoring": 10}}},
    {"id": "rf_weaver", "npc": "farmer_hal", "giver": "Farmer Hal", "title": "Thread and Cloth",
     "offer": "My wife spins the flax, but she's only two hands. Three bundles of flax and two hare pelts, and you'll have her plans.",
     "done": "She says you'll learn quick. Thread, cloth, fur lining -- and trousers and gloves to make from them.",
     "need": {"bring": {"flax": 3, "hare_pelt": 2}}, "reward": {"bp": ["linen_thread", "linen_cloth", "fur_lining", "furlined_gloves", "linen_trousers"], "sk": {"tailoring": 10}}},
    {"id": "rf_jeweler", "npc": "merchant_ysolde", "giver": "Ysolde the Merchant", "title": "Wire and Settings",
     "offer": "Fine work sells best on the road. Bring me three lumps of copper ore and an antler, and I'll give you a jeweler's first plans.",
     "done": "Wire, settings, clasps, a mould for rings, beads of antler -- and three things to make with them. Copper bars you'll need from a smith.",
     "need": {"bring": {"copper_ore": 3, "antler": 1}}, "reward": {"bp": ["copper_wire", "ring_setting", "clasp", "ring_mold", "antler_beads", "polished_tusk", "antler_pendant", "hares_foot_charm", "copper_band"], "sk": {"jewelcrafting": 10}}},
    {"id": "gw_lists", "npc": "aldric", "giver": "Sir Aldric", "title": "Prove Yourself",
     "offer": "Words are cheap in the lists. Show me what you can do: two goblins from the Goblin Bridgehead in the north.",
     "done": "Not bad at all. The city will have need of fighters like you. Take this shield.",
     "need": {"kill": {"goblin": 2}}, "reward": {"items": ["oak_shield"], "sk": {"toughness": 10}}},
]


#: THE SHY ONES (2026-11-10): deer in Greenwood's glades, hares on the fields -- they never fight, they run (combat's
#: spec.flee: from whoever comes within shy metres, or struck them); hunted for hides, antlers and pelts
SHY_SPECIES = {
    "deer": {"name": "Red Deer", "lvl": 3, "hp": 60, "dmg": 0, "speed": 2.0, "run": 6.2, "flee": True, "shy": 11, "aggressive": False,
             "sight": 0, "def": 0, "model": "deer", "color": "#9a6a40", "loot": [["deer_hide", 0.8], ["antler", 0.45]], "codex": ["anatomy", "dex"]},
    "hind": {"name": "Red Deer Hind", "lvl": 2, "hp": 48, "dmg": 0, "speed": 2.0, "run": 6.4, "flee": True, "shy": 12, "aggressive": False,
             "sight": 0, "def": 0, "model": "deer", "hind": True, "color": "#a8784c", "loot": [["deer_hide", 0.8]], "codex": ["anatomy", "dex"]},
    "hare": {"name": "Brown Hare", "lvl": 1, "hp": 16, "dmg": 0, "speed": 2.4, "run": 6.9, "flee": True, "shy": 7, "aggressive": False,
             "sight": 0, "def": 0, "model": "hare", "color": "#8a6a48", "loot": [["hare_pelt", 0.7], ["hare_foot", 0.15]], "codex": ["anatomy", "dex"]},
}
SHY_AREAS = [
    {"name": "Greenwood Glade", "species": "deer", "center": [60, -165], "r": 45, "count": 3},
    {"name": "Greenwood Glade", "species": "hind", "center": [60, -165], "r": 45, "count": 4},
    {"name": "Stone Circle Glade", "species": "deer", "center": [330, -110], "r": 55, "count": 2},
    {"name": "Stone Circle Glade", "species": "hind", "center": [330, -110], "r": 55, "count": 3},
    {"name": "South Fields", "species": "hare", "center": [110, 145], "r": 45, "count": 6},
    {"name": "Blockshire Meadows", "species": "hare", "center": [215, -40], "r": 45, "count": 4},
    {"name": "Genesis Fields", "species": "hare", "center": [630, 160], "r": 35, "count": 5},
]
for _a in SHY_AREAS:
    _a.update({"respawn": 45, "maxMat": 1})


def make_camp(raider_look):
    cx, cz = CAMP
    out = math.atan2(25 - cz, 0 - cx)                 # the way out: towards the gate
    P = lambda a, r: [round(cx + math.cos(a) * r, 1), round(cz + math.sin(a) * r, 1)]
    face_in = lambda a: round(math.degrees(math.atan2(math.cos(a), math.sin(a))), 1)   # a thing's front (-z) to the middle
    tents = [{"pos": P(out + a, 10.5), "rot": face_in(out + a), "color": c} for a, c in
             ((1.4, "#6a2e24"), (2.2, "#5a4a3a"), (4.0, "#4a3a2e"), (4.8, "#6a2e24"))]
    back = out + math.pi
    props = [{"kind": "crate", "pos": P(back + 0.5, 8)}, {"kind": "crate", "pos": P(back + 0.56, 9)}, {"kind": "barrel", "pos": P(back - 0.5, 9)},
             {"kind": "barrel", "pos": P(back - 0.45, 8.2)}, {"kind": "logpile", "pos": P(out + 0.9, 6), "rot": 30},
             {"kind": "stump", "pos": P(out - 0.9, 5), "axe": True}, {"kind": "cart", "pos": P(out + 0.35, 12), "rot": face_in(out + 0.35)}]
    place = {"id": "raidercamp", "lift": CAMP_Y, "fire": {"pos": [cx, cz]},
             "palisade": {"c": [cx, cz], "r": CAMP_R, "gap": [round(out, 3), 0.75]},
             "tents": tents, "banner": {"pos": P(out - 0.25, 13), "rot": face_in(out)}, "props": props}
    rnd = random.Random(41)
    inside = []
    while len(inside) < 16:
        a, r = rnd.random() * 2 * math.pi, 3 + rnd.random() * 9
        q = P(a, r)
        if all(math.dist(q, t["pos"]) > 2.5 for t in tents) and all(math.dist(q, pr["pos"]) > 1.6 for pr in props): inside.append(q)
    look = dict(raider_look or {})
    species = {
        "camp_raider": {"name": "Raider", "lvl": 6, "hp": 70, "dmg": 8, "speed": 3.0, "aggressive": True, "sight": 9, "def": 1, "model": "human",
                        "look": look, "weapon": "axe", "weaponLook": "#8f9aa6",
                        "loot": [["scrap_iron", 0.4], ["leather_scrap", 0.4], ["torn_cloth", 0.4], ["raider_axe", 0.04], ["lucky_coin", 0.03]],
                        "codex": ["toughness", "evade", "str"]},
        "raider_chief": {"name": "Grimwald the Raider Chief", "lvl": 10, "hp": 420, "dmg": 15, "speed": 3.0, "aggressive": True, "sight": 9, "def": 2,
                         "model": "human", "look": dict(look, scale=1.15, shirt="#3a2a22", hood="#1c1612", gloves="#2a1e14"),
                         "weapon": "axe", "weaponLook": "#c9ced4",
                         "boss": {"adds": {"at": [0.5], "species": "camp_raider", "n": 2, "mat": 1, "home": True}},
                         "loot": [["raider_axe", 0.35], ["lucky_coin", 0.3], ["leather_cap", 0.3], ["iron_ring", 0.2], ["scrap_iron", 1], ["leather_scrap", 1]],
                         "codex": ["toughness", "evade", "str"]},
    }
    areas = [{"name": "Raider Camp", "species": "camp_raider", "center": [cx, cz], "r": CAMP_R, "count": 6, "respawn": 90, "maxMat": 1, "spots": inside},
             {"name": "Raider Chief", "species": "raider_chief", "center": [cx, cz], "r": CAMP_R, "count": 1, "respawn": 300, "mat": 1, "spots": [P(back, 6)]}]
    hoard = {"id": "raider_hoard", "pos": P(back, 13.5), "yaw": round(math.atan2(math.cos(back), math.sin(back)), 4), "every": 20,
             "text": "You break open the raiders' chest.", "empty": "You have emptied it already today.",
             "loot": [["scrap_iron", 1], ["leather_scrap", 1], ["torn_cloth", 0.8], ["copper_ore", 0.6], ["iron_ore", 0.3],
                      ["lucky_coin", 0.1], ["copper_ring", 0.12], ["raider_axe", 0.06]]}
    # the night's raids set out from the camp's opening (combat's spawns)
    spawns = [P(out + d, CAMP_R + 4) for d in (-0.12, 0, 0.12)]
    pad = {"at": [cx, cz], "r": CAMP_R + 4, "y": CAMP_Y, "rim": 12, "landOnly": True}
    return place, species, areas, hoard, spawns, pad


def make_cave():
    import importlib.util
    spec = importlib.util.spec_from_file_location("cavelayout", ROOT / "design" / "spidercave" / "layout.py")
    L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
    chambers = [{"id": cid, "name": name, "c": list(c), "r": list(r), "y": y, "dome": dome} for cid, name, c, r, y, _, dome in L.CHAMBERS]
    tunnels = [{"pts": [list(p) for p in pts], "w": w} for pts, w in L.TUNNELS]
    (cx0, cz0), (cx1, cz1), cy = L.CHASM
    lights = []
    # torches along every tunnel, every 14 m, against one wall and then the other
    for t in tunnels:
        pts, side = t["pts"], 1
        for a, b in zip(pts, pts[1:]):
            n = max(1, int(math.dist(a[:2], b[:2]) // 14))
            for k in range(n):
                f = (k + 0.5) / n
                x, z = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
                L_ = math.dist(a[:2], b[:2]) or 1
                nx, nz = -(b[1] - a[1]) / L_, (b[0] - a[0]) / L_
                off = t["w"] / 2 - 0.9
                lights.append({"p": [round(x + nx * off * side, 1), round(z + nz * off * side, 1)], "col": "#ff9a4a", "i": 1.1, "r": 6})
                side = -side
    for h in chambers:
        rx, rz = h["r"]
        if h["id"] == "C":   # the mushroom cavern: their cold glow, no torches
            for k in range(9):
                a = k * 0.7 + 0.3
                lights.append({"p": [round(h["c"][0] + math.cos(a) * rx * 0.72, 1), round(h["c"][1] + math.sin(a) * rz * 0.72, 1)],
                               "col": "#4fe0d0", "i": 0.9, "r": 7, "h": 0.6, "kind": "mushroom"})
            lights.append({"p": h["c"], "col": "#2a7a8a", "i": 0.5, "r": 22, "h": 6, "kind": "glow"})
            continue
        n = 4 if rx > 20 else 2
        for k in range(n):
            a = k * 2 * math.pi / n + 0.5
            lights.append({"p": [round(h["c"][0] + math.cos(a) * (rx - 1.5), 1), round(h["c"][1] + math.sin(a) * (rz - 1.5), 1)], "col": "#ff9a4a", "i": 1.2, "r": 7})
        if h["id"] == "F":   # the Broodmother's hall: a sickly violet over it all
            lights.append({"p": h["c"], "col": "#8a4ab0", "i": 0.7, "r": 18, "h": 8, "kind": "glow"})
    lights.append({"p": [(cx0 + cx1) / 2, (cz0 + cz1) / 2], "col": "#2a3a6a", "i": 0.6, "r": 14, "h": -20, "kind": "glow"})
    lights.append({"p": list(L.BACK), "col": "#cfe0ff", "i": 0.8, "r": 6, "h": 4, "kind": "glow"})   # the light from above
    ax, az = CAVE_AT
    xs = [h["c"][0] - h["r"][0] for h in chambers] + [p[0] - 4 for t in tunnels for p in t["pts"]]
    xe = [h["c"][0] + h["r"][0] for h in chambers] + [p[0] + 4 for t in tunnels for p in t["pts"]]
    zs = [h["c"][1] - h["r"][1] for h in chambers] + [p[1] - 4 for t in tunnels for p in t["pts"]] + [L.BACK[1] - 3]
    ze = [h["c"][1] + h["r"][1] for h in chambers] + [p[1] + 4 for t in tunnels for p in t["pts"]]
    rect = [math.floor(ax + min(xs)) - 3, math.floor(az + min(zs)) - 3, math.ceil(ax + max(xe)) + 3, math.ceil(az + max(ze)) + 3]
    cave = {"name": "Spider Cave", "at": [ax, az], "y": CAVE_Y, "rect": rect, "chambers": chambers, "tunnels": tunnels,
            "chasm": {"rect": [cx0, cz0, cx1, cz1], "y": cy, "out": [122, 140]},
            "bridge": {"pts": [list(p) for p in L.BRIDGE[0]], "w": L.BRIDGE[1]}, "lights": lights}
    mx, mz = CAVE_MOUTH
    fx, fz = CAVE_FACE
    d = math.dist(CAVE_MOUTH, CAVE_FACE)
    out = [round(mx + (fx - mx) / d * 5, 1), round(mz + (fz - mz) / d * 5, 1)]
    yaw_out = math.atan2(-(fx - mx), -(fz - mz))
    links = [
        {"at": [mx, mz], "r": 1.3, "to": [ax + L.ARRIVE[0], az + L.ARRIVE[1]], "yaw": math.pi,
         "text": "You climb down into the dark. Webs brush your face.", "mouth": {"pos": [mx, mz], "face": [fx, fz]}},
        {"at": [ax + L.BACK[0], az + L.BACK[1]], "r": 1.6, "to": out, "yaw": yaw_out, "text": "You climb back up into the daylight of Greenwood.", "ladder": "Climb up"},
        {"at": [ax + L.EXIT[0], az + L.EXIT[1]], "r": 2.0, "to": out, "yaw": yaw_out, "text": "A long climb, and you are out in Greenwood again.", "ladder": "Way out"},
    ]
    revive = {"at": [ax + 120, az + 90], "spawn": [ax + L.ARRIVE[0], CAVE_Y + 0.1, az + L.ARRIVE[1]], "yaw": math.pi,
              "text": "You wake in the cave's first grotto. Something skitters away in the dark."}
    # who lives where: [area name, species, chamber id or tunnel index, how many, spots, fixed maturity, eggs that hatch]
    # the entrance grotto stays empty: you come down there and wake there, so nothing may wait for you in it
    plan = [("Web Tunnel", "cave_spider", 0, 4, None, None),
            ("Web Tangle", "spiderling", "B", 10, 1, None), ("Web Tangle Hunters", "cave_spider", "B", 3, None, None),
            ("Cocoon Chamber", "cave_spider", "B2", 3, None, None), ("Down to the Cavern", "cave_spider", 2, 2, None, None),
            ("Mushroom Cavern", "cave_spider", "C", 8, None, None), ("Brood Corridor", "cave_spider", 3, 3, None, None),
            ("Egg Chamber", "spiderling", "D1", 6, 0, 13), ("Egg Chamber", "spiderling", "D2", 6, 0, 13), ("Egg Chamber", "spiderling", "D3", 6, 0, 13),
            ("Egg Chamber Guard", "brood_guard", "D2", 1, 1, None), ("Egg Chamber Guard", "brood_guard", "D3", 1, 1, None),
            ("Chasm Watch", "brood_guard", 7, 2, 1, None), ("Brood Hall", "broodmother", "F", 1, 1, None)]
    areas = []
    for k, (name, species, where, n, mat, hatch) in enumerate(plan):
        spots, c, r = cave_spots(L, where, max(n * 2, 8), 900 + k)
        a = {"name": name, "species": species, "center": [ax + c[0], az + c[1]], "r": round(r, 1), "count": n,
             "respawn": 600 if species == "broodmother" else 90 if hatch else 60, "spots": [[ax + q[0], az + q[1]] for q in spots]}
        if species == "broodmother":   # she waits in the middle of her hall
            a["spots"] = [[ax + c[0] + 3, az + c[1]]]
        if mat is not None: a["mat"] = mat
        if hatch: a["hatch"] = hatch
        areas.append(a)
    # eggs: clusters in the egg chambers and round the Broodmother's hall
    eggs = []
    for cid in ("D1", "D2", "D3"):
        spots, *_ = cave_spots(L, cid, 4, hash(cid) % 1000)
        eggs += [{"p": q, "n": 7} for q in spots]
    spots, *_ = cave_spots(L, "F", 6, 77)
    eggs += [{"p": q, "n": 9} for q in spots]
    cave["eggs"] = eggs
    # the hoard behind the Broodmother's hall: each player's once in 20 hours
    gx, gz = next(c[2] for c in L.CHAMBERS if c[0] == "G")
    hoard = {"id": "brood_hoard", "pos": [ax + gx + 2, az + gz], "yaw": round(math.pi / 2, 4), "every": 20,
             "text": "You lift the lid of the Broodmother's hoard.", "empty": "The hoard has nothing more for you today. Come back tomorrow.",
             "loot": [["brood_carapace", 1], ["spider_silk", 1], ["spider_silk", 0.7], ["venom_sac", 1], ["pearl", 0.6],
                      ["broodfang", 0.08], ["venom_ring", 0.12], ["silkweave_mantle", 0.08], ["carapace_shield", 0.06]]}
    return cave, links, revive, areas, hoard


def main() -> None:
    blk, bch, shp = load("blockshire"), load("beach"), load("pirateship")

    # ---- Blockshire: where it was, on its cliff ------------------------------------------------------------------
    LIFT = 14.0
    # no fence any more, and no raids (tbuuol 2026-10-29): the village is open to the Greenwood
    blockshire = {k: blk[k] for k in ("solids", "huts", "fire", "grass", "paths", "props", "resources", "forge", "well", "npcs") if k in blk}
    if blk.get("forest", {}).get("trees"):   # the village's own few trees, placed by hand
        blockshire["forest_trees"] = blk["forest"]["trees"]
    blockshire["lift"] = LIFT
    # the old zone's ground was an invisible slab of 300 x 300 m; lifted with the village it became a floor at 14 m
    # over everything round Blockshire, under the land and above it (2026-10-31: walking on air, invisible steps).
    # The terrain is the ground now.
    blockshire["solids"] = [s for s in blockshire.get("solids", []) if max((s.get("size") or [0])[0], (s.get("size") or [0, 0, 0])[2]) < 60]

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

    # ---- the Pirate Ship: away from Saltwind (tbuuol 2026-10-31: "steht direkt an der Strandsiedlung"), at a dock of
    # its own on the bay's north shore, some 340 m from the village, a path from the road down to it. Laid out as it
    # was at Saltwind (dock from the shore west into the sea, the ship along its north side, the quarterdeck out to
    # sea) and then turned a quarter: the dock runs south into the bay.
    BERTH = Place([-40, -648], turn=90)
    L, B, D, OUT_ = 30, 8, 0.7, 21          # length, beam, deck height; the ship's middle 21 m out along the dock
    AFT = L / 2 - 8
    sxl, szl = -OUT_, round(-1.2 - B / 2 - 0.2, 2)
    dock_l = {"from": [3, 0], "to": [-30, 0], "width": 2.4, "y": 0.35}
    ship_l = dict(shp["ships"][0])
    ship_l.update({"pos": [sxl, szl], "rot": 90, "deck": D, "length": L, "beam": B, "walk": True, "gaps": [[-7, 2, -1]]})
    ship = BERTH.thing(ship_l)
    sx, sz = ship["pos"]
    r = BERTH.rect([sxl - L / 2, szl - B / 2, sxl + L / 2, szl + B / 2])
    deck = {"rect": r, "y": D, "quarter": D + 2.1, "axis": "z", "aftAt": BERTH.xz([sxl - AFT, 0])[1], "aftSign": 1}
    berth = {"lift": 0, "docks": [{k: v for k, v in BERTH.thing(dock_l).items() if k != "rot"}], "ships": [ship]}

    def ship_xz(p):   # a point of the pirate level's ship (its own frame) in the world
        return BERTH.xz([sxl - p[1], szl + p[0]])
    wreck = [dict(s, pos=I(150, 570), rot=200) for s in bch.get("ships", []) if s.get("list")]
    saltwind["ships"] = wreck

    # ---- the creatures: areas shaped to the land, few, some or many (green, yellow, red on the map) ----------------
    sp = {}
    for src in (blk, bch, shp):
        sp.update(src["wild"]["species"])
    if "captain" in sp:
        sp["captain"] = dict(sp["captain"], sight=min(sp["captain"].get("sight", 6), 4))
    goblin_look = {"skin": "#7aa03c", "shirt": "#5c4a2c", "pants": "#3b3020", "hair": "#1e2410", "bandana": "#8a3a22", "boots": "#2a2216"}
    sp["goblin"] = {"name": "Goblin Scout", "lvl": 7, "hp": 82, "dmg": 8, "speed": 3.4, "aggressive": True, "sight": 7, "model": "human",
                    "look": dict(goblin_look, scale=0.66), "weapon": "sword", "weaponLook": "#8f8578",
                    "loot": [["torn_cloth", 0.35], ["scrap_iron", 0.3]], "codex": ["melee", "evade"]}
    sp["goblin_brute"] = {"name": "Goblin Warrior", "lvl": 8, "hp": 108, "dmg": 10, "speed": 3.0, "aggressive": True, "sight": 7, "model": "human",
                          "look": dict(goblin_look, skin="#68902f", shirt="#4a3a22", bandana="#5a2a1a", scale=0.78), "weapon": "sword",
                          "weaponLook": "#a0968a", "loot": [["torn_cloth", 0.3], ["scrap_iron", 0.4]], "codex": ["melee", "toughness"]}

    RATE = {"low": 1 / 6000, "mid": 1 / 2500, "high": 1 / 1000}   # creatures a square metre of dry land
    RESPAWN = {"low": 40, "mid": 30, "high": 20}
    # [name, species, density, shape (metres; x east, z south)]
    SHAPES = [
        # round Blockshire: boars in the open fields, wolves in the wood to the north, spiders deep in the west
        ["Blockshire Meadows", "boar", "low", [[85, -55], [170, -110], [290, -95], [340, 0], [300, 95], [160, 115], [85, 60]]],
        ["South Fields", "boar", "low", [[15, 95], [170, 120], [200, 170], [40, 195], [15, 160]]],   # east of the raiders' camp
        ["Greenwood North", "wolf", "mid", [[-180, -70], [-60, -80], [60, -95], [80, -150], [-60, -165], [-190, -155]]],
        ["Greenwood South-West", "wolf", "mid", [[-420, 110], [-260, 90], [-170, 120], [-200, 190], [-330, 210], [-430, 170]]],
        ["Greenwood Deep", "spider", "high", [[-470, -100], [-330, -160], [-220, -140], [-180, -40], [-240, 60], [-380, 90], [-480, 30]]],
        ["Roadside Woods", "wolf", "low", [[130, -130], [250, -160], [340, -230], [370, -330], [310, -330], [250, -260], [140, -190]]],
        # the beach: crabs along the shores, sirens on the cove's shoal (knee-deep: terrain.js SHOAL), the drowned on the strand
        ["Saltwind Shore", "crab", "mid", [[95, -265], [140, -215], [190, -240], [245, -300], [260, -400], [230, -415], [210, -365], [150, -300]]],
        ["Bay Shore", "crab", "mid", [[-300, -225], [-80, -245], [100, -280], [115, -240], [-80, -185], [-300, -170]]],
        ["North Shore", "crab", "low", [[20, -690], [120, -650], [200, -600], [225, -520], [190, -500], [130, -570], [60, -610], [20, -625]]],
        ["Mermaid Cove", "siren", "mid", [[round(-170 + 52 * math.cos(k * math.pi / 5), 1), round(-622 + 46 * math.sin(k * math.pi / 5), 1)] for k in range(10)]],
        ["Drowned Strand", "drowned", "mid", [[-270, -740], [-150, -725], [-80, -700], [-90, -655], [-160, -668], [-270, -690]]],
        # the Goblin Village's island, its camp, and scouts across the bridge
        ["Goblin Island", "goblin", "mid", [[500, -790], [380, -735], [350, -630], [420, -560], [600, -525], [700, -545], [760, -605], [775, -700], [735, -780], [650, -805]]],
        ["Goblin Camp", "goblin_brute", "high", [[500, -720], [600, -735], [660, -680], [630, -610], [530, -600], [480, -650]]],
        ["Goblin Bridgehead", "goblin", "low", [[380, -500], [470, -470], [520, -430], [470, -390], [380, -420]]],
    ]
    gw_places, gw_pads, gw_nodes = make_greenwood()
    ox_places, ox_pads, ox_nodes = make_outskirts()
    gw_places, gw_pads, gw_nodes = gw_places + ox_places, gw_pads + ox_pads, gw_nodes + ox_nodes
    camp_place, camp_species, camp_areas, camp_hoard, camp_spawns, camp_pad = make_camp(((blk.get("defense") or {}).get("raider") or {}).get("look"))
    land = {"pads": [{"at": [0, 0], "r": 62, "y": LIFT, "rim": 40},
                     {"at": [SW.at[0] + 6, SW.at[1]], "r": 24, "y": 0.25, "rim": 14, "landOnly": True},
                     # Genesis inside its wall, flat for the plots (2026-11-07): an ellipse round the ring
                     {"at": [GEN[0], GEN[1]], "rx": 270, "rz": 190, "y": GEN_Y, "rim": 45, "landOnly": True}, camp_pad] + gw_pads,
            "decks": [deck]}
    areas = []
    for name, species, dens, poly in SHAPES:
        x0, z0, x1, z1 = box(poly)
        pts = [[x0 + (i + 0.5) * (x1 - x0) / 24, z0 + (j + 0.5) * (z1 - z0) / 24] for i in range(24) for j in range(24)]
        pts = [q for q in pts if inside(poly, *q)]
        res = probe(land, pts)
        swims = sp[species].get("swim")
        ok = [q for q, r in zip(pts, res) if swims or r[0] > -0.35]
        cell = (x1 - x0) * (z1 - z0) / 576
        n = max(2, min(18, round(len(ok) * cell * RATE[dens])))
        home = min(ok, key=lambda q: math.hypot(q[0] - sum(p[0] for p in poly) / len(poly), q[1] - sum(p[1] for p in poly) / len(poly)))
        # the first fields a new player walks into have young ones only; elsewhere where few live, no old or elder ones
        cap = 0 if name in ("Blockshire Meadows", "South Fields") else 1 if dens == "low" else None
        areas.append({"name": name, "species": species, "density": dens, "poly": poly, **({"maxMat": cap} if cap is not None else {}), "center": [round(home[0], 1), round(home[1], 1)],
                      "count": n, "respawn": RESPAWN[dens], "_dry": round(len(ok) / max(1, len(pts)), 2), "_m2": round(len(ok) * cell)})
    for a in shp["wild"]["areas"]:   # the crew, where they stood on their ship
        areas.append(dict(a, center=ship_xz(a["center"]), respawn=shp["wild"].get("respawn", 120)))
    cave, cave_links, cave_revive, cave_areas, cave_hoard = make_cave()
    sp.update(camp_species)
    areas.extend(camp_areas)
    sp.update(SHY_SPECIES)
    areas.extend(SHY_AREAS)
    sp.update(CAVE_SPECIES)
    areas.extend(cave_areas)
    wild = {"zone": "Greenwood", "from": 28, "respawn": 25, "waterY": bch["wild"].get("waterY", -0.75), "species": sp, "areas": areas}

    # ---- things to gather out in the land (tbuuol 2026-10-31: "mehr sammelbare Rohstoffe verteilen"): oaks in the
    # wood, ore boulders on the slopes and the shore's rocks, herbs in the open; never on a road, in the river or the
    # villages, 12 m apart at least. The same every time (a fixed seed).
    rnd = random.Random(31)
    REGIONS = [   # [shape, {kind: how many}]
        [[[-500, -120], [-200, -200], [60, -215], [120, -260], [300, -300], [340, -120], [360, 120], [200, 190], [-150, 200], [-480, 150]],
         {"tree": 30, "rock": 16, "herb": 30}],
        [[[110, -270], [250, -330], [250, -420], [200, -420], [140, -340]], {"rock": 4, "herb": 4}],
        [[[-300, -215], [100, -275], [110, -240], [-300, -170]], {"rock": 4, "herb": 4}],
        [[[-260, -700], [0, -660], [200, -560], [215, -500], [100, -590], [-260, -660]], {"rock": 6, "herb": 6}],
        [[[500, -790], [380, -735], [350, -630], [420, -560], [600, -525], [700, -545], [760, -605], [775, -700], [735, -780], [650, -805]],
         {"tree": 10, "rock": 10, "herb": 8}],
        # for building Genesis (2026-11-07): a quarry by the road west of the gate, and oaks south of the road
        [[[430, -150], [545, -150], [545, -70], [430, -70]], {"stone": 14}],
        [[[420, 40], [545, 40], [545, 140], [420, 140]], {"tree": 12}],
    ]
    KEEP_OFF = [[0, 0, 85], [SW.at[0], SW.at[1], 50], [sx, sz, 25]]
    nodes = []
    for poly, want in REGIONS:
        x0, z0, x1, z1 = box(poly)
        cand = []
        while len(cand) < 900:
            q = [round(rnd.uniform(x0, x1), 1), round(rnd.uniform(z0, z1), 1)]
            if inside(poly, *q) and not any(math.hypot(q[0] - k[0], q[1] - k[1]) < k[2] for k in KEEP_OFF):
                cand.append(q)
        res = probe(land, cand)
        for kind, n in want.items():
            got = 0
            for q, (h, coast, river, road, slope) in zip(cand, res):
                if got >= n:
                    break
                if h < 0.5 or road > 0.02 or river < 6 or coast < (2 if kind in ("rock", "stone") else 6):
                    continue
                if slope > (0.8 if kind in ("rock", "stone") else 0.45) or (kind == "tree" and coast < 25):
                    continue
                if any(math.hypot(q[0] - m["pos"][0], q[1] - m["pos"][1]) < 12 for m in nodes):
                    continue
                got += 1
                nodes.append({"id": f"w.{kind}.{len(nodes) + 1}", "kind": kind, "pos": q, "ground": True})
    wilds = {"lift": 0, "resources": {"nodes": nodes + gw_nodes}}

    # ---- Genesis: a city wall round the ground players will build on (tbuuol 2026-10-31), so its place and size can
    # be seen already; the gate stands where the road comes through (art.cityWall finds it)
    gx, gz = 790, -40
    ring = []
    for k in range(16):
        t = k / 16 * 2 * math.pi
        rr = 1 + 0.07 * math.sin(3 * t + 1) + 0.05 * math.cos(5 * t)
        ring.append([gx + 235 * rr * math.cos(t), gz + 175 * rr * math.sin(t)])
    for _ in range(12):   # off the sea and the river: a vertex too close is pulled in
        res = probe(land, ring)
        moved = False
        for i, (h, coast, river, road, slope) in enumerate(res):
            if coast < 30 or river < 25 or h < 1:
                ring[i] = [gx + (ring[i][0] - gx) * 0.94, gz + (ring[i][1] - gz) * 0.94]
                moved = True
        if not moved:
            break
    land["caves"] = [cave]
    land["walls"] = [{"name": "Genesis", "pts": [[round(x, 1), round(z, 1)] for x, z in ring], "h": 7, "th": 2.4, "gate": 9,
                      # gates where no road comes through (the plan's north and east gates, 2026-11-10); the west one is the road's
                      "gates": [list(v) for k, v in json.loads(PLAN.read_text())["gates"].items() if k != "west"]}]
    genesis = make_genesis(land["walls"][0]["pts"])

    quests, seen = [], set()
    for src in (blk, bch, shp):
        for q in src.get("quests", []):
            if q["id"] not in seen:
                seen.add(q["id"])
                quests.append(q)
    # THE SMITH'S BLUEPRINTS (tbuuol 2026-11-08): recipes are things now; the first ones come from Odo at the forge, as
    # the rewards of three errands. Elder Bram's "make a weapon" waits for the first of them.
    odo = {"id": "odo", "name": "Odo the Smith", "pos": [17.6, 5.4], "lookAt": [15.2, 3.6], "talkTurn": True,
           "look": {"person": "a", "skin": "#c98b62", "shirt": "#4a3a2a", "pants": "#2a2620", "hair": "#2a1a10", "beard": "#3a2a1a", "gloves": "#3a2a1a"},
           "lines": ["Steel wants a steady hand and a good plan. The plans I have; the hands are yours.",
                     "A blueprint gets better the more you work from it. Mine are worn smooth."]}
    blockshire.setdefault("npcs", []).append(odo)
    quests += [
        {"id": "smith1", "npc": "odo", "giver": "Odo the Smith", "title": "First Blueprints",
         "offer": "You want to make things? Bring me three lumps of copper ore from the boulders out in the hills, and I will give you my first blueprints: a sword, an axe and bracers.",
         "done": "Good ore. Here are the plans. Use them at the forge; they get better every time you do.",
         "need": {"bring": {"copper_ore": 3}}, "reward": {"bp": ["copper_sword", "copper_axe", "copper_bracers"], "sk": {"smithing": 10}}},
        {"id": "smith2", "npc": "odo", "giver": "Odo the Smith", "title": "Wood and Hide", "after": "smith1",
         "offer": "Not everything is iron. Three oak logs and a scrap of leather, and you shall have my woodwork: a shield, a charm and a tusk amulet.",
         "done": "That will do. These are the plans; the wood is yours to work.",
         "need": {"bring": {"oak_log": 3, "leather_scrap": 1}}, "reward": {"bp": ["oak_shield", "oak_belt_charm", "tusk_amulet"], "sk": {"woodworking": 10}}},
        {"id": "smith3", "npc": "odo", "giver": "Odo the Smith", "title": "Cloth and Shell", "after": "smith2",
         "offer": "Last of what I have: two bundles of flax and two crab shells from the shore, and the plans for a tunic, a belt, a jerkin, a shell shield and a coral ring are yours.",
         "done": "That is all I can teach from paper. The rest you will find yourself, or buy.",
         "need": {"bring": {"flax": 2, "crab_shell": 2}}, "reward": {"bp": ["flax_tunic", "leather_belt", "hide_jerkin", "shell_shield", "coral_ring"], "sk": {"tailoring": 10}}},
    ]
    for q in quests:
        if q["id"] == "forge":
            q["after"] = "smith1"

    # where things are now (2026-10-31): the quests told of the old fence, raiders at the gate, a ship out past
    # Saltwind's dock
    WHERE = {
        "boars": "The stew wants meat. Four boars roam the meadows east and south of the village. Bring them down, and I will stitch you a jerkin from the hides.",
        "forge": "The wilds grow bolder every night. Go to the forge east of the square and make a weapon with your own hands.",
        "wolves": "I heard wolves howling in the Greenwood north of the village! Three of them! Can you make them stop? Please?",
        "spiders": "West of the village, deep in the Greenwood, the forest grows dark. Spiders nest there and take our herb gatherers. Kill three and bring peace back.",
        "crabs": "Six shore crabs, that's all I need. South along the sand from here, where the shore bends towards Blockshire. They pinch, so mind your fingers.",
        "sirens": "Sirens sing on the shoal off the north strand, knee-deep in the cove, and our fishermen walk into the sea. Silence four of them before we lose another boat.",
        "drowned": "My old crew lies on the north strand, west of the black ship's dock. Something won't let them rest. Put four of them back in the sand, will you?",
        "captain": "That ship at the old dock on the north shore flies black sails. Captain Blackgill raids our boats every week. Take the shore path with friends, board her and end him.",
    }
    for q in quests:
        if q["id"] in WHERE:
            q["offer"] = WHERE[q["id"]]

    def zone(name, a, b):
        (x0, z0), (x1, z1) = I(*a), I(*b)
        return {"name": name, "rect": [min(x0, x1), min(z0, z1), max(x0, x1), max(z0, z1)]}
    zones = [
        {"name": "Spider Cave", "rect": cave["rect"]},
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
        "land": land,
        "places": [blockshire, saltwind, berth, wilds, genesis, camp_place] + gw_places,
        "resources": {k: v for k, v in (blk.get("resources") or {}).items() if k != "nodes"},   # how often, how much: the wilds' too
        # the guards and the priest; the raiders come by night only (tbuuol 2026-11-10)
        "defense": dict(blk.get("defense") or {}, spawns=dict((blk.get("defense") or {}).get("spawns") or {}, night=True, points=camp_spawns)),
        "wild": wild, "quests": quests + GREENWOOD_QUESTS, "zones": zones,
        "links": cave_links,
        "hoards": [cave_hoard, camp_hoard],
        "revives": [
            cave_revive,
            {"at": [0, 0], "spawn": spawn, "yaw": blk.get("spawnYaw", 0)},
            {"at": SW.at, "spawn": SW.p3(bch["spawn"]), "yaw": 0, "text": bch.get("revive")},
            {"at": [sx, sz], "spawn": BERTH.p3([16, 0.6, 0]), "yaw": math.pi, "text": "You wake on the pirates' dock, soaked. The sea spat you back."},
        ],
    }
    OUT.write_text(json.dumps({"lwq": "module", "name": "level.world", "api": 1, "v": VERSION, "data": world}, indent=1,
                              ensure_ascii=False) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB, {len(areas)} areas ({sum(a['count'] for a in areas)} creatures), "
          f"{len(nodes)} things to gather, {len(quests)} quests, ship at {sx},{sz}")
    for a in areas:
        if a.get("density"):
            print(f"  {a['name']:22} {a['species']:13} {a['density']:5} {a['count']:3}  dry {a.pop('_dry')}  {a.pop('_m2')} m2")


if __name__ == "__main__":
    main()
