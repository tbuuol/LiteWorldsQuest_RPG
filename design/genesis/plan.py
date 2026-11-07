#!/usr/bin/env python3
"""Genesis city plan (tbuuol 2026-11-07): the plaza with its fountain, the town hall, the adventurers' guild, streets
and the predefined plots (houses, workshops, shops), laid out inside the city wall of world.json.

    tools/.venv/bin/python design/genesis/plan.py <terrain dump json>   -> design/genesis/plots.json + genesis-plan.png

The dump (heights, roads, the wall) comes from the game's own terrain module (see gen_dump.cjs beside this file).
Plots are rectangles on one grid along the streets, so two neighbours share an edge and can be built over as one."""
import json, math, pathlib, sys
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
d = json.loads(pathlib.Path(sys.argv[1]).read_text())
WALL = d["wall"]["pts"]
CX, CZ = 790, -40                 # the plaza's centre, the middle of the ring
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

# --- streets: the avenue from the west gate to the plaza and on east, one north-south street through the plaza, and
# two side streets each way. [x0, z0, x1, z1, width]
GATE = (578, -38)
STREETS = [
    ("Torstraße", 560, -40, CX - PLAZA_R, -40, 12),            # the avenue: gate -> plaza
    ("Oststraße", CX + PLAZA_R, -40, 1060, -40, 10),
    ("Nordstraße", CX, -240, CX, -40 - PLAZA_R, 10),
    ("Südstraße", CX, -40 + PLAZA_R, CX, 140, 10),
    ("", 560, -128, 1060, -128, 7), ("", 560, 48, 1060, 48, 7),  # side streets east-west
    ("", 682, -240, 682, 140, 7), ("", 898, -240, 898, 140, 7),  # side streets north-south
]

def on_street(x0, z0, x1, z1, m=0):
    for _, a, b, c, e, w in STREETS:
        lo_x, hi_x, lo_z, hi_z = min(a, c) - w / 2 - m, max(a, c) + w / 2 + m, min(b, e) - w / 2 - m, max(b, e) + w / 2 + m
        if x1 > lo_x and x0 < hi_x and z1 > lo_z and z0 < hi_z:
            return True
    return False

# --- the two buildings at the plaza's north side, the town hall to the west of the north street, the guild east
BUILDINGS = [
    {"id": "townhall", "name": "Rathaus", "what": "zentrale Verwaltung: Grundstücke kaufen", "rect": [CX - 50, -40 - PLAZA_R - 36, CX - 8, -40 - PLAZA_R - 4]},
    {"id": "guild", "name": "Abenteurergilde", "what": "wiederholbare Aufträge", "rect": [CX + 8, -40 - PLAZA_R - 36, CX + 50, -40 - PLAZA_R - 4]},
]

# --- the quarters, and each one's plot size (width along the street x depth)
def quarter(x, z):
    if -128 < z < 48 and x < CX:
        return "shop"          # the market quarter: along the avenue from the gate to the plaza
    if -128 < z < 48 and x > CX:
        return "workshop"      # the workshops: the east, away from the houses' windows
    return "house"             # north and south
SIZE = {"shop": (12, 14), "house": (16, 20), "workshop": (22, 26)}
KIND = {"shop": ("L", "Laden"), "house": ("W", "Wohnhaus"), "workshop": ("H", "Werkstatt")}

def ok(x0, z0, x1, z1):
    for x, z in ((x0, z0), (x1, z0), (x0, z1), (x1, z1), ((x0 + x1) / 2, (z0 + z1) / 2)):
        if not inside(x, z) or wall_dist(x, z) < 8:
            return False
    if on_street(x0, z0, x1, z1, 1):
        return False
    for b in BUILDINGS:
        r = b["rect"]
        if x1 > r[0] - 6 and x0 < r[2] + 6 and z1 > r[1] - 6 and z0 < r[3] + 6:
            return False
    nx, nz = max(x0, min(CX, x1)), max(z0, min(CZ, z1))
    return math.hypot(nx - CX, nz - CZ) > PLAZA_R + 6

