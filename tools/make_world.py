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
VERSION = 6


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
PLAN = ROOT / "design" / "genesis" / "plots.json"


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
    }
    for b in plan["buildings"]:
        x0, z0, x1, z1 = b["rect"]
        hx, hz = (x0 + x1) / 2, z1 - 12   # 22 m deep, its door on the plaza side (south)
        nid, name, sign, banner, look, lines = KEEPER[b["id"]]
        halls.append({"id": b["id"], "pos": [round(hx, 1), round(hz, 1)], "size": [round(x1 - x0 - 8, 1), 22], "rot": 180, "sign": sign, "banner": banner})
        npcs.append({"id": nid, "name": name, "pos": [round(hx, 1), round(hz - 9, 1)], "lookAt": [round(hx, 1), round(hz + 11, 1)], "talkTurn": True, "look": look, "lines": lines})
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
    plots = [{"id": p["id"], "kind": p["kind"], "rect": p["rect"]} for p in plan["plots"]]
    return {"id": "genesis", "lift": GEN_Y, "paths": {"paved": True, "circles": [[cx, cz, plan["plaza_r"]]], "strips": strips},
            "fountain": {"pos": [cx, cz], "r": plan["fountain_r"]}, "halls": halls, "npcs": npcs, "props": props, "plots": plots}


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
        ["South Fields", "boar", "low", [[-150, 85], [0, 95], [170, 120], [200, 170], [40, 195], [-170, 175]]],
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
    land = {"pads": [{"at": [0, 0], "r": 62, "y": LIFT, "rim": 40},
                     {"at": [SW.at[0] + 6, SW.at[1]], "r": 24, "y": 0.25, "rim": 14, "landOnly": True},
                     # Genesis inside its wall, flat for the plots (2026-11-07): an ellipse round the ring
                     {"at": [GEN[0], GEN[1]], "rx": 270, "rz": 190, "y": GEN_Y, "rim": 45, "landOnly": True}],
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
                if h < 0.5 or road > 0.02 or river < 6 or coast < (2 if kind == "rock" else 6):
                    continue
                if slope > (0.8 if kind == "rock" else 0.45) or (kind == "tree" and coast < 25):
                    continue
                if any(math.hypot(q[0] - m["pos"][0], q[1] - m["pos"][1]) < 12 for m in nodes):
                    continue
                got += 1
                nodes.append({"id": f"w.{kind}.{len(nodes) + 1}", "kind": kind, "pos": q, "ground": True})
    wilds = {"lift": 0, "resources": {"nodes": nodes}}

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
    land["walls"] = [{"name": "Genesis", "pts": [[round(x, 1), round(z, 1)] for x, z in ring], "h": 7, "th": 2.4, "gate": 9}]
    genesis = make_genesis(land["walls"][0]["pts"])

    quests, seen = [], set()
    for src in (blk, bch, shp):
        for q in src.get("quests", []):
            if q["id"] not in seen:
                seen.add(q["id"])
                quests.append(q)

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
        "places": [blockshire, saltwind, berth, wilds, genesis],
        "resources": {k: v for k, v in (blk.get("resources") or {}).items() if k != "nodes"},   # how often, how much: the wilds' too
        "defense": {k: v for k, v in (blk.get("defense") or {}).items() if k != "spawns"},   # the guards and the priest; no raider waves
        "wild": wild, "quests": quests, "zones": zones,
        "revives": [
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
