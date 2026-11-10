#!/usr/bin/env python3
"""Genesis city plan, second take (tbuuol 2026-11-10: "die Aufteilung der Plots ist nicht wirklich optimal, da ist auch
noch jede Menge Platz"). The whole of the ground inside the wall is used: streets every ~60 m, plots on both sides of
every street, houses in three sizes (bigger the farther from the market), shops round the plaza and along the gate
avenue, workshops in the east, estates in the band along the wall, three gates (west, north, east), a tavern, a
temple, stables and a small square with a well in each quarter.

    node design/genesis/gen_dump.cjs > /tmp/dump.json
    tools/.venv/bin/python design/genesis/plan2.py /tmp/dump.json   -> design/genesis/plan2.json + genesis-plan2.png

Nothing in the game changes until the plan is accepted (then make_world.py reads plan2.json instead of plots.json)."""
import json, math, pathlib, sys
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
d = json.loads(pathlib.Path(sys.argv[1]).read_text())
WALL = d["wall"]["pts"]
CX, CZ = 790, -40
PLAZA_R, FOUNTAIN_R = 34, 6


def inside(x, z, P=WALL):
    c = False
    for i in range(len(P)):
        (x1, z1), (x2, z2) = P[i], P[i - 1]
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            c = not c
    return c


def wall_dist(x, z):
    best = 1e9
    for i in range(len(WALL)):
        (x1, z1), (x2, z2) = WALL[i], WALL[i - 1]
        dx, dz = x2 - x1, z2 - z1
        t = max(0, min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)))
        best = min(best, math.hypot(x - x1 - t * dx, z - z1 - t * dz))
    return best


def wall_at(x0, z0, x1, z1):
    """Where a straight street from (x0, z0) towards (x1, z1) meets the wall: its gate."""
    for k in range(400):
        t = k / 400
        x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
        if not inside(x, z):
            return (round(x, 1), round(z, 1))
    return (x1, z1)


# --- gates and streets. THE BLOCKS (third take): the lanes lie so that between two of them there is room for exactly
# two rows of plots back to back (2 x 20 m deep, 16 m wide), each row on its own street; the gaps are whole plots.
GATES = {"west": wall_at(CX, CZ, 400, CZ), "north": wall_at(CX, CZ, CX, -400), "east": wall_at(CX, CZ, 1300, CZ)}
EW_LINES = [(-187, 7), (-140, 7), (-93, 7), (CZ, 12), (13, 7), (60, 7), (107, 7)]          # [z, width]
NS_LINES = [(645.5, 7), (716.5, 7), (CX, 12), (863.5, 7), (934.5, 7), (1005.5, 7)]          # [x, width]
STREETS = [("Torstraße", GATES["west"][0], CZ, CX - PLAZA_R, CZ, 12), ("Oststraße", CX + PLAZA_R, CZ, GATES["east"][0], CZ, 12),
           ("Nordstraße", CX, GATES["north"][1], CX, CZ - PLAZA_R, 12), ("Südstraße", CX, CZ + PLAZA_R, CX, 98, 10)]
for z, w in EW_LINES:
    if z != CZ:
        STREETS.append(("", 540, z, 1080, z, w))
for x, w in NS_LINES:
    if x != CX:
        STREETS.append(("", x, -260, x, 160, w))


def street_boxes(m=0):
    out = []
    for _, a, b, c, e, w in STREETS:
        out.append((min(a, c) - (w / 2 if a == c else 0) - m, min(b, e) - (w / 2 if b == e else 0) - m,
                    max(a, c) + (w / 2 if a == c else 0) + m, max(b, e) + (w / 2 if b == e else 0) + m))
    return out


SB = street_boxes(0)


def hits(r, boxes):
    return any(r[2] > q[0] + 1e-6 and r[0] < q[2] - 1e-6 and r[3] > q[1] + 1e-6 and r[1] < q[3] - 1e-6 for q in boxes)


def rect_at(cx, cz, w, h):
    return [cx - w / 2, cz - h / 2, cx + w / 2, cz + h / 2]


