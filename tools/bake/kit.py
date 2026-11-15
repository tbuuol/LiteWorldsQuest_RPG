"""Bakes the people kit: content/core/people/kit/ — two base bodies (m, f) and the parts people wear, all on one
skeleton, all with the same shape keys, so the game puts any person together from a recipe (client/src/figure.js).

    blender -b --factory-startup -noaudio --python tools/bake/kit.py -- [m|f ...]

What comes out, per base b:
  b_body.glb       the body (skin from kit/skin/*.jpg at play time), eyes, eyelashes; the skeleton
  b_<part>.glb     each part alone, skinned to the same skeleton: hair styles, brows, clothes (cloth texture from
                   kit/tex/ at play time, coloured by the recipe)
  b.json           the skeleton's joints at rest, how each shape key moves them, the parts (what each hides of the
                   body: a bit in the body's _HIDE attribute)
and once: kit/skin/*.jpg, kit/eyes/*.jpg, kit/tex/*.jpg, catalogue.json (what exists, for whom: npc / player).

Shape keys (all meshes): weight_hi, weight_lo, muscle_hi, muscle_lo, age_old, age_young (to a child of ~11),
race_african, race_asian, and face features (one key each, weights -1..1 in play). Height is the figure's scale.
Each key is the same body made by MakeHuman (MPFB 2, CC0) at that setting, every part fitted to it again; so clothes
and hair keep fitting whatever the recipe says.

The skeleton is the one of Quaternius' Universal Animation Library (CC0), bone for bone (its names, its rest
orientations, its T pose): every body is stood in that T pose (each limb along the library's bone), and that is its
rest; the joints sit where this body has them. So the library's clips play on every person as they are, nothing
converted (tools/bake/motions.py writes them, with the own body's variants)."""
import bpy, bmesh, sys, os, json, math, importlib, addon_utils, base64, shutil
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'content', 'core', 'people', 'kit')
ASSETS = os.environ.get('MHASSETS', '/root/dl/mhassets/x')
TEX = 512

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True, persistent=True)
def imp(pkg, key):
    return getattr(importlib.import_module("bl_ext.user_default." + pkg), key)
HumanService = imp("mpfb.services.humanservice", "HumanService")
AssetService = imp("mpfb.services.assetservice", "AssetService")
TargetService = imp("mpfb.services.targetservice", "TargetService")

HAIR = ['short01', 'short02', 'short03', 'short04', 'bob01', 'bob02', 'long01', 'ponytail01', 'braid01', 'afro01']
BROWS = ['eyebrow001', 'eyebrow003', 'eyebrow006', 'eyebrow009', 'eyebrow010', 'eyebrow012']
# macro settings of the bases, and of each shape key (the change from the base)
BASE = {'m': {'gender': 1.0}, 'f': {'gender': 0.0}}
NEUTRAL = {'age': 0.5, 'muscle': 0.5, 'weight': 0.5, 'height': 0.5, 'proportions': 0.5}
MACRO_KEYS = {
    'weight_hi': {'weight': 0.9}, 'weight_lo': {'weight': 0.12},
    'muscle_hi': {'muscle': 0.9}, 'muscle_lo': {'muscle': 0.15},
    'age_old': {'age': 0.92}, 'age_young': {'age': 0.1875},
    'race_african': {'race': {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}},
    'race_asian': {'race': {'african': 0.0, 'asian': 1.0, 'caucasian': 0.0}},
}
FACE_KEYS = {
    'nose_wide': ['nose/nose-scale-horiz-incr'], 'nose_long': ['nose/nose-scale-vert-incr'], 'nose_hump': ['nose/nose-hump-incr'],
    'jaw_wide': ['chin/chin-width-incr'], 'chin': ['chin/chin-prominent-incr'],
    'cheekbones': ['cheek/l-cheek-bones-incr', 'cheek/r-cheek-bones-incr'], 'mouth_wide': ['mouth/mouth-scale-horiz-incr'],
    'face_round': ['head/head-fat-incr'], 'eyes_big': ['eyes/l-eye-scale-incr', 'eyes/r-eye-scale-incr'],
}
KEYS = list(MACRO_KEYS) + list(FACE_KEYS)
UAL = os.environ.get('UAL', '/root/dl/ual/x/gltf-universal-animation-library-main/glTF/AnimationLibrary_Godot_Standard.gltf')
# MakeHuman game-engine bone -> library bone (the same 53, one each)
MH2UAL = {'Root': 'root', 'pelvis': 'DEF-hips', 'spine_01': 'DEF-spine.001', 'spine_02': 'DEF-spine.002', 'spine_03': 'DEF-spine.003',
          'neck_01': 'DEF-neck', 'head': 'DEF-head'}
