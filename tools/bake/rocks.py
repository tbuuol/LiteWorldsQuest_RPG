#!/usr/bin/env python3
"""Makes the CC0 rock models (Poly Haven, glTF 1k) light enough to draw by the thousand: quadric edge collapse down to
a few thousand triangles (fast-simplification), UVs kept through the collapse map, normals recomputed; the 1k
textures stay and carry the detail. Writes content/core/assets/rocks/<name>/<name>.gltf (+ .bin, textures, SOURCE.json).

    python3 tools/bake/rocks.py <downloaded-dir> [name:triangles ...]"""
import json, os, shutil, struct, sys
import numpy as np
import fast_simplification as fs

SRC = sys.argv[1]
WANT = dict(a.split(':') for a in (sys.argv[2:] or ['rock_07:2400', 'rock_09:2400']))   # closed scans only (rock_face_* are open surfaces)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'content', 'core', 'assets', 'rocks')
CT = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def read(g, binv, ai):
    a = g['accessors'][ai]; bv = g['bufferViews'][a['bufferView']]
    fmt, size = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', size * n)
    out = np.zeros((a['count'], n), dtype=np.float64)
    for i in range(a['count']):
        out[i] = struct.unpack_from('<' + fmt * n, binv, off + i * stride)
    return out

for name, tris in WANT.items():
    d = os.path.join(SRC, name)
    g = json.load(open(os.path.join(d, name + '.gltf')))
    binv = open(os.path.join(d, g['buffers'][0]['uri']), 'rb').read()
    P, UV, F, base = [], [], [], 0
    for node in g['nodes']:   # every mesh, in its node's place (scale/rotation/translation of the node)
        if 'mesh' not in node: continue
        for prim in g['meshes'][node['mesh']]['primitives']:
            p = read(g, binv, prim['attributes']['POSITION'])
            if 'scale' in node: p *= np.array(node['scale'])
            if 'translation' in node: p += np.array(node['translation'])
            uv = read(g, binv, prim['attributes']['TEXCOORD_0'])
            f = read(g, binv, prim['indices']).astype(np.int64).reshape(-1, 3)
            P.append(p); UV.append(uv); F.append(f + base); base += len(p)
    P, UV, F = np.concatenate(P), np.concatenate(UV), np.concatenate(F)
    target = 1 - int(tris) / len(F)
    p2, f2, collapses = fs.simplify(P.astype(np.float32), F.astype(np.int32), target_reduction=target, return_collapses=True)
    _, _, mapping = fs.replay_simplification(P.astype(np.float32), F.astype(np.int32), collapses)
    uv2 = np.zeros((len(p2), 2), dtype=np.float32)
    seen = np.zeros(len(p2), bool)
    for old, new in enumerate(mapping):   # each new vertex takes the UV of a vertex it came from
        if not seen[new]: uv2[new] = UV[old]; seen[new] = True
    # normals: area weighted from the faces
    n2 = np.zeros_like(p2, dtype=np.float64)
    tri = p2[f2]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for k in range(3): np.add.at(n2, f2[:, k], fn)
    n2 /= np.maximum(np.linalg.norm(n2, axis=1, keepdims=True), 1e-9)
    # centre on the ground: x/z around 0, the lowest point at y = 0
    p2 = p2.astype(np.float64); p2[:, [0, 2]] -= (p2[:, [0, 2]].max(0) + p2[:, [0, 2]].min(0)) / 2; p2[:, 1] -= p2[:, 1].min()
    o = os.path.join(OUT, name); os.makedirs(os.path.join(o, 'textures'), exist_ok=True)
    for t in os.listdir(os.path.join(d, 'textures')):
        shutil.copy(os.path.join(d, 'textures', t), os.path.join(o, 'textures', t))
    blobs = [p2.astype('<f4').tobytes(), n2.astype('<f4').tobytes(), uv2.astype('<f4').tobytes(), f2.astype('<u4').tobytes()]
    offs = np.cumsum([0] + [len(b) for b in blobs])
    open(os.path.join(o, name + '.bin'), 'wb').write(b''.join(blobs))
    mat = g['materials'][g['meshes'][g['nodes'][[i for i, n in enumerate(g['nodes']) if 'mesh' in n][0]]['mesh']]['primitives'][0].get('material', 0)]
    out = {'asset': {'version': '2.0', 'generator': 'LiteWorldsQuest tools/bake/rocks.py'},
           'buffers': [{'uri': name + '.bin', 'byteLength': int(offs[-1])}],
           'bufferViews': [{'buffer': 0, 'byteOffset': int(offs[i]), 'byteLength': len(blobs[i])} for i in range(4)],
           'accessors': [
               {'bufferView': 0, 'componentType': 5126, 'count': len(p2), 'type': 'VEC3', 'min': p2.min(0).tolist(), 'max': p2.max(0).tolist()},
               {'bufferView': 1, 'componentType': 5126, 'count': len(p2), 'type': 'VEC3'},
               {'bufferView': 2, 'componentType': 5126, 'count': len(p2), 'type': 'VEC2'},
               {'bufferView': 3, 'componentType': 5125, 'count': f2.size, 'type': 'SCALAR'}],
           'images': g['images'], 'textures': g['textures'], 'samplers': g.get('samplers', [{}]),
           'materials': [mat],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
           'nodes': [{'mesh': 0, 'name': name}], 'scenes': [{'nodes': [0]}], 'scene': 0}
    json.dump(out, open(os.path.join(o, name + '.gltf'), 'w'))
    json.dump({'source': f'Poly Haven {name} (CC0 1.0), https://polyhaven.com/a/{name}', 'license': 'CC0 1.0',
               'simplified': f'{len(F)} -> {len(f2)} triangles by tools/bake/rocks.py'}, open(os.path.join(o, 'SOURCE.json'), 'w'))
    size = p2.max(0) - p2.min(0)
    print(f'{name}: {len(F)} -> {len(f2)} triangles, size {size.round(2).tolist()} m')
