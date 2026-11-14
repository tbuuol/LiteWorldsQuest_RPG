#!/usr/bin/env python3
"""Places the ground clutter of the core module once, as content (like the trees): stones, boulders, ferns, bushes and
dead wood, by rules from the baked ground, its land kinds, the roads and the trees.

    python3 tools/bake/clutter.py      writes content/core/flora/clutter.bin and adds "clutter" to flora.json
Record: i16 x dm, i16 z dm, u8 size*20, u8 kind (index into KINDS), u8 turn (0..255 = one turn). Fixed seed."""
import json, os
import numpy as np
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
WORLD = os.path.join(ROOT, 'content', 'core', 'world')
FLORA = os.path.join(ROOT, 'content', 'core', 'flora')
meta = json.load(open(os.path.join(WORLD, 'ground.json')))
nx, nz, step, base, sea = meta['nx'], meta['nz'], meta['step'], meta['base'], meta['sea']
x0, z0 = meta['extent'][0], meta['extent'][1]
kinds = meta['kinds']
H = base + np.fromfile(os.path.join(WORLD, 'ground.bin'), dtype='<u2').astype(np.float64).reshape(nz, nx) / 100.0
land = np.fromfile(os.path.join(WORLD, 'land.bin'), dtype=np.uint8).reshape(nz, nx, 2)
K, R = land[..., 0], land[..., 1] / 255.0
rng = np.random.default_rng(20261114 + 7)

KINDS = ['stone', 'boulder', 'fern', 'bush', 'log']

# trees per sample, blurred into a forest density 0..1
flora = json.load(open(os.path.join(FLORA, 'flora.json')))
t = np.fromfile(os.path.join(FLORA, flora['trees']['file']), dtype=np.dtype([('x', '<i2'), ('z', '<i2'), ('s', 'u1'), ('k', 'u1')]))
tx = np.clip(((t['x'] / 10.0 - x0) / step).astype(int), 0, nx - 1)
tz = np.clip(((t['z'] / 10.0 - z0) / step).astype(int), 0, nz - 1)
T = np.zeros((nz, nx)); np.add.at(T, (tz, tx), 1.0)
forest = np.clip(ndimage.gaussian_filter(T, sigma=6) * 60.0, 0, 1)        # ~1 in a closed wood

gy, gx = np.gradient(H, step)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
mount = np.isin(K, [kinds.index('mountain'), kinds.index('troll')])
dry = (H > sea + 0.6)
road = ndimage.gaussian_filter(R, 1.5) > 0.08
# settlements: level ground left clear (their own content decides what stands there)
W = json.load(open(os.path.join(ROOT, 'src', 'levels', 'world.json')))['data']['land']
xs = x0 + np.arange(nx) * step; zs = z0 + np.arange(nz) * step
X, Z = np.meshgrid(xs, zs)
town = np.zeros((nz, nx), bool)
for p in W.get('pads', []):
    cx, cz = p['at']; rx, rz = p.get('rx', p.get('r', 20)), p.get('rz', p.get('r', 20))
    town |= ((X - cx) / rx) ** 2 + ((Z - cz) / rz) ** 2 < 1.0
ok = dry & ~road & ~town

bank = ndimage.binary_dilation(H < sea, iterations=4) & dry            # by the water
P = {
    'stone':   ok * (0.004 + 0.02 * mount + 0.012 * (slope > 18) + 0.03 * bank),
    'boulder': ok * (0.0004 + 0.006 * mount * (slope > 12) + 0.004 * (slope > 24)) * (slope < 50),
    'fern':    ok * (forest * 0.16) * (slope < 30) * ~mount,
    'bush':    ok * (0.004 * (K == kinds.index('green')) + 0.02 * forest * (1 - forest) * 4 + 0.006 * forest) * (slope < 32),
    'log':     ok * (0.0035 * forest) * (slope < 22),
}
SIZE = {'stone': (0.25, 0.8), 'boulder': (1.4, 4.2), 'fern': (0.6, 1.2), 'bush': (0.8, 1.8), 'log': (0.8, 1.4)}

recs = []
for k, name in enumerate(KINDS):
    hit = rng.random((nz, nx)) < P[name]
    iz, ix = np.nonzero(hit)
    x = x0 + (ix + rng.random(ix.size)) * step
    z = z0 + (iz + rng.random(iz.size)) * step
    lo, hi = SIZE[name]
    s = lo + (hi - lo) * rng.random(ix.size) ** 1.6
    r = rng.integers(0, 256, ix.size)
    recs.append(np.stack([np.round(x * 10), np.round(z * 10), np.round(s * 20), np.full(ix.size, k), r], axis=1))
    print(f"{name}: {ix.size}")
allr = np.concatenate(recs)
out = np.zeros(len(allr), dtype=np.dtype([('x', '<i2'), ('z', '<i2'), ('s', 'u1'), ('k', 'u1'), ('r', 'u1')]))
out['x'], out['z'], out['s'], out['k'], out['r'] = allr[:, 0], allr[:, 1], np.clip(allr[:, 2], 1, 255), allr[:, 3], allr[:, 4]
out.tofile(os.path.join(FLORA, 'clutter.bin'))
flora['clutter'] = {'file': 'clutter.bin', 'count': int(len(out)), 'kinds': KINDS,
                    'record': 'i16 x dm, i16 z dm, u8 size*20, u8 kind (index into kinds), u8 turn/256',
                    'tool': 'tools/bake/clutter.py'}
json.dump(flora, open(os.path.join(FLORA, 'flora.json'), 'w'), indent=1)
print('clutter:', len(out))
