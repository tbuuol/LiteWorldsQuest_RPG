#!/usr/bin/env python3
"""Make a LiteWorldsQuest level from a piece of the real Earth.

    tools/.venv/bin/python tools/realworld.py --lat 50.77469 --lon 12.06067 --size 1000 --id weida --title Weida

What it reads, once (kept in tools/cache/, so a rebuild asks nobody again):
  OpenStreetMap through the Overpass API   buildings, roads and paths, walls, water, land use, single trees
                                           (ODbL: the game shows "© OpenStreetMap contributors")
  AWS Terrain Tiles (terrarium PNG, z14)    heights (SRTM / EU-DEM via Mapzen's Joerd; attribution in the game)

What it writes: src/levels/<id>.json, a level data module. Everything is in whole decimetres around the centre
(x east, z south, as the game uses), polygons and lines are simplified and delta-encoded, so a square kilometre of a
town stays a few tens of kilobytes:
  terrain   {n, size, base, h: [n*n heights in dm above base]}          a grid over the whole square
  buildings [[kind, levels, heightDm, x0, z0, dx1, dz1, ...], ...]       outer ring; kind: 0 house 1 big 2 church 3 castle 4 shed 5 tower
  walls     [[kind, x0, z0, dx, dz, ...]]                               0 wall 1 city wall 2 retaining wall
  roads     [[class, x0, z0, dx, dz, ...]]                              0 main 1 street 2 small 3 path 4 track 5 steps
  areas     [[class, x0, z0, dx, dz, ...]]                              see AREA below
  water     {areas: [[x0, z0, ...]], rivers: [[widthDm, x0, z0, ...]]}
  trees     [x0, z0, dx, dz, ...]
Nothing is invented: what OSM does not say (a house's height, its roof) the game decides when it draws it.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / "cache"
UA = "LiteWorldsQuest-prototype/0.1 (game level builder)"
OVERPASS = "https://overpass-api.de/api/interpreter"
TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

AREA = {  # OSM tag value -> class (the order is the drawing order: later on top)
    "farmland": 1, "meadow": 2, "grass": 2, "grassland": 2, "village_green": 2, "recreation_ground": 2, "park": 2,
    "orchard": 3, "allotments": 3, "vineyard": 3,
    "residential": 4, "retail": 5, "commercial": 5, "industrial": 5, "railway": 5,
    "cemetery": 6, "scrub": 7, "heath": 7,
    "forest": 8, "wood": 8,
    "parking": 9, "pitch": 10, "sports_centre": 10, "playground": 10,
    "bare_rock": 11, "cliff": 11,
}
ROAD = {"motorway": 0, "trunk": 0, "primary": 0, "secondary": 0, "tertiary": 1, "residential": 1,
        "unclassified": 1, "living_street": 1, "pedestrian": 2, "service": 2, "footway": 3, "path": 3,
        "cycleway": 3, "bridleway": 3, "track": 4, "steps": 5}


def fetch(url: str, data: bytes | None = None, name: str = "") -> bytes:
    path = CACHE / name
    if name and path.exists():
        return path.read_bytes()
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            break
        except Exception as exc:  # noqa: BLE001  (a busy public server: wait and ask once more)
            if attempt == 3:
                raise
            print(f"  {url.split('/')[2]} did not answer ({exc}); waiting")
            time.sleep(10 * (attempt + 1))
    if name:
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    return body


class Frame:
    """Metres around the centre: x east, z south."""

    def __init__(self, lat: float, lon: float):
        self.lat0, self.lon0 = lat, lon
        self.kx = 111320.0 * math.cos(math.radians(lat))
        self.kz = 110574.0

    def xz(self, lat: float, lon: float) -> tuple[float, float]:
        return (lon - self.lon0) * self.kx, -(lat - self.lat0) * self.kz

    def latlon(self, x: float, z: float) -> tuple[float, float]:
        return self.lat0 - z / self.kz, self.lon0 + x / self.kx


# --- geometry helpers ---------------------------------------------------------------------------------------------
def simplify(pts: list, tol: float) -> list:
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    (ax, az), (bx, bz) = pts[0], pts[-1]
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1e-9
    best, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, pz = pts[i]
        d = abs(dz * (px - ax) - dx * (pz - az)) / L if L > 1e-9 else math.hypot(px - ax, pz - az)
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def clip_poly(pts: list, h: float) -> list:
    """Sutherland-Hodgman against the square [-h, h]^2."""
    def edge(points, inside, cut):
        out = []
        for i, cur in enumerate(points):
            prev = points[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(cut(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cut(prev, cur))
        return out

    def at_x(x0):
        return lambda a, b: (x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / ((b[0] - a[0]) or 1e-9))

    def at_z(z0):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (z0 - a[1]) / ((b[1] - a[1]) or 1e-9), z0)
    for inside, cut in ((lambda p: p[0] >= -h, at_x(-h)), (lambda p: p[0] <= h, at_x(h)),
                        (lambda p: p[1] >= -h, at_z(-h)), (lambda p: p[1] <= h, at_z(h))):
        pts = edge(pts, inside, cut)
        if not pts:
            return []
    return pts


def clip_line(pts: list, h: float) -> list[list]:
    """A line cut into the pieces that lie in the square (Liang-Barsky per segment)."""
    pieces, cur = [], []
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        t0, t1, dx, dz = 0.0, 1.0, bx - ax, bz - az
        ok = True
        for p, q in ((-dx, ax + h), (dx, h - ax), (-dz, az + h), (dz, h - az)):
            if p == 0:
                if q < 0:
                    ok = False
                    break
            else:
                r = q / p
                if p < 0:
                    t0 = max(t0, r)
                else:
                    t1 = min(t1, r)
        if not ok or t0 > t1:
            if len(cur) > 1:
                pieces.append(cur)
            cur = []
            continue
        A = (ax + dx * t0, az + dz * t0)
        B = (ax + dx * t1, az + dz * t1)
        if not cur:
            cur = [A]
        cur.append(B)
        if t1 < 1:
            pieces.append(cur)
            cur = []
    if len(cur) > 1:
        pieces.append(cur)
    return pieces


def pack(pts: list) -> list[int]:
    """[x0, z0, dx1, dz1, ...] in whole decimetres; repeated points dropped."""
    out, px, pz = [], None, None
    for x, z in pts:
        ix, iz = round(x * 10), round(z * 10)
        if px is None:
            out += [ix, iz]
        elif (ix, iz) != (px, pz):
            out += [ix - px, iz - pz]
        else:
            continue
        px, pz = ix, iz
    return out


def area(pts: list) -> float:
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))) / 2


# --- the sources ------------------------------------------------------------------------------------------------------
def osm(frame: Frame, half: float, key: str) -> dict:
    s, w = frame.latlon(-half - 60, half + 60)
    n, e = frame.latlon(half + 60, -half - 60)
    bbox = f"{min(s, n):.6f},{min(w, e):.6f},{max(s, n):.6f},{max(w, e):.6f}"
    q = f"""[out:json][timeout:120];