for _s, _t in (('L', 'l'), ('R', 'r')):
    MH2UAL.update({f'clavicle_{_t}': f'DEF-shoulder.{_s}', f'upperarm_{_t}': f'DEF-upper_arm.{_s}', f'lowerarm_{_t}': f'DEF-forearm.{_s}',
                   f'hand_{_t}': f'DEF-hand.{_s}', f'thigh_{_t}': f'DEF-thigh.{_s}', f'calf_{_t}': f'DEF-shin.{_s}',
                   f'foot_{_t}': f'DEF-foot.{_s}', f'ball_{_t}': f'DEF-toe.{_s}'})
    for _f in ('index', 'middle', 'pinky', 'ring'):
        for _k in (1, 2, 3):
            MH2UAL[f'{_f}_0{_k}_{_t}'] = f'DEF-f_{_f}.0{_k}.{_s}'
    for _k in (1, 2, 3):
        MH2UAL[f'thumb_0{_k}_{_t}'] = f'DEF-thumb.0{_k}.{_s}'
UREST = {}     # library bone -> (world rotation 3x3, length, parent)
UORDER = []    # library bones, parents first


# ---------------------------------------------------------------- scene helpers
def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)


def hexcol(h, a=1.0):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)) + (a,)


def target_path(rel):
    d = os.path.join(os.path.dirname(importlib.import_module("bl_ext.user_default.mpfb").__file__), 'data', 'targets')
    for ext in ('.target.gz', '.target'):
        p = os.path.join(d, rel + ext)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(rel)


def make_human(base, key):
    """the human of base b at shape key `key` (None: the base itself), rigged, with eyes, lashes, brows, every hair"""
    clear()
    macro = TargetService.get_default_macro_info_dict()
    macro.update(NEUTRAL); macro.update(BASE[base])
    macro['race'] = {'african': 0.0, 'asian': 0.0, 'caucasian': 1.0}
    if key in MACRO_KEYS:
        for k, v in MACRO_KEYS[key].items():
            macro[k] = dict(v) if isinstance(v, dict) else v
    human = HumanService.create_human(macro_detail_dict=macro, mask_helpers=False)
    if key in FACE_KEYS:
        for rel in FACE_KEYS[key]:
            TargetService.load_target(human, target_path(rel), weight=1.0)
    rig = HumanService.add_builtin_rig(human, 'game_engine')
    pose_to_ual(rig)
    for sub, name, kind in [('eyes', 'low-poly', 'Eyes'), ('eyelashes', 'eyelashes01', 'Eyelashes')] + \
            [('eyebrows', b, 'Eyebrows') for b in BROWS] + [('hair', h, 'Hair') for h in HAIR]:
        p = AssetService.find_asset_absolute_path(name + '.mhclo', asset_subdir=sub)
        HumanService.add_mhclo_asset(p, human, asset_type=kind, material_type='GAMEENGINE', subdiv_levels=0)
    return human, rig