# --- plots: rows along both sides of each east-west street, a second row back to back behind the first where there is
# room. The avenue's rows are the market (west of the plaza) and the workshops (east); the side streets' rows that face
# the middle are workshops in the east and houses in the west, and the ones facing the wall are houses, two rows deep.
def overlaps(r):
    return any(r[2] > q["rect"][0] and r[0] < q["rect"][2] and r[3] > q["rect"][1] and r[1] < q["rect"][3] for q in plots)
plots = []
XCUTS = [(682, 7), (CX, 10), (898, 7)]   # the north-south streets: segments between them
for zs, w, sides in ((-40, 12, (("n", None), ("s", None))), (-128, 7, (("n", "house"), ("s", None))), (48, 7, (("n", None), ("s", "house")))):
    for face, forced in sides:
        for back in (0, 1):
            kinds = lambda x: forced or ("workshop" if x > CX else "shop" if zs == -40 else "house")
            edges = [560] + [c for c, _ in XCUTS] + [1060]
            for a, b in zip(edges, edges[1:]):
                lo = a + (dict(XCUTS).get(a, 0) / 2 + 1 if a in dict(XCUTS) else 0)
                hi = b - (dict(XCUTS).get(b, 0) / 2 + 1 if b in dict(XCUTS) else 0)
                kind = kinds((lo + hi) / 2)
                pw, dep = SIZE[kind]
                if face == "n":
                    z1 = zs - w / 2 - 1 - back * dep; z0 = z1 - dep
                else:
                    z0 = zs + w / 2 + 1 + back * dep; z1 = z0 + dep
                n = int((hi - lo) // pw)
                off = lo + ((hi - lo) - n * pw) / 2
                for k in range(n):
                    r = [round(off + k * pw, 1), round(z0, 1), round(off + (k + 1) * pw, 1), round(z1, 1)]
                    if ok(*r) and not overlaps(r):
                        plots.append({"kind": kind, "rect": r, "face": "back" if back else face})
count = {}
for p in plots:
    k = KIND[p["kind"]][0]
    count[k] = count.get(k, 0) + 1
    p["id"] = f"{k}{count[k]}"

# --- the drawing: 2 px a metre
X0, X1, Z0, Z1 = 540, 1080, -250, 160
S, PAD, LEG = 2, 30, 330
img = Image.new("RGB", (int((X1 - X0) * S) + 2 * PAD + LEG, int((Z1 - Z0) * S) + 2 * PAD + 40), "#f4efe3")
dr = ImageDraw.Draw(img)
def P(x, z): return (PAD + (x - X0) * S, PAD + 40 + (z - Z0) * S)
try:
    F = lambda n, b=False: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans" + ("-Bold" if b else "") + ".ttf", n)
    F(10)
except OSError:
    F = lambda n, b=False: ImageFont.load_default()
# the land: green outside (paler), the city ground inside; the grid's height as light shading
g, st, gx0, gz0 = d["grid"], d["st"], d["X0"], d["Z0"]
for j, row in enumerate(g):
    for i, c in enumerate(row):
        x, z = gx0 + i * st, gz0 + j * st
        if not (X0 <= x < X1 and Z0 <= z < Z1):
            continue
        h, coast, river = c[0], c[3], c[4]
        if coast < 0 or river < 0:
            col = (150, 190, 215)
        elif inside(x, z):
            t = max(0, min(1, (h - 3) / 8)); col = (int(226 - 18 * t), int(214 - 12 * t), int(180 - 14 * t))
        else:
            t = max(0, min(1, (h - 0) / 12)); col = (int(170 - 30 * t), int(196 - 25 * t), int(140 - 25 * t))
        a, b = P(x, z)
        dr.rectangle([a, b, a + st * S, b + st * S], fill=col)
# the road from Blockshire outside the wall
for r in d["roads"]:
    pts = [q for q in r["pts"] if not inside(*q)]
    if len(r["pts"]) > 1 and pts:
        dr.line([P(x, z) for x, z in pts] + [P(*GATE)], fill="#b89a6a", width=int(r["w"] * S))
# streets, only inside the wall
layer = img.copy(); ldr = ImageDraw.Draw(layer)
for name, a, b, c, e, w in STREETS:
    x0, x1, z0, z1 = min(a, c), max(a, c), min(b, e), max(b, e)
    if x0 == x1: x0, x1 = x0 - w / 2, x1 + w / 2
    if z0 == z1: z0, z1 = z0 - w / 2, z1 + w / 2
    pts = [(max(x0, X0), z0), (min(x1, X1), z1)]
    q0, q1 = P(*pts[0]), P(*pts[1])
    ldr.rectangle([q0, q1], fill="#cdbb98" if w >= 10 else "#d8c9a8")
mask = Image.new("L", img.size, 0)
ImageDraw.Draw(mask).polygon([P(x, z) for x, z in WALL], fill=255)
img.paste(layer, (0, 0), mask); dr = ImageDraw.Draw(img)
# plaza and fountain
dr.ellipse([P(CX - PLAZA_R, CZ - PLAZA_R), P(CX + PLAZA_R, CZ + PLAZA_R)], fill="#e2d5b8", outline="#9c8a66", width=2)
for rr, col in ((FOUNTAIN_R + 2, "#8e8a80"), (FOUNTAIN_R, "#7fb6d6"), (2, "#cfe7f3")):
    dr.ellipse([P(CX - rr, CZ - rr), P(CX + rr, CZ + rr)], fill=col)
# plots
COL = {"shop": ("#f0b65a", "#a8701c"), "house": ("#9cc7e8", "#3d6f96"), "workshop": ("#d79a8a", "#8a4232")}
for p in plots:
    fill, line = COL[p["kind"]]
    x0, z0, x1, z1 = p["rect"]
    dr.rectangle([P(x0, z0), P(x1, z1)], fill=fill, outline=line, width=1)
    t = p["id"]; f = F(9)
    cx, cz = P((x0 + x1) / 2, (z0 + z1) / 2)
    dr.text((cx, cz), t, fill="#1c1c1c", font=f, anchor="mm")
# the two buildings
for b in BUILDINGS:
    x0, z0, x1, z1 = b["rect"]
    dr.rectangle([P(x0, z0), P(x1, z1)], fill="#8d6a4a", outline="#3a2a1a", width=3)
    cx, cz = P((x0 + x1) / 2, (z0 + z1) / 2)
    dr.multiline_text((cx, cz), b["name"].replace("Abenteurergilde", "Abenteurer-\ngilde"), fill="#fff6e6", font=F(13, True), anchor="mm", align="center")
# the wall, its gate
wl = [P(x, z) for x, z in WALL] + [P(*WALL[0])]
dr.line(wl, fill="#5a5048", width=7, joint="curve")
gp = P(*GATE)
dr.rectangle([gp[0] - 9, gp[1] - 16, gp[0] + 9, gp[1] + 16], fill="#3a2a1a")
dr.text((gp[0] - 14, gp[1] - 28), "Stadttor", fill="#3a2a1a", font=F(13, True), anchor="rm")
dr.text(P(560, -30), "nach Blockshire", fill="#5a4a30", font=F(11), anchor="rm")
# labels
def tag(txt, x, z, n=15):
    f = F(n, True); q = P(x, z); bb = dr.textbbox(q, txt, font=f, anchor="mm")
    dr.rounded_rectangle([bb[0] - 6, bb[1] - 3, bb[2] + 6, bb[3] + 3], 5, fill="#f6f0e2", outline="#8a7a5a")
    dr.text(q, txt, fill="#2a2a2a", font=f, anchor="mm")
for txt, x, z in (("Marktviertel", 735, -40), ("Werkstattviertel", 950, -114), ("Wohnviertel Nord", 790, -195), ("Wohnviertel Süd", 790, 128)):
    tag(txt, x, z)
for name, a, b, c, e, w in STREETS:
    if name:
        if b == e:
            dr.text(P((a + c) / 2, b), name, fill="#5a4a30", font=F(10), anchor="mm")
        else:
            nz = (-40 - PLAZA_R - 44) if e < 0 else 100
            lbl = Image.new("RGBA", (90, 14), (0, 0, 0, 0)); ImageDraw.Draw(lbl).text((45, 7), name, fill="#5a4a30", font=F(10), anchor="mm")
            lbl = lbl.rotate(90, expand=True); q = P(a, nz - 22 if e < 0 else nz + 6); img.paste(lbl, (int(q[0] - 7), int(q[1] - 45)), lbl)
# title, north, scale, square grid of the game's coordinates (200 m squares: letters from x -600, numbers from z -1580)
dr.text((PAD, 14), "Genesis – Stadtplan (Entwurf)", fill="#1c1c1c", font=F(22, True))
for gxl in range(-600, 1600, 200):
    if X0 < gxl < X1:
        dr.line([P(gxl, Z0), P(gxl, Z1)], fill="#9a9284", width=1)
for gzl in range(-1580, 600, 200):
    if Z0 < gzl < Z1:
        dr.line([P(X0, gzl), P(X1, gzl)], fill="#9a9284", width=1)
for gxl in range(-600, 1600, 200):
    for gzl in range(-1580, 600, 200):
        if X0 <= gxl + 100 < X1 + 100 and Z0 <= gzl + 100 < Z1 + 100:
            lx, lz = max(X0 + 6, gxl + 6), max(Z0 + 6, gzl + 6)
            if lx < X1 and lz < Z1:
                dr.text(P(lx, lz), chr(65 + (gxl + 600) // 200) + str((gzl + 1580) // 200 + 1), fill="#7a7264", font=F(10), anchor="lt")
sx, sz = P(X0 + 10, Z1 - 12)
dr.line([(sx, sz), (sx + 100 * S, sz)], fill="#1c1c1c", width=3)
dr.text((sx, sz - 6), "100 m", fill="#1c1c1c", font=F(11), anchor="lb")
nx, nz = P(X1 - 20, Z0 + 30)
dr.polygon([(nx, nz - 20), (nx - 8, nz + 6), (nx + 8, nz + 6)], fill="#1c1c1c")
dr.text((nx, nz + 10), "N", fill="#1c1c1c", font=F(13, True), anchor="mt")
# legend
lx = PAD + int((X1 - X0) * S) + 24; ly = PAD + 60
dr.text((lx, ly), "Legende", fill="#1c1c1c", font=F(16, True)); ly += 30
items = [("house", "Wohnhaus  W", SIZE["house"]), ("workshop", "Werkstatt  H", SIZE["workshop"]), ("shop", "Laden  L", SIZE["shop"])]
for k, label, (w, dep) in items:
    dr.rectangle([lx, ly, lx + 22, ly + 16], fill=COL[k][0], outline=COL[k][1])
    dr.text((lx + 32, ly - 1), label, fill="#1c1c1c", font=F(13, True))
    dr.text((lx + 32, ly + 16), f"{w} × {dep} m · {count[KIND[k][0]]} Grundstücke", fill="#3a3a3a", font=F(11)); ly += 44
dr.rectangle([lx, ly, lx + 22, ly + 16], fill="#8d6a4a", outline="#3a2a1a")
dr.text((lx + 32, ly - 1), "Rathaus · Gilde", fill="#1c1c1c", font=F(13, True)); ly += 26
dr.ellipse([lx + 3, ly, lx + 19, ly + 16], fill="#7fb6d6", outline="#8e8a80", width=2)
dr.text((lx + 32, ly - 1), "Brunnen", fill="#1c1c1c", font=F(13, True)); ly += 40
for line in ["Grundstücke liegen auf einem Raster:",
             "Nachbarn teilen eine Kante. Wem zwei",
             "nebeneinander gehören, der baut",
             "über beide durchgängig.",
             "",
             f"Insgesamt {len(plots)} Grundstücke.",
             "Mauer: ca. 470 × 350 m, ein Tor im",
             "Westen an der Straße nach Blockshire.",
             "Kein Wasser innerhalb der Mauer.",
             "",
             "Raster grau: Spiel-Koordinaten",
             "(200-m-Quadrate wie im Kompass)."]:
    dr.text((lx, ly), line, fill="#2a2a2a", font=F(11)); ly += 17
tag("Marktplatz", CX, CZ + 18, 12)
img.save(HERE / "genesis-plan.png")
(HERE / "plots.json").write_text(json.dumps({"centre": [CX, CZ], "plaza_r": PLAZA_R, "fountain_r": FOUNTAIN_R,
    "gate": GATE, "streets": STREETS, "buildings": BUILDINGS, "plots": plots}, ensure_ascii=False, indent=1))
print(len(plots), "plots", count)