BUILDINGS = [
    {"id": "townhall", "name": "Rathaus", "what": "Grundstücke kaufen", "rect": [CX - 50, CZ - PLAZA_R - 36, CX - 8, CZ - PLAZA_R - 4]},
    {"id": "guild", "name": "Abenteurergilde", "what": "Aufträge", "rect": [CX + 8, CZ - PLAZA_R - 36, CX + 50, CZ - PLAZA_R - 4]},
    {"id": "tavern", "name": "Gasthaus", "what": "Rast, Gerüchte", "rect": rect_at(GATES["west"][0] + 34, CZ - 20, 26, 20)},
    {"id": "temple", "name": "Tempel", "what": "Heiler, Segen", "rect": rect_at(CX, 112, 34, 22)},
    {"id": "stables", "name": "Ställe", "what": "Reittiere (später)", "rect": rect_at(GATES["east"][0] - 30, CZ + 20, 30, 20)},
]
SQUARES = [("Nordwest", (681, -116.5), 12), ("Nordost", (899, -116.5), 12), ("Südwest", (681, 36.5), 12), ("Südost", (899, 36.5), 12)]
TAKEN = [b["rect"] for b in BUILDINGS] + [[x - h, z - h, x + h, z + h] for _, (x, z), h in SQUARES]


def free(r, plots, margin=5):
    for x, z in ((r[0], r[1]), (r[2], r[1]), (r[0], r[3]), (r[2], r[3]), ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)):
        if not inside(x, z) or wall_dist(x, z) < margin:
            return False
    if hits(r, SB) or hits(r, [[q[0] - 1, q[1] - 1, q[2] + 1, q[3] + 1] for q in TAKEN]) or hits(r, [p["rect"] for p in plots]):
        return False
    nx, nz = max(r[0], min(CX, r[2])), max(r[1], min(CZ, r[3]))
    return math.hypot(nx - CX, nz - CZ) > PLAZA_R + 4


# --- what a plot is: [width along its street, depth]; houses share the depth, so every row fills its half of a block
SIZES = {"shop": (12, 20), "house_s": (12, 20), "house_m": (16, 20), "house_l": (24, 20), "workshop": (24, 20), "estate": (32, 40)}
CODE = {"shop": ("L", "Laden"), "house_s": ("W", "Haus klein"), "house_m": ("W", "Haus mittel"), "house_l": ("W", "Haus groß"),
        "workshop": ("H", "Werkstatt"), "estate": ("A", "Anwesen")}


def kind_at(x, z):
    r = math.hypot(x - CX, z - CZ)
    if abs(z - CZ) < 60 and x < CX and r < 190:
        return "shop"                                 # the market: round the plaza and along the gate avenue
    if r < 80:
        return "shop"
    if x > 870 and abs(z - CZ) < 110:
        return "workshop"                             # the workshops: in the east, by the east gate and the stables
    if wall_dist(x, z) < 42:
        return "estate"                               # the band along the wall: estates, a whole block deep
    if r < 120:
        return "house_s"
    if r < 165:
        return "house_m"
    return "house_l"


plots = []
# the blocks: between neighbouring lanes (and the wall beyond the last ones)
zs = [-235] + [v for z, w in EW_LINES for v in (z - w / 2, z + w / 2)] + [135]
xs = [560] + [v for x, w in NS_LINES for v in (x - w / 2, x + w / 2)] + [1060]
blocks = [(xs[i], zs[j], xs[i + 1], zs[j + 1]) for i in range(0, len(xs) - 1, 2) for j in range(0, len(zs) - 1, 2)]
for x0, z0, x1, z1 in blocks:
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    for zrow, (ra, rb) in enumerate(((z0, z0 + 20), (z1 - 20, z1))):   # the row on the north street, the row on the south one
        x = x0
        while x < x1 - 11:
            kind = kind_at(x + 8, (ra + rb) / 2)
            order = [kind] + [k for k in ("house_m", "house_s") if k != kind] if kind != "shop" else ["shop"]
            done = False
            for k in order:
                w, dep = SIZES[k]
                if k == "estate":
                    if zrow == 1 or z1 - z0 < 36:
                        continue
                    r = [x, z0, x + w, z0 + min(dep, z1 - z0)]
                else:
                    r = [x, ra, x + w, rb]
                if r[2] <= x1 + 1e-6 and free([round(v, 1) for v in r], plots):
                    plots.append({"kind": k, "rect": [round(v, 1) for v in r]}); x += w; done = True; break
            if not done:
                x += 2