def read_ual():
    """the library's skeleton at rest: each bone's world rotation, length, parent; parents first"""
    clear()
    bpy.ops.import_scene.gltf(filepath=UAL)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    W = arm.matrix_world
    def walk(b):
        UORDER.append(b.name)
        for c in b.children:
            walk(c)
    for b in arm.data.bones:
        if not b.parent:
            walk(b)
    for b in arm.data.bones:
        UREST[b.name] = ((W @ b.matrix_local).to_quaternion().to_matrix(), b.length * W.to_scale().x, b.parent.name if b.parent else None)
    clear()


def pose_to_ual(rig):
    """stand the MakeHuman body in the library's T pose: top down, every bone turned (the least turn) to point as the
    library's bone points. Root and hips keep theirs (they only carry the whole and the pelvis' blob)"""
    Rr = rig.matrix_world.to_quaternion().to_matrix()
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    def walk(b):
        yield b
        for c in b.children:
            yield from walk(c)
    for b in [x for r in rig.data.bones if not r.parent for x in walk(r)]:
        if b.name in ('Root', 'pelvis') or MH2UAL.get(b.name) not in UREST:
            continue
        bpy.context.view_layer.update()
        pb = rig.pose.bones[b.name]
        cur = pb.matrix.copy()
        d_now = (cur.to_3x3() @ Vector((0, 1, 0))).normalized()
        d_want = (Rr.inverted() @ (UREST[MH2UAL[b.name]][0] @ Vector((0, 1, 0)))).normalized()
        new = d_now.rotation_difference(d_want).to_matrix() @ cur.to_3x3()
        pb.matrix = Matrix.Translation(cur.translation) @ new.to_4x4()
    bpy.context.view_layer.update()


def ual_rig(J):
    """the export skeleton: the library's bones (names, rest rotations, hierarchy) with this body's joints and lengths"""
    arm = bpy.data.armatures.new('Rig')
    ob = bpy.data.objects.new('Rig', arm)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    ual2mh = {v: k for k, v in MH2UAL.items()}
    eb_of = {}
    for name in UORDER:
        R, ulen, parent = UREST[name]
        head, length = J[ual2mh[name]]
        eb = arm.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(head) + R @ Vector((0, max(length, 0.01), 0))
        eb.align_roll(R @ Vector((0, 0, 1)))
        if parent:
            eb.parent = eb_of[parent]
        eb_of[name] = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def proxies(human, rig):
    """the fitted assets by name: 'hair:short02', 'brows:eyebrow001', 'eyes', 'lashes'"""
    out = {}
    for o in set(human.children) | set(rig.children):
        if o.type != 'MESH' or o is human:
            continue
        n = o.name.lower()
        for h in HAIR:
            if h in n:
                out['hair:' + h] = o
        for b in BROWS:
            if b in n:
                out['brows:' + b] = o
        if 'low-poly' in n:
            out['eyes'] = o
        if 'eyelashes' in n:
            out['lashes'] = o
    return out


def coords(obj):
    """world coordinates of every vertex as it stands in the T pose (shape keys and the armature applied, nothing else)"""
    mods = [(m, m.show_viewport) for m in obj.modifiers]
    for m, _ in mods:
        m.show_viewport = m.type == 'ARMATURE'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    for m, v in mods:
        m.show_viewport = v
    M = obj.matrix_world
    a = np.array([tuple(M @ v.co) for v in me.vertices], np.float64)
    bpy.data.meshes.remove(me)
    return a


def joints(rig):
    """each MakeHuman bone in the T pose: its head (world) and its length"""
    W = rig.matrix_world
    sc = W.to_scale().x
    return {b.name: (tuple(W @ rig.pose.bones[b.name].head), b.length * sc) for b in rig.data.bones}


