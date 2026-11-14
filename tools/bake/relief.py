#!/usr/bin/env python3
"""Gives the baked ground real relief (tbuuol 2026-11-14: "viel zu flach ... nicht so kantig", the aim is Skyrim):
the old computed ground, smoothed, plus hills and ridges by land kind; settlements stay level, roads get gentle grades,
the coast and the rivers stay where they are.

    python3 tools/bake/relief.py            reads tools/bake/ground.base.bin (made by bake_world.cjs, kept aside),
                                            writes content/core/world/ground.bin and the relief into ground.json
Deterministic (fixed seed): the same input gives the same world."""
import json, os, sys
import numpy as np
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
WORLD = os.path.join(ROOT, 'content', 'core', 'world')
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ground.base.bin')
meta = json.load(open(os.path.join(WORLD, 'ground.json')))
nx, nz, step, base, sea = meta['nx'], meta['nz'], meta['step'], meta['base'], meta['sea']
x0, z0 = meta['extent'][0], meta['extent'][1]
kinds = meta['kinds']

if not os.path.exists(BASE):   # first run: the baked ground is the base
    os.replace(os.path.join(WORLD, 'ground.bin'), BASE)
H0 = base + np.frombuffer(open(BASE, 'rb').read(), dtype='<u2').astype(np.float64).reshape(nz, nx) / 100.0
land = np.frombuffer(open(os.path.join(WORLD, 'land.bin'), 'rb').read(), dtype=np.uint8).reshape(nz, nx, 2)
K, R = land[..., 0], land[..., 1].astype(np.float64) / 255.0
rng = np.random.default_rng(20261114)

def smooth01(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def noise(scale_m):
    """smooth value noise in [-1, 1] with features of about scale_m metres"""
    f = scale_m / step
    gh, gw = int(nz / f) + 4, int(nx / f) + 4
    g = rng.uniform(-1, 1, (gh, gw))
    big = ndimage.zoom(g, f, order=3, mode='grid-wrap')
    return np.clip(big[:nz, :nx], -1.2, 1.2)

WX, WZ = None, None   # domain warp: every octave is read at a displaced place, so ridges wind like real ones

def warped(n, strength_cells):
    zz, xx = np.mgrid[0:nz, 0:nx].astype(np.float64)
    return ndimage.map_coordinates(n, [np.clip(zz + WZ * strength_cells, 0, nz - 1), np.clip(xx + WX * strength_cells, 0, nx - 1)], order=1)

def fbm(scale_m, octaves=5, ridged=False, warp=0.0):
    out, amp, total, s = np.zeros((nz, nx)), 1.0, 0.0, scale_m
    for _ in range(octaves):
        n = noise(s)
        if warp > 0:
            n = warped(n, warp / step)
        if ridged:
            n = 1.0 - np.abs(n)
            n = n * n
        out += n * amp
        total += amp
        amp *= 0.5
        s = max(s / 2.0, step * 3)
    return out / total

# 1. the old ground without its terraces and creases; the coast and the river banks (where the old code made steps)
#    much softer than the rest
near_water = ndimage.gaussian_filter((np.abs(H0 - sea) < 4.0).astype(np.float64), sigma=10)
Hs = ndimage.gaussian_filter(H0, sigma=2.5) * (1 - np.clip(near_water * 2, 0, 1)) + ndimage.gaussian_filter(H0, sigma=7) * np.clip(near_water * 2, 0, 1)
WX, WZ = noise(900), noise(900)

# 2. relief by land kind (metres), blended over ~40 m so regions flow into each other
AMP = {'green': 26, 'valley': 18, 'fey': 30, 'troll': 75, 'ruins': 16, 'cemetery': 10, 'swamp': 3, 'mountain': 170}
amp = np.vectorize(lambda k: AMP.get(kinds[k], 8))(K).astype(np.float64)
A = ndimage.gaussian_filter(amp, sigma=20)
mount = ndimage.gaussian_filter(np.isin(K, [kinds.index('troll'), kinds.index('mountain')]).astype(np.float64), sigma=25)
rolling = fbm(700, 4, warp=60) * 0.75 + fbm(220, 3, warp=25) * 0.35
ridges = fbm(650, 5, ridged=True, warp=70)
delta = A * ((1 - mount) * rolling * 0.7 + mount * (ridges * 1.15 - 0.25 + rolling * 0.35))

# 3. the coast and the rivers stay: no relief near or below the water
coast = smooth01(0.6, 10.0, Hs - sea)
delta *= coast

# 4. roads: little relief, and a gentle grade along them
road = np.clip(ndimage.gaussian_filter(R, sigma=3) * 1.6, 0, 1)
delta *= 1 - 0.75 * road
H = Hs + delta
H = (road * 0.6) * ndimage.gaussian_filter(H, sigma=6) + (1 - road * 0.6) * H

# 5. settlements: level ground at their height, a soft rim into the land around
xs = x0 + np.arange(nx) * step
zs = z0 + np.arange(nz) * step
X, Z = np.meshgrid(xs, zs)
W = json.load(open(os.path.join(ROOT, 'src', 'levels', 'world.json')))['data']['land']
for p in W.get('pads', []):
    cx, cz = p['at']
    rx, rz = p.get('rx', p.get('r', 20)), p.get('rz', p.get('r', 20))
    rim = max(p.get('rim', 20) * 2.0, 60)   # a wide, soft rim: no crater round a settlement
    d = np.sqrt(((X - cx) / rx) ** 2 + ((Z - cz) / rz) ** 2) * min(rx, rz)   # metres, about
    k = 1 - smooth01(min(rx, rz), min(rx, rz) + rim, d)
    H = H * (1 - k) + p['y'] * k

# 6. water stays water (the sea and the rivers keep their old depth, their banks ease into it), land never sinks
#    under the sea where it was land, and a last soft touch against creases
water = H0 < sea
bed = ndimage.gaussian_filter(np.where(water, H0, sea + 0.4), sigma=1.5)
bank = ndimage.gaussian_filter(water.astype(np.float64), sigma=3.0)
H = np.where(water, np.minimum(H, bed), H * (1 - bank) + np.minimum(H, sea + 0.4 + (H - sea) * 0.5) * bank)
was_land = H0 > sea + 0.3
H = np.where(was_land, np.maximum(H, sea + 0.35), H)
H = ndimage.gaussian_filter(H, sigma=0.8)

out = np.clip(np.round((H - base) * 100), 0, 65535).astype('<u2')
out.tofile(os.path.join(WORLD, 'ground.bin'))
meta['relief'] = {'tool': 'tools/bake/relief.py', 'seed': 20261114, 'amp': AMP, 'min': round(float(H.min()), 2), 'max': round(float(H.max()), 2)}
json.dump(meta, open(os.path.join(WORLD, 'ground.json'), 'w'), indent=1)
print(f"relief: {H0.min():.1f}..{H0.max():.1f} m -> {H.min():.1f}..{H.max():.1f} m")