# what is left by the wall: small houses wherever one fits with a street along a side (either way round)
def by_street(r):
    return hits([r[0] - 1.5, r[1] - 1.5, r[2] + 1.5, r[3] + 1.5], SB)
for z in range(-236, 136, 2):
    for x in range(562, 1060, 2):
        for w, dep, k in ((16, 20, "house_m"), (20, 16, "house_m"), (12, 20, "house_s"), (20, 12, "house_s")):
            r = [x, z, x + w, z + dep]
            if by_street(r) and free(r, plots, 4):
                plots.append({"kind": k, "rect": r}); break

count = {}
for p in plots:
    k = CODE[p["kind"]][0]
    count[k] = count.get(k, 0) + 1
    p["id"] = f"{k}{count[k]}"
    p["size"] = SIZES[p["kind"]]
# PLOTS ALREADY BOUGHT keep their number: the new plot that lies most over an owned old one takes its id (a deed names
# its plot by id), and the plot that had that id takes the new one's (2026-11-10: @banana's W64 in the beta)
OWNED = ["W64"]
old = {q["id"]: q for q in json.loads((HERE / "plots.json").read_text())["plots"]}
area = lambda a, b: max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
for oid in OWNED:
    if oid not in old:
        continue
    best = max(plots, key=lambda q: area(q["rect"], old[oid]["rect"]))
    if area(best["rect"], old[oid]["rect"]) <= 0 or best["id"] == oid:
        continue
    if oid[0] == "W" and best["kind"] in ("shop", "workshop"):   # a house it was: a house it stays
        best["kind"] = "house_s" if best["rect"][2] - best["rect"][0] <= 12 else "house_m"
        best["size"] = SIZES[best["kind"]]
    holder = next((q for q in plots if q["id"] == oid), None)
    if holder:
        holder["id"] = best["id"]
    best["id"] = oid

# --- the drawing: 2 px a metre
X0, X1, Z0, Z1 = 540, 1080, -250, 160
S, PAD, LEG = 2, 30, 360
img = Image.new("RGB", (int((X1 - X0) * S) + 2 * PAD + LEG, int((Z1 - Z0) * S) + 2 * PAD + 40), "#f4efe3")
dr = ImageDraw.Draw(img)
P = lambda x, z: (PAD + (x - X0) * S, PAD + 40 + (z - Z0) * S)
F = lambda n, b=False: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans" + ("-Bold" if b else "") + ".ttf", n)
g, st, gx0, gz0 = d["grid"], d["st"], d["X0"], d["Z0"]
for j, rw in enumerate(g):
    for i, c in enumerate(rw):
        x, z = gx0 + i * st, gz0 + j * st
        if not (X0 <= x < X1 and Z0 <= z < Z1):
            continue
        h, coast, river = c[0], c[3], c[4]
        col = (150, 190, 215) if coast < 0 or river < 0 else (222, 210, 178) if inside(x, z) else (160, 186, 132)
        a, b = P(x, z)
        dr.rectangle([a, b, a + st * S, b + st * S], fill=col)
layer = img.copy(); ldr = ImageDraw.Draw(layer)
for q in street_boxes():
    ldr.rectangle([P(q[0], q[1]), P(q[2], q[3])], fill="#cdbb98")
mask = Image.new("L", img.size, 0)
ImageDraw.Draw(mask).polygon([P(x, z) for x, z in WALL], fill=255)
img.paste(layer, (0, 0), mask); dr = ImageDraw.Draw(img)
dr.ellipse([P(CX - PLAZA_R, CZ - PLAZA_R), P(CX + PLAZA_R, CZ + PLAZA_R)], fill="#e2d5b8", outline="#9c8a66", width=2)
for rr, col in ((FOUNTAIN_R + 2, "#8e8a80"), (FOUNTAIN_R, "#7fb6d6"), (2, "#cfe7f3")):
    dr.ellipse([P(CX - rr, CZ - rr), P(CX + rr, CZ + rr)], fill=col)
for name, (x, z), h in SQUARES:
    dr.rectangle([P(x - h, z - h), P(x + h, z + h)], fill="#b9cf9a", outline="#6a8a4a", width=2)
    dr.ellipse([P(x - 2, z - 2), P(x + 2, z + 2)], fill="#7fb6d6")