def frozen_copy(obj, name):
    """the object as it stands, without modifiers, keeping its vertex groups and UVs; an int attribute 'src' holds
    each vertex's index in the original (to take the same vertex from another shape)"""
    mods = [(m, m.show_viewport) for m in obj.modifiers]
    for m, _ in mods:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    for m, v in mods:
        m.show_viewport = v
    me.materials.clear()
    if me.shape_keys:
        pass
    a = me.attributes.new('src', 'INT', 'POINT')
    a.data.foreach_set('value', np.arange(len(me.vertices), dtype=np.int32))
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.matrix_world = obj.matrix_world.copy()
    for g in obj.vertex_groups:
        o.vertex_groups.new(name=g.name)
    return o


def src_of(o):
    a = np.zeros(len(o.data.vertices), np.int32)
    o.data.attributes['src'].data.foreach_get('value', a)
    return a


def keep(o, test):
    """keep only vertices where test(world_co, {group_name: weight}) holds"""
    names = {g.index: g.name for g in o.vertex_groups}
    bm = bmesh.new(); bm.from_mesh(o.data)
    dl = bm.verts.layers.deform.active
    M = o.matrix_world
    kill = [v for v in bm.verts if not test(M @ v.co, {names[k]: w for k, w in v[dl].items()} if dl else {})]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(o.data); bm.free()


def set_coords(o, world):
    Mi = o.matrix_world.inverted()
    for v, p in zip(o.data.vertices, world):
        v.co = Mi @ Vector(p)
    o.data.update()


def loosen(o, base, smooth=6, factor=0.5, extra_group=None, extra=0.0):
    """cloth, not paint: out along the normals, plus `extra` where a group pulls (sleeves), then smoothed so the body's
    shapes melt into hanging cloth; the open edges stay"""
    me = o.data; me.update()
    gi = {g.index for g in o.vertex_groups if extra_group and g.name.startswith(extra_group)}
    for v in me.vertices:
        f = sum(g.weight for g in v.groups if g.group in gi) if gi else 0.0
        v.co += v.normal * (base + extra * f)
    bm = bmesh.new(); bm.from_mesh(me)
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(me); bm.free(); me.update()


def world_coords(o):
    M = o.matrix_world
    return np.array([tuple(M @ v.co) for v in o.data.vertices], np.float64)


# ---------------------------------------------------------------- the parts, as recipes over a human
# each garment: which helper, which vertices (decided once on the base), how it stands off the body
def garment_specs(J):
    z = lambda b: J[b][0][2]
    pelvis, neck = z('pelvis'), z('neck_01')
    knee, ankle = (z('calf_l') + z('calf_r')) / 2, (z('foot_l') + z('foot_r')) / 2
    hem = knee + 0.45 * (pelvis - knee)
    boot = ankle + 0.62 * (knee - ankle)
    arm = ('upperarm_', 'lowerarm_', 'clavicle_')
    hand = ('hand_', 'index_', 'middle_', 'ring_', 'pinky_', 'thumb_')
    foot = ('foot_', 'ball_')
    w = lambda g, names: sum(x for n, x in g.items() if n.startswith(names))
    return {
        # upper body and sleeves to the wrist, to just under the hips
        'shirt': dict(helper='helper-tights', loosen=(0.016, 8), sleeve=0.008,
                      test=lambda p, g: (p.z >= pelvis - 0.02 or w(g, arm + hand) > 0.3) and w(g, hand) < 0.25 and p.z < neck + 0.015),
        # the skirt of a tunic, to mid-thigh
        'tunic_skirt': dict(helper='helper-skirt', loosen=(0.012, 4), test=lambda p, g: hem <= p.z <= pelvis + 0.02),
        # a long skirt / the lower half of a robe, to the ankles
        'skirt_long': dict(helper='helper-skirt', loosen=(0.012, 4), test=lambda p, g: ankle + 0.06 <= p.z <= pelvis + 0.02),
        'trousers': dict(helper='helper-tights', loosen=(0.011, 6),
                         test=lambda p, g: boot - 0.12 <= p.z < pelvis + 0.03 and w(g, foot) < 0.3 and w(g, arm + hand) < 0.3),
        'boots_high': dict(helper='helper-tights', loosen=(0.014, 3), test=lambda p, g: p.z <= boot and w(g, arm + hand) < 0.3),
        'boots_low': dict(helper='helper-tights', loosen=(0.012, 3), test=lambda p, g: p.z <= ankle + 0.12 and w(g, arm + hand) < 0.3),
        'apron': dict(helper='helper-skirt', loosen=(0.03, 3), front=True,
                      test=lambda p, g: knee - 0.1 <= p.z <= pelvis + 0.02),
    }, (pelvis + 0.04, pelvis + 0.10)


