#!/usr/bin/env python3
"""The Spider Cave under Greenwood (tbuuol 2026-11-10: "richtig schön groß", a Broodmother at the end): the layout
plan -- chambers, tunnels, the chasm and its web bridge -- in the cave's own metres (entrance at 0, 0; y = floor height).
    tools/.venv/bin/python design/spidercave/layout.py   -> design/spidercave/layout.json + layout.png"""
import json, math, pathlib
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
# chambers: id, name, centre, radii (rx, rz), floor y, what lives there, dome (how much higher the roof is in the middle)
CHAMBERS = [
    ("A", "Eingangsgrotte", (0, 0), (15, 12), 0, "sicher: hier kommt man an und wacht auf", 5),
    ("B", "Netzgewirr", (-25, 92), (16, 13), -3, "Jungspinnen-Schwärme, Kokons", 4),
    ("B2", "Kokonkammer", (38, 100), (10, 9), -2, "eingesponnene Opfer: Beute", 3),
    ("C", "Pilzkaverne", (-55, 160), (38, 26), -8, "leuchtende Pilze, See, Erz + Kräuter", 12),
    ("D1", "Eierkammer", (62, 108), (10, 9), -10, "Eier schlüpfen, wenn man nah kommt", 4),
    ("D2", "Eierkammer", (84, 168), (10, 9), -10, "Eier + Brutwächter", 4),
    ("D3", "Eierkammer", (108, 108), (10, 9), -10, "Eier + Brutwächter", 4),
    ("F", "Brutsaal", (205, 140), (26, 24), -16, "die Mutterspinne", 11),
    ("G", "Schatznische", (236, 140), (7, 6), -16, "Truhe", 3),
]
# tunnels: points (x, z, floor y), width
TUNNELS = [
    ([(0, 10, 0), (18, 40, -1), (6, 68, -2), (-12, 82, -3)], 6),
    ([(6, 68, -2), (28, 88, -2), (38, 100, -2)], 5),
    ([(-25, 103, -3), (-35, 130, -6), (-45, 140, -8)], 6),
    ([(-20, 160, -8), (20, 160, -9), (50, 140, -10), (90, 138, -10)], 7),
    ([(62, 117, -10), (62, 138, -10)], 4),
    ([(84, 159, -10), (84, 138, -10)], 4),
    ([(108, 117, -10), (108, 138, -10)], 4),
    ([(90, 138, -10), (128, 140, -12)], 7),
    ([(168, 140, -13), (182, 140, -16)], 7),
    ([(238, 134, -16), (250, 105, -14), (238, 80, -12)], 5),
]
CHASM = ((128, 118), (168, 162), -40)      # the floor falls away here, to y -40
BRIDGE = ([(128, 140, -12), (148, 136, -12.5), (168, 140, -13)], 3)   # a web bridge over it
ARRIVE, BACK = (0, -5), (0, -10)           # where you come down, and the light that takes you back up
EXIT = (238, 80)                           # the far end's way out

def length(pts): return sum(math.dist(a[:2], b[:2]) for a, b in zip(pts, pts[1:]))

if __name__ == "__main__":
    S, OX, OZ = 4, 100, 30
    W, H = int(380 * S), int(250 * S)
    im = Image.new("RGB", (W + 460, H), "#16120f"); dr = ImageDraw.Draw(im)
    P = lambda x, z: (OX * S + x * S, OZ * S + z * S)
    F = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"; FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    fb, fs, ft = ImageFont.truetype(F, 18), ImageFont.truetype(FR, 15), ImageFont.truetype(F, 28)
    rock, floor = "#3a312a", "#8a7a66"
    for pts, w in TUNNELS:
        dr.line([P(p[0], p[1]) for p in pts], fill=floor, width=int(w * S), joint="curve")
        for p in pts: r = w * S / 2; x, y = P(p[0], p[1]); dr.ellipse((x - r, y - r, x + r, y + r), fill=floor)
    (cx0, cz0), (cx1, cz1), _ = CHASM
    dr.rectangle((*P(cx0, cz0), *P(cx1, cz1)), fill="#050404", outline="#2a2420", width=3)
    pts, w = BRIDGE; dr.line([P(p[0], p[1]) for p in pts], fill="#d8d4cc", width=int(w * S))
    for cid, name, (x, z), (rx, rz), y, what, _ in CHAMBERS:
        col = {"F": "#7a3a3a", "C": "#3f6a5a", "G": "#8a7a2a"}.get(cid, floor)
        if cid.startswith("D"): col = "#7a6a4a"
        dr.ellipse((*P(x - rx, z - rz), *P(x + rx, z + rz)), fill=col)
        dr.text(P(x, z), cid, font=fb, fill="#ffffff", anchor="mm")
    x, y = P(0, 0); dr.text((x, y - 70), "Eingang (Greenwood)", font=fs, fill="#ffd96a", anchor="mm")
    x, y = P(*EXIT); dr.text((x, y - 26), "Ausgang", font=fs, fill="#ffd96a", anchor="mm")
    x, y = P(148, 128); dr.text((x, y - 40), "Abgrund + Netzbrücke", font=fs, fill="#e0d8cc", anchor="mm")
    dr.line((*P(-80, 238), *P(-30, 238)), fill="#e0d8cc", width=3); dr.text(P(-55, 232), "50 m", font=fs, fill="#e0d8cc", anchor="mb")
    X = W + 16; yy = 20
    dr.text((X, yy), "Spinnenhöhle – Grundriss", font=ft, fill="#ffd96a"); yy += 50
    for cid, name, c, r, fy, what, _ in CHAMBERS:
        dr.text((X, yy), f"{cid}  {name}", font=fb, fill="#ffffff"); yy += 22
        dr.text((X + 34, yy), f"{what}  ·  {abs(fy)} m tief" if fy else what, font=fs, fill="#cfc6b8"); yy += 28
    total = sum(length(p) for p, _ in TUNNELS) + length(BRIDGE[0])
    yy += 8
    for line in [f"Gänge: ca. {int(total)} m, Weg bis zur", "Mutterspinne ca. 330 m.", "Gesamt ca. 260 × 190 m.",
                 "", "Rund 45 Spinnen + die Mutterspinne.", "Dunkel: Licht nur von Pilzen,", "Fackeln und deiner Laterne."]:
        dr.text((X, yy), line, font=fs, fill="#cfc6b8"); yy += 20
    im.save(HERE / "layout.png")
    json.dump({"chambers": CHAMBERS, "tunnels": TUNNELS, "chasm": CHASM, "bridge": BRIDGE, "exit": EXIT},
              open(HERE / "layout.json", "w"), indent=1, ensure_ascii=False)
    print("tunnels", int(total), "m")