COL = {"shop": ("#f0b65a", "#a8701c"), "house_s": ("#c4def2", "#3d6f96"), "house_m": ("#9cc7e8", "#3d6f96"),
       "house_l": ("#6ea6d6", "#2a5a80"), "workshop": ("#d79a8a", "#8a4232"), "estate": ("#b49ad8", "#5a3a8a")}
for p in plots:
    fill, line = COL[p["kind"]]
    dr.rectangle([P(p["rect"][0], p["rect"][1]), P(p["rect"][2], p["rect"][3])], fill=fill, outline=line, width=1)
    cx, cz = P((p["rect"][0] + p["rect"][2]) / 2, (p["rect"][1] + p["rect"][3]) / 2)
    dr.text((cx, cz), p["id"], fill="#1c1c1c", font=F(8), anchor="mm")
for b in BUILDINGS:
    dr.rectangle([P(b["rect"][0], b["rect"][1]), P(b["rect"][2], b["rect"][3])], fill="#8d6a4a", outline="#3a2a1a", width=3)
    cx, cz = P((b["rect"][0] + b["rect"][2]) / 2, (b["rect"][1] + b["rect"][3]) / 2)
    dr.multiline_text((cx, cz), b["name"].replace("Abenteurergilde", "Abenteurer-\ngilde"), fill="#fff6e6", font=F(11, True), anchor="mm", align="center")
dr.line([P(x, z) for x, z in WALL] + [P(*WALL[0])], fill="#5a5048", width=7, joint="curve")
for name, (x, z) in GATES.items():
    q = P(x, z); dr.rectangle([q[0] - 10, q[1] - 10, q[0] + 10, q[1] + 10], fill="#3a2a1a")
    dr.text((q[0], q[1] - 18), {"west": "Westtor", "north": "Nordtor (neu)", "east": "Osttor (neu)"}[name], fill="#3a2a1a", font=F(12, True), anchor="mb")
dr.text((PAD, 12), "Genesis – neuer Stadtplan (Entwurf)", fill="#1c1c1c", font=F(22, True))
lx, ly = int((X1 - X0) * S) + 2 * PAD + 10, PAD + 50
dr.text((lx, ly), "Legende", fill="#1c1c1c", font=F(16, True)); ly += 30
names = {k: f"{CODE[k][1]} {SIZES[k][0]} × {SIZES[k][1]}" for k in SIZES}
by = {}
for p in plots:
    by[p["kind"]] = by.get(p["kind"], 0) + 1
for k in ("shop", "house_s", "house_m", "house_l", "workshop", "estate"):
    fill, line = COL[k]
    dr.rectangle([lx, ly, lx + 22, ly + 16], fill=fill, outline=line)
    dr.text((lx + 30, ly), f"{names[k]}  ·  {by.get(k, 0)}", fill="#2a2a2a", font=F(12)); ly += 24
dr.rectangle([lx, ly, lx + 22, ly + 16], fill="#8d6a4a"); dr.text((lx + 30, ly), "Öffentliche Gebäude", fill="#2a2a2a", font=F(12)); ly += 24
dr.rectangle([lx, ly, lx + 22, ly + 16], fill="#b9cf9a"); dr.text((lx + 30, ly), "Platz mit Brunnen", fill="#2a2a2a", font=F(12)); ly += 34
for line in [f"Insgesamt {len(plots)} Grundstücke (bisher 167).", "", "Häuser werden größer, je weiter", "sie vom Markt weg liegen.",
             "Läden am Marktplatz und an der", "Torstraße, Werkstätten im Osten,", "Anwesen am Rand entlang der Mauer.",
             "", "Neu: Nordtor, Osttor, Gasthaus,", "Tempel, Ställe, vier Plätze.", "", "Nachbarn teilen eine Kante: zwei",
             "eigene Grundstücke nebeneinander", "lassen sich weiter zusammen bebauen."]:
    dr.text((lx, ly), line, fill="#2a2a2a", font=F(12)); ly += 18
img.save(HERE / "genesis-plan2.png")
(HERE / "plan2.json").write_text(json.dumps({"centre": [CX, CZ], "plaza_r": PLAZA_R, "fountain_r": FOUNTAIN_R, "gates": GATES,
    "streets": STREETS, "buildings": BUILDINGS, "squares": SQUARES, "plots": plots}, ensure_ascii=False, indent=1))
print(len(plots), "plots", by)