def build_garment(human, name, spec, front_y=None):
    o = frozen_copy(human, name)
    hg = spec['helper']
    keep(o, lambda p, g: g.get(hg, 0) > 0 and spec['test'](p, g) and (front_y is None or p.y < front_y))
    return o


def shape_garment(o, full_world, spec):
    """the garment at another shape: its vertices from that shape's helper, then stood off the body the same way"""
    set_coords(o, full_world[src_of(o)])
    b, s = spec['loosen']
    loosen(o, b, smooth=s, extra_group='lowerarm_' if spec.get('sleeve') else None, extra=spec.get('sleeve', 0.0))
    return world_coords(o)


def belt_ring(tunic_world, arm_mask, zr, center, bins=48):
    """a leather band around the shirt between the heights zr: per direction, just outside the shirt's farthest
    point there. Returns ring vertices (2*bins) and, per vertex, the shirt vertex it moves with"""
    cx, cy = center
    sel = [i for i, p in enumerate(tunic_world) if zr[0] - 0.04 <= p[2] <= zr[1] + 0.04 and not arm_mask[i]]
    rad = [0.0] * bins
    for i in sel:
        p = tunic_world[i]
        a = int((math.atan2(p[1] - cy, p[0] - cx) + math.pi) / (2 * math.pi) * bins) % bins
        rad[a] = max(rad[a], math.hypot(p[0] - cx, p[1] - cy))
    for _ in range(3):
        rad = [max(rad[i], 0.5 * (rad[i - 1] + rad[(i + 1) % bins])) for i in range(bins)]
    ring = []
    for z in zr:
        for i in range(bins):
            a = (i + 0.5) / bins * 2 * math.pi - math.pi
            ring.append((cx + math.cos(a) * (rad[i] + 0.006), cy + math.sin(a) * (rad[i] + 0.006), z))
    return np.array(ring), sel


# ---------------------------------------------------------------- textures (once)
def save_jpg(src, dst, size, gray=False, alpha_png=False):
    im = bpy.data.images.load(src)
    if im.size[0] > size:
        im.scale(size, max(1, int(im.size[1] * size / im.size[0])))
    if gray:
        px = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(px); px = px.reshape(-1, 4)
        lum = px[:, :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        ref = np.percentile(lum[px[:, 3] > 0.5], 70) if (px[:, 3] > 0.5).any() else 0.5
        v = np.clip(0.82 + 0.4 * (np.clip(lum / max(ref, 1e-4), 0, 1.6) - 1.0), 0.45, 1.15) / 1.15
        px[:, 0] = px[:, 1] = px[:, 2] = v
        im.pixels.foreach_set(px.ravel())
    im.filepath_raw = dst
    im.file_format = 'PNG' if alpha_png else 'JPEG'
    bpy.context.scene.render.image_settings.quality = 85
    im.save()
    bpy.data.images.remove(im)


def cloth_texture(path, n=256, seed=1, leather=False):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n] / n * 2 * np.pi
    def smooth_noise(k):
        f = np.fft.fft2(rng.normal(0, 1, (n, n)))
        fy, fx = np.meshgrid(np.fft.fftfreq(n), np.fft.fftfreq(n), indexing='ij')
        g = np.real(np.fft.ifft2(f * np.exp(-(fx ** 2 + fy ** 2) * k)))
        return (g - g.mean()) / (g.std() + 1e-9)
    if leather:
        v = 0.86 + 0.07 * smooth_noise(20000) + 0.05 * smooth_noise(300000) + 0.02 * rng.normal(0, 1, (n, n))
    else:
        v = 0.86 + 0.06 * (0.5 + 0.5 * np.sin(x * 48)) + 0.04 * (0.5 + 0.5 * np.sin(y * 48)) + 0.04 * smooth_noise(4000) + 0.03 * smooth_noise(60000)
    v = np.clip(v, 0, 1)
    im = bpy.data.images.new('t', n, n, alpha=False)
    px = np.zeros((n, n, 4), np.float32); px[..., 0] = px[..., 1] = px[..., 2] = v; px[..., 3] = 1
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = path; im.file_format = 'JPEG'; im.save()
    bpy.data.images.remove(im)