(
  way["building"]({bbox}); relation["building"]({bbox});
  way["highway"]({bbox});
  way["barrier"~"^(wall|city_wall|retaining_wall)$"]({bbox}); way["historic"="city_wall"]({bbox});
  way["natural"~"^(water|wood|scrub|heath|grassland|bare_rock)$"]({bbox}); relation["natural"="water"]({bbox});
  way["waterway"]({bbox}); way["landuse"]({bbox}); relation["landuse"]({bbox}); way["leisure"]({bbox});
  node["natural"="tree"]({bbox});
);
out geom;"""
    body = fetch(OVERPASS, urllib.parse.urlencode({"data": q}).encode(), f"osm-{key}.json")
    return json.loads(body)


def terrain(frame: Frame, half: float, n: int, key: str) -> list[list[float]]:
    from PIL import Image
    z = 14
    def tile_xy(lat, lon):
        x = (lon + 180) / 360 * 2 ** z
        y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** z
        return x, y
    tiles = {}
    def height(lat, lon):
        fx, fy = tile_xy(lat, lon)
        tx, ty = int(fx), int(fy)
        if (tx, ty) not in tiles:
            png = fetch(TERRAIN.format(z=z, x=tx, y=ty), None, f"terrarium-{z}-{tx}-{ty}.png")
            tiles[(tx, ty)] = Image.open(io.BytesIO(png)).convert("RGB")
        img = tiles[(tx, ty)]
        px, py = (fx - tx) * 256 - 0.5, (fy - ty) * 256 - 0.5
        x0, y0 = max(0, min(254, int(math.floor(px)))), max(0, min(254, int(math.floor(py))))
        ax, ay = max(0, min(1, px - x0)), max(0, min(1, py - y0))
        def h(x, y):
            r, g, b = img.getpixel((x, y))
            return r * 256 + g + b / 256 - 32768
        return (h(x0, y0) * (1 - ax) * (1 - ay) + h(x0 + 1, y0) * ax * (1 - ay)
                + h(x0, y0 + 1) * (1 - ax) * ay + h(x0 + 1, y0 + 1) * ax * ay)
    grid = []
    for j in range(n):
        row = []
        for i in range(n):
            x = -half + 2 * half * i / (n - 1)
            zz = -half + 2 * half * j / (n - 1)
            row.append(height(*frame.latlon(x, zz)))
        grid.append(row)
    return grid


# --- the level ---------------------------------------------------------------------------------------------------------
def build(args) -> dict:
    frame = Frame(args.lat, args.lon)
    half = args.size / 2
    key = f"{args.lat:.5f}_{args.lon:.5f}_{int(args.size)}"
    print("OpenStreetMap…")
    data = osm(frame, half, key)
    print("terrain…")
    grid = terrain(frame, half, args.grid, key)
    base = math.floor(min(min(r) for r in grid))
    lv = {"buildings": [], "walls": [], "roads": [], "areas": [], "water": {"areas": [], "rivers": []}, "trees": []}
    trees = []

    def rings(el):
        if el["type"] == "way" and "geometry" in el:
            return [[frame.xz(p["lat"], p["lon"]) for p in el["geometry"]]]
        if el["type"] == "relation":   # outer rings only, each way of them as given (good enough for areas)
            return [[frame.xz(p["lat"], p["lon"]) for p in m["geometry"]] for m in el.get("members", [])
                    if m.get("role") == "outer" and "geometry" in m]
        return []

    for el in data.get("elements", []):
        t = el.get("tags", {})
        if el["type"] == "node":
            if t.get("natural") == "tree":
                x, z = frame.xz(el["lat"], el["lon"])
                if abs(x) < half and abs(z) < half:
                    trees.append((x, z))
            continue
        for ring in rings(el):
            closed = len(ring) > 3 and ring[0] == ring[-1]
            if "building" in t and closed:
                poly = clip_poly(simplify(ring[:-1], 0.4), half)
                if len(poly) < 3 or area(poly) < 6:
                    continue
                b, kind = t["building"], 0
                if b in ("church", "chapel", "cathedral") or t.get("amenity") == "place_of_worship":
                    kind = 2
                elif b == "castle" or t.get("historic") == "castle":
                    kind = 3
                elif b in ("garage", "garages", "shed", "hut", "carport", "roof"):
                    kind = 4
                elif b == "tower" or t.get("man_made") == "tower":
                    kind = 5
                elif area(poly) > 400 or b in ("industrial", "warehouse", "commercial", "retail", "school", "public"):
                    kind = 1
                try:
                    levels = int(float(t.get("building:levels", "0")))
                except ValueError:
                    levels = 0
                try:
                    height = round(float(str(t.get("height", "0")).split()[0]) * 10)
                except ValueError:
                    height = 0
                lv["buildings"].append([kind, levels, height] + pack(poly))
            elif "highway" in t and t["highway"] in ROAD and not closed:
                for piece in clip_line(simplify(ring, 0.8), half):
                    lv["roads"].append([ROAD[t["highway"]]] + pack(piece))
            elif t.get("barrier") in ("wall", "city_wall", "retaining_wall") or t.get("historic") == "city_wall":
                kind = {"wall": 0, "city_wall": 1, "retaining_wall": 2}.get(t.get("barrier"), 1)
                for piece in clip_line(simplify(ring, 0.5), half):
                    lv["walls"].append([kind] + pack(piece))
            elif "waterway" in t and not closed:
                w = {"river": 120, "canal": 80, "stream": 30, "ditch": 15, "drain": 15}.get(t["waterway"], 0)
                if w:
                    for piece in clip_line(simplify(ring, 1.0), half):
                        lv["water"]["rivers"].append([w] + pack(piece))
            elif closed and (t.get("natural") == "water" or t.get("water") or t.get("landuse") in ("reservoir", "basin")):
                poly = clip_poly(simplify(ring[:-1], 1.0), half)
                if len(poly) >= 3:
                    lv["water"]["areas"].append(pack(poly))
            elif closed:
                cls = AREA.get(t.get("landuse")) or AREA.get(t.get("natural")) or AREA.get(t.get("leisure"))
                if cls:
                    poly = clip_poly(simplify(ring[:-1], 1.5), half)
                    if len(poly) >= 3 and area(poly) > 30:
                        lv["areas"].append([cls] + pack(poly))
    lv["areas"].sort(key=lambda a: a[0])
    lv["trees"] = pack(sorted(trees))
    lv["terrain"] = {"n": args.grid, "size": args.size, "base": base,
                     "h": [round((v - base) * 10) for row in grid for v in row]}
    lv["origin"] = {"lat": args.lat, "lon": args.lon}
    return lv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--size", type=float, default=1000)
    ap.add_argument("--grid", type=int, default=65)
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    args = ap.parse_args()
    real = build(args)
    level = {"lwq": "module", "name": "level." + args.id, "api": 1, "v": 1, "data": {
        "id": args.id, "title": args.title,
        "credits": "Map data © OpenStreetMap contributors (ODbL) · Terrain: AWS Terrain Tiles (Mapzen, SRTM, EU-DEM)",
        "env": {"skyTop": "#5b8fd0", "skyBottom": "#f2d2a8", "fogColor": "#d9d2c4", "fog": [120, 520],
                "sunDir": [-0.5, 0.45, -0.75], "sunColor": "#ffe1b8", "sun": 2.3, "hemi": 0.85, "exposure": 1.0,
                "ground": 0},
        "solids": [], "real": real}}
    out = ROOT / "src" / "levels" / f"{args.id}.json"
    text = json.dumps(level, separators=(",", ":"))
    out.write_text(text)
    import gzip
    print(f"{out.relative_to(ROOT)}: {len(text) / 1024:.1f} KB, gzip {len(gzip.compress(text.encode(), 9)) / 1024:.1f} KB")
    print({k: len(v) for k, v in real.items() if isinstance(v, list)},
          "rivers", len(real["water"]["rivers"]), "water areas", len(real["water"]["areas"]))


if __name__ == "__main__":
    main()
