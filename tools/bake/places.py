#!/usr/bin/env python3
"""Adds the solids (what nobody walks through) to every place of content/core/places, from its parts: hut walls with a
door gap, the palisade with its gate, the well, the forge, solid props. The house walks players against them, the
client predicts the same; neither derives them itself.

    python3 tools/bake/places.py
A solid: [cx, cz, half_x, half_z, turn_deg, height] -- a box on the ground, turned about y (as three.js rotation.y)."""
import json, math, os, glob

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
WALL, WALL_H = 0.32, 2.7      # log wall thickness and height
DOOR = 1.3                    # door gap

def rot(x, z, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return x * c + z * s, -x * s + z * c          # three.js: rotation.y by a turns (x, z) like this

def box(ox, oz, deg, lx, lz, hx, hz, h):
    """a box at local (lx, lz) of a thing at (ox, oz) turned by deg"""
    dx, dz = rot(lx, lz, deg)
    return [round(ox + dx, 3), round(oz + dz, 3), round(hx, 3), round(hz, 3), deg % 360, h]

for path in glob.glob(os.path.join(ROOT, 'content', 'core', 'places', '*.json')):
    p = json.load(open(path))
    S = []
    for h in p.get('huts', []):
        (x, z), (w, d), r = h['pos'], h['size'], h.get('rot', 0)
        hw, hd, t = w / 2, d / 2, WALL / 2
        S.append(box(x, z, r, 0, hd - t, hw, t, WALL_H))                 # back wall (+z local)
        S.append(box(x, z, r, -hw + t, 0, t, hd, WALL_H))                # left
        S.append(box(x, z, r, hw - t, 0, t, hd, WALL_H))                 # right
        side = (hw - DOOR / 2) / 2                                         # front (-z local) with the door gap
        S.append(box(x, z, r, -hw + side, -hd + t, side, t, WALL_H))
        S.append(box(x, z, r, hw - side, -hd + t, side, t, WALL_H))
    f = p.get('fence')
    if f:
        x0, z0, x1, z1 = f['rect']; g0, g1 = f.get('gate', [0, 0]); t = 0.25
        S.append([ (x0 + x1) / 2, z0, (x1 - x0) / 2, t, 0, 3.2])            # north
        S.append([x0, (z0 + z1) / 2, t, (z1 - z0) / 2, 0, 3.2])             # west
        S.append([x1, (z0 + z1) / 2, t, (z1 - z0) / 2, 0, 3.2])             # east
        S.append([(x0 + g0) / 2, z1, (g0 - x0) / 2, t, 0, 3.2])             # south, left of the gate
        S.append([(g1 + x1) / 2, z1, (x1 - g1) / 2, t, 0, 3.2])             # south, right of the gate
    if p.get('well'):
        x, z = p['well']['pos']; S.append([x, z, 0.95, 0.95, 0, 1.0])
    if p.get('forge'):
        x, z = p['forge']['pos']; S.append(box(x, z, p['forge'].get('rot', 0), 0, 0, 1.2, 0.8, 1.0))
    SOLID = {'barrel': (0.35, 0.35), 'crate': (0.45, 0.45), 'cart': (1.0, 0.7), 'haystack': (1.0, 1.0), 'logpile': (1.4, 0.6)}
    for pr in p.get('props', []):
        if pr['kind'] in SOLID:
            x, z = pr['pos']; hx, hz = SOLID[pr['kind']]; S.append(box(x, z, pr.get('rot', 0), 0, 0, hx, hz, 1.2))
    p['solids'] = S
    json.dump(p, open(path, 'w'), indent=1)
    print(os.path.basename(path), len(S), 'solids')