def textures():
    for d in ('skin', 'eyes', 'tex', 'hair'):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    skins = []
    for sd in sorted(os.listdir(os.path.join(ASSETS, 'skins'))):
        mat = os.path.join(ASSETS, 'skins', sd, sd + '.mhmat')
        if not os.path.exists(mat) or 'special' in sd or 'toon' in sd:
            continue
        tex = [l.split(None, 1)[1].strip() for l in open(mat) if l.startswith('diffuseTexture')]
        if not tex:
            continue
        save_jpg(os.path.join(ASSETS, 'skins', sd, os.path.basename(tex[0])), os.path.join(OUT, 'skin', sd + '.jpg'), 1024)
        skins.append(sd)
    eyes = []
    for f in sorted(os.listdir(os.path.join(ASSETS, 'eyes', 'materials'))):
        if f.endswith('_eye.png'):
            save_jpg(os.path.join(ASSETS, 'eyes', 'materials', f), os.path.join(OUT, 'eyes', f[:-8] + '.jpg'), 256)
            eyes.append(f[:-8])
    for h in HAIR:
        d = os.path.join(ASSETS, 'hair', h)
        png = [f for f in os.listdir(d) if f.endswith('_diffuse.png') or (f.endswith('.png') and 'normal' not in f and 'thumb' not in f)]
        save_jpg(os.path.join(d, png[0]), os.path.join(OUT, 'hair', h + '.png'), TEX, gray=True, alpha_png=True)
    for b in BROWS:
        d = os.path.join(ASSETS, 'eyebrows', b)
        png = [f for f in os.listdir(d) if f.endswith('.png') and 'thumb' not in f]
        save_jpg(os.path.join(d, png[0]), os.path.join(OUT, 'hair', b + '.png'), 256, gray=True, alpha_png=True)
    d = os.path.join(ASSETS, 'eyelashes', 'eyelashes01')
    save_jpg(os.path.join(d, 'eyelashes01.png'), os.path.join(OUT, 'hair', 'eyelashes01.png'), 256, alpha_png=True)
    cloth_texture(os.path.join(OUT, 'tex', 'linen.jpg'), seed=3)
    cloth_texture(os.path.join(OUT, 'tex', 'leather.jpg'), seed=5, leather=True)
    return skins, eyes


# ---------------------------------------------------------------- one base, all its keys
def to_gltf(p):
    return [round(p[0], 5), round(p[2], 5), round(-p[1], 5)]


def bake_base(b):
    print(f'== base {b}')
    # every shape: the full basemesh, every proxy, the joints
    shapes = {}
    for key in [None] + KEYS:
        human, rig = make_human(b, key)
        P = proxies(human, rig)
        shapes[key] = dict(body=coords(human), prox={n: coords(o) for n, o in P.items()}, joints=joints(rig))
        print(f'  shape {key or "base"}: {len(shapes[key]["body"])} vertices, {len(P)} assets')
    # the base again: it stays in the scene and is what gets exported
    human, rig = make_human(b, None)
    P = proxies(human, rig)
    J = shapes[None]['joints']
    specs, belt_z = garment_specs(J)
    pel = J['pelvis'][0]
    objs = {}

    # garments: made on the base, then made again from every shape's helper vertices
    for name, spec in specs.items():
        front = pel[1] - 0.03 if spec.get('front') else None
        o = build_garment(human, name, spec, front)
        keyed = {}
        for key in [None] + KEYS:
            keyed[key] = shape_garment(o, shapes[key]['body'], spec)
        set_coords(o, keyed[None])
        objs[name] = (o, keyed)
    # the tunic = shirt + its skirt (one part); a robe = shirt + long skirt (in the recipe)
    # belt: a ring around the shirt, each ring vertex weighted as the nearest shirt vertex
    shirt, sk = objs['shirt']
    armg = {g.index for g in shirt.vertex_groups if g.name.startswith(('upperarm_', 'lowerarm_', 'hand_', 'clavicle_'))}
    arm_mask = [sum(g.weight for g in v.groups if g.group in armg) > 0.2 for v in shirt.data.vertices]
    ring0, sel = belt_ring(sk[None], arm_mask, belt_z, (pel[0], pel[1]))
    kd = KDTree(len(sel))
    for j, i in enumerate(sel):
        kd.insert(Vector(sk[None][i]), j)
    kd.balance()
    near = [sel[kd.find(Vector(p))[1]] for p in ring0]
    me = bpy.data.meshes.new('belt'); belt = bpy.data.objects.new('belt', me); bpy.context.collection.objects.link(belt)
    bins = len(ring0) // 2
    me.from_pydata([tuple(p) for p in ring0], [], [(i, (i + 1) % bins, bins + (i + 1) % bins, bins + i) for i in range(bins)])
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = ((vi % bins) / bins * 8, (vi // bins) * 0.25)
    for g in shirt.vertex_groups:
        belt.vertex_groups.new(name=g.name)
    for vi, si in enumerate(near):
        for g in shirt.data.vertices[si].groups:
            belt.vertex_groups[g.group].add([vi], g.weight, 'REPLACE')
    bk = {}
    for key in [None] + KEYS:
        # at that shape: around its own hips (a child's are lower), same directions
        pk = shapes[key]['joints']['pelvis'][0]
        r, _ = belt_ring(sk[key], arm_mask, (belt_z[0] - pel[2] + pk[2], belt_z[1] - pel[2] + pk[2]), (pk[0], pk[1]))
        bk[key] = r
    objs['belt'] = (belt, bk)

    # body, eyes, lashes, brows, hair: the proxies themselves, at every shape
    body = frozen_copy(human, 'body')
    keep(body, lambda p, g: g.get('body', 0) > 0)
    src = src_of(body)
    objs['body'] = (body, {k: shapes[k]['body'][src] for k in [None] + KEYS})
    for n, o in P.items():
        c = frozen_copy(o, n.replace(':', '_'))
        objs[n] = (c, {k: shapes[k]['prox'][n] for k in [None] + KEYS})

    # what each garment hides of the body: the body's vertices under it, not at its edge
    hide_bits, garments = {}, ['shirt', 'tunic_skirt', 'skirt_long', 'trousers', 'boots_high', 'boots_low', 'apron', 'belt']
    bodyw = objs['body'][1][None]
    hide = np.zeros(len(bodyw), np.int32)
    for bit, name in enumerate(garments):
        o, k = objs[name]
        pts = k[None]
        kd = KDTree(len(pts))
        for i, p in enumerate(pts):
            kd.insert(Vector(p), i)
        kd.balance()
        bm = bmesh.new(); bm.from_mesh(o.data)
        edge = [Vector(pts[v.index]) for v in bm.verts if v.is_boundary]; bm.free()
        ke = KDTree(max(1, len(edge)))
        for i, p in enumerate(edge or [Vector((1e6, 0, 0))]):
            ke.insert(p, i)
        ke.balance()
        lim = 0.05 if name != 'apron' else 0.0   # an apron hides nothing (it is over other clothes)
        for i, p in enumerate(bodyw):
            v = Vector(p)
            if kd.find(v)[2] < lim and ke.find(v)[2] > 0.045:
                hide[i] |= 1 << bit
        hide_bits[name] = bit
    a = body.data.attributes.new('_HIDE', 'FLOAT', 'POINT')
    a.data.foreach_set('value', hide.astype(np.float32))

    # the export skeleton; shape keys on everything; rigged to it; exported one file each
    mhrig = rig
    rig = ual_rig(J)
    for name, (o, keyed) in objs.items():
        set_coords(o, keyed[None])
        o.shape_key_add(name='Basis', from_mix=False)
        Mi = o.matrix_world.inverted()
        for key in KEYS:
            sk_ = o.shape_key_add(name=key, from_mix=False)
            d = np.array([tuple(Mi @ Vector(p)) for p in keyed[key]], np.float32)
            sk_.data.foreach_set('co', d.ravel())
        for g in list(o.vertex_groups):
            if g.name in MH2UAL:
                g.name = MH2UAL[g.name]
            else:
                o.vertex_groups.remove(g)
        o.parent = rig
        o.matrix_parent_inverse = rig.matrix_world.inverted()
        m = o.modifiers.new('rig', 'ARMATURE'); m.object = rig
        mat = bpy.data.materials.new(name); o.data.materials.clear(); o.data.materials.append(mat)
    # nothing else of MPFB's in the scene but the rig and ours
    for o in list(bpy.data.objects):
        if o is not rig and o.name not in {x[0].name for x in objs.values()}:   # MakeHuman's rig and body go
            bpy.data.objects.remove(o, do_unlink=True)

    def export(path, items):
        bpy.ops.object.select_all(action='DESELECT')
        rig.select_set(True)
        for o in items:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_animations=False,
                                  export_yup=True, export_apply=False, export_skins=True, export_morph=True,
                                  export_morph_normal=False, export_try_sparse_sk=True, export_def_bones=False,
                                  export_attributes=True, export_materials='PLACEHOLDER', export_image_format='NONE')
        return os.path.getsize(path) // 1024
    sizes = {}
    sizes['body'] = export(os.path.join(OUT, f'{b}_body.glb'), [objs['body'][0], objs['eyes'][0], objs['lashes'][0]])
    for name in garments:
        sizes[name] = export(os.path.join(OUT, f'{b}_{name}.glb'), [objs[name][0]])
    for n in P:
        if n.startswith(('hair:', 'brows:')):
            sizes[n] = export(os.path.join(OUT, f'{b}_{n.replace(":", "_")}.glb'), [objs[n][0]])
    print('  sizes kB', sizes)

    # joints at rest, and how each key moves them (glTF axes)
    jbase = {MH2UAL[n]: to_gltf(h) for n, (h, l) in J.items()}
    jkeys = {}
    for key in KEYS:
        d = {}
        for n, (h, l) in shapes[key]['joints'].items():
            dd = [a - c for a, c in zip(to_gltf(h), jbase[MH2UAL[n]])]
            if max(abs(x) for x in dd) > 1e-4:
                d[MH2UAL[n]] = [round(x, 5) for x in dd]
        jkeys[key] = d
    json.dump({'base': b, 'keys': KEYS, 'joints': jbase, 'jointKeys': jkeys, 'hideBits': hide_bits,
               'height': round(max(p[2] for p in bodyw) - min(p[2] for p in bodyw), 4)},
              open(os.path.join(OUT, f'{b}.json'), 'w'), indent=1)


argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
os.makedirs(OUT, exist_ok=True)
read_ual()
skins, eyes = textures()
print('skins', skins); print('eyes', eyes)
json.dump({'skins': skins, 'eyes': eyes, 'hair': HAIR, 'brows': BROWS}, open(os.path.join(OUT, 'assets.json'), 'w'), indent=1)
for b in argv or ['m', 'f']:
    bake_base(b)
