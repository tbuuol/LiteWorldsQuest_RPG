"""Bakes the villagers of content/core/places/*.json and the players' figures (content/core/people/players.json) into
animated figures: content/core/people/<id>.glb.

A MakeHuman body (MPFB 2, CC0 assets) shaped by the npc's "body" (gender, age, muscle, weight, height), its skin, eyes,
brows and hair; clothes cut from the body's own helper hulls (tights -> shirt and trousers, skirt -> robe or apron) in
the colours of its "look"; the game-engine skeleton; and the motions of Quaternius' Universal Animation Library (CC0)
carried over onto that skeleton (idle, talk, walk, run). Runs in Blender, without a screen:

    blender -b --factory-startup -noaudio --python tools/bake/people.py -- [npc-id ...]

Needs the MPFB extension (user_default/mpfb) with the makehuman_system_assets pack in its user data, and the UAL glTF
at $UAL (default /root/dl/ual/x/gltf-universal-animation-library-main/glTF/AnimationLibrary_Godot_Standard.gltf)."""
import bpy, bmesh, sys, os, glob, json, importlib, addon_utils, math
import numpy as np
from mathutils import Matrix, Vector, Quaternion
from mathutils.kdtree import KDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'content', 'core', 'people')
UAL = os.environ.get('UAL', '/root/dl/ual/x/gltf-universal-animation-library-main/glTF/AnimationLibrary_Godot_Standard.gltf')
CLIPS = {'idle': 'Idle_Loop', 'talk': 'Idle_Talking_Loop', 'walk': 'Walk_Loop', 'run': 'Jog_Fwd_Loop', 'jump': 'Jump_Loop', 'sprint': 'Sprint_Loop'}
TEX = 512   # texture size in the game

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True, persistent=True)
def imp(pkg, key):
    for m in list(sys.modules):
        if m.endswith(pkg):
            return getattr(importlib.import_module(m), key)
    raise ValueError(pkg)
HumanService = imp("mpfb.services.humanservice", "HumanService")
AssetService = imp("mpfb.services.assetservice", "AssetService")
TargetService = imp("mpfb.services.targetservice", "TargetService")

# UAL (Rigify DEF bones) -> MakeHuman game_engine bones
MAP = {'DEF-hips': 'pelvis', 'DEF-spine.001': 'spine_01', 'DEF-spine.002': 'spine_02', 'DEF-spine.003': 'spine_03',
       'DEF-neck': 'neck_01', 'DEF-head': 'head'}
for s, t in (('L', 'l'), ('R', 'r')):
    MAP.update({f'DEF-shoulder.{s}': f'clavicle_{t}', f'DEF-upper_arm.{s}': f'upperarm_{t}', f'DEF-forearm.{s}': f'lowerarm_{t}',
                f'DEF-hand.{s}': f'hand_{t}', f'DEF-thigh.{s}': f'thigh_{t}', f'DEF-shin.{s}': f'calf_{t}',
                f'DEF-foot.{s}': f'foot_{t}', f'DEF-toe.{s}': f'ball_{t}'})
    for f in ('index', 'middle', 'pinky', 'ring'):
        for k in (1, 2, 3):
            MAP[f'DEF-f_{f}.0{k}.{s}'] = f'{f}_0{k}_{t}'
    for k in (1, 2, 3):
        MAP[f'DEF-thumb.0{k}.{s}'] = f'thumb_0{k}_{t}'


def rot(m):
    """the pure rotation of a matrix (no scale)"""
    return m.to_quaternion().to_matrix()


def hexcol(h, a=1.0):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x ** 2.2 for x in c] + [a]   # sRGB -> linear


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)


# ---------------------------------------------------------------- the motions, read once from the library
def read_source():
    clear()
    bpy.ops.import_scene.gltf(filepath=UAL)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    W = arm.matrix_world
    rest = {b.name: (W @ b.matrix_local) for b in arm.data.bones if b.name in MAP}
    print('  library armature scale', tuple(round(v, 4) for v in W.to_scale()))
    clips = {}
    scene = bpy.context.scene
    for key, name in CLIPS.items():
        act = bpy.data.actions[name]
        arm.animation_data.action = act
        if hasattr(arm.animation_data, 'action_slot') and act.slots:
            arm.animation_data.action_slot = act.slots[0]
        f0, f1 = (int(round(v)) for v in act.frame_range)
        frames = []
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            frames.append({b: (W @ arm.pose.bones[b].matrix).copy() for b in MAP})
        clips[key] = frames
        print(f'  motion {key}: {name}, {len(frames)} frames')
    fps = scene.render.fps / scene.render.fps_base
    clear()
    return rest, clips, fps


# ---------------------------------------------------------------- a body
def make_body(n):
    b = n.get('body', {})
    macro = TargetService.get_default_macro_info_dict()
    for k in ('gender', 'age', 'muscle', 'weight', 'height', 'proportions'):
        if k in b:
            macro[k] = b[k]
    macro['race'] = {'african': 0.0, 'asian': 0.0, 'caucasian': 1.0}
    macro['race'].update(b.get('race', {}))
    human = HumanService.create_human(macro_detail_dict=macro)
    rig = HumanService.add_builtin_rig(human, 'game_engine')
    skin = AssetService.find_asset_absolute_path(b.get('skin', 'young_caucasian_male') + '.mhmat', asset_subdir='skins')
    HumanService.set_character_skin(skin, human, skin_type='GAMEENGINE')
    for sub, f, kind in (('eyes', 'low-poly.mhclo', 'Eyes'), ('eyebrows', b.get('brows', 'eyebrow001') + '.mhclo', 'Eyebrows'),
                         ('eyelashes', 'eyelashes01.mhclo', 'Eyelashes')) \
            + ((('hair', b['hair'] + '.mhclo', 'Hair'),) if b.get('hair') else ()):
        p = AssetService.find_asset_absolute_path(f, asset_subdir=sub)
        HumanService.add_mhclo_asset(p, human, asset_type=kind, material_type='GAMEENGINE', subdiv_levels=0)
    return human, rig


def frozen_copy(obj, name):
    """the object as it stands (shape keys applied), without modifiers, keeping its vertex groups"""
    mods = [(m, m.show_viewport) for m in obj.modifiers]
    for m, _ in mods:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    for m, v in mods:
        m.show_viewport = v
    me.materials.clear()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.matrix_world = obj.matrix_world.copy()
    for g in obj.vertex_groups:
        o.vertex_groups.new(name=g.name)
    return o


def keep_group(o, group, extra=None):
    """keep only the vertices of a vertex group (and, if given, where extra(v_co, weights) says so)"""
    gi = o.vertex_groups[group].index
    bm = bmesh.new(); bm.from_mesh(o.data)
    dl = bm.verts.layers.deform.active
    kill = [v for v in bm.verts if gi not in v[dl] or (extra and not extra(v, v[dl]))]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(o.data); bm.free()


def cloth_image(name, rgba, n=256, seed=1):
    """linen-like: threads both ways, slubs, a little fading; tiles"""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n] / n * 2 * np.pi
    warp = 0.5 + 0.5 * np.sin(x * 48 + rng.normal(0, 0.15, (n, 1)).cumsum(0) * 0.0)
    weft = 0.5 + 0.5 * np.sin(y * 48)
    def smooth_noise(k):
        f = np.fft.fft2(rng.normal(0, 1, (n, n)))
        fy, fx = np.meshgrid(np.fft.fftfreq(n), np.fft.fftfreq(n), indexing='ij')
        g = np.real(np.fft.ifft2(f * np.exp(-(fx ** 2 + fy ** 2) * k)))
        return (g - g.mean()) / (g.std() + 1e-9)
    v = 0.82 + 0.1 * (warp * 0.6 + weft * 0.4) + 0.05 * smooth_noise(4000) + 0.04 * smooth_noise(60000)
    img = np.zeros((n, n, 4), np.float32)
    srgb = [x ** (1 / 2.2) for x in rgba[:3]]
    for c in range(3):
        img[..., c] = np.clip(v * srgb[c], 0, 1)
    img[..., 3] = 1
    im = bpy.data.images.new(name, n, n, alpha=False)
    im.pixels.foreach_set(img.ravel())
    im.pack()
    return im


def material(name, rgba, rough=0.9, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = rgba
    if metal == 0.0:
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = cloth_image(name + '_cloth', rgba, seed=abs(hash(name)) % 1000)
        m.node_tree.links.new(t.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


def push_out(o, d):
    """move every vertex d metres along its normal (the cloth sits on the skin, not in it)"""
    me = o.data
    me.update()
    for v in me.vertices:
        v.co += v.normal * d


def loosen(o, base, extra=None, smooth=6, factor=0.5):
    """cloth, not paint: out along the normals (base metres, plus extra(v_world) where given), then smoothed so the
    body's shapes (chest, seat, knee caps) melt into a hanging cloth; the open edges stay where they are"""
    me = o.data; me.update()
    for v in me.vertices:
        d = base + (extra(o.matrix_world @ v.co) if extra else 0.0)
        v.co += v.normal * d
    bm = bmesh.new(); bm.from_mesh(me)
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(me); bm.free(); me.update()


def belt_band(tunic, zr, rig, bins=48):
    """a leather band around the tunic between the heights zr: per direction around the waist, just outside the
    tunic's farthest point there; each ring vertex moves with the tunic vertex nearest to it"""
    cx, cy = (rig.matrix_world @ rig.data.bones['pelvis'].head_local).xy
    arm = {g.index for g in tunic.vertex_groups if g.name.startswith(('upperarm_', 'lowerarm_', 'hand_', 'clavicle_'))}
    pts = []
    for v in tunic.data.vertices:
        p = tunic.matrix_world @ v.co
        if zr[0] - 0.04 <= p.z <= zr[1] + 0.04 and sum(g.weight for g in v.groups if g.group in arm) < 0.2:
            pts.append((p, v))
    rad = [0.0] * bins
    for p, _ in pts:
        a = int((math.atan2(p.y - cy, p.x - cx) + math.pi) / (2 * math.pi) * bins) % bins
        rad[a] = max(rad[a], math.hypot(p.x - cx, p.y - cy))
    for _ in range(3):   # fill gaps, smooth the outline
        rad = [max(rad[i], 0.5 * (rad[i - 1] + rad[(i + 1) % bins])) for i in range(bins)]
    kd = KDTree(len(pts))
    for i, (p, _) in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    me = bpy.data.meshes.new('belt')
    o = bpy.data.objects.new('belt', me); bpy.context.collection.objects.link(o)
    for g in tunic.vertex_groups:
        o.vertex_groups.new(name=g.name)
    bm = bmesh.new()
    ring = []
    for z in zr:
        r = []
        for i in range(bins):
            a = (i + 0.5) / bins * 2 * math.pi - math.pi
            rr = rad[i] + 0.006
            r.append(bm.verts.new((cx + math.cos(a) * rr, cy + math.sin(a) * rr, z)))
        ring.append(r)
    for i in range(bins):
        j = (i + 1) % bins
        bm.faces.new((ring[0][i], ring[0][j], ring[1][j], ring[1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for v in me.vertices:
        _, k, _ = kd.find(v.co)
        for g in pts[k][1].groups:
            o.vertex_groups[g.group].add([v.index], g.weight, 'REPLACE')
    return o


def piece(src, name, group, keep):
    o = src.copy(); o.data = src.data.copy(); bpy.context.collection.objects.link(o); o.name = name
    keep_group(o, group, keep)
    return o


def dress(n, human, rig):
    """medieval village clothes: a loose tunic to mid-thigh (or a robe / a long skirt) with a leather belt, sleeves
    that widen to the wrist, loose trousers, matte leather boots to below the knee; an apron over it where wanted"""
    look = n.get('look', {})
    female = n.get('body', {}).get('gender', 1.0) < 0.5
    bz = lambda b: (rig.matrix_world @ rig.data.bones[b].head_local).z
    pelvis_z, neck_z = bz('pelvis'), bz('neck_01')
    knee_z, ankle_z = (bz('calf_l') + bz('calf_r')) / 2, (bz('foot_l') + bz('foot_r')) / 2
    hem_z = knee_z + 0.45 * (pelvis_z - knee_z)          # tunic: to mid-thigh
    boot_z = ankle_z + 0.62 * (knee_z - ankle_z)          # boots: a hand below the knee
    belt = (pelvis_z + 0.04, pelvis_z + 0.10)
    t = frozen_copy(human, 'tights')
    groups = lambda names: {t.vertex_groups[g].index for g in t.vertex_groups.keys() if g.startswith(names)}
    foot = groups(('foot_', 'ball_'))
    hand = groups(('hand_', 'index_', 'middle_', 'ring_', 'pinky_', 'thumb_'))
    arm = groups(('upperarm_', 'lowerarm_', 'clavicle_'))
    fore = groups(('lowerarm_',))
    w = lambda dv, gs: sum(x for g, x in dv.items() if g in gs)
    zw = lambda o, v: (o.matrix_world @ v.co).z
    long_robe = bool(look.get('robe'))
    skirt_long = female and not long_robe and not look.get('trousers')   # women: a kirtle to the ankles, unless in trousers
    garments = []

    # upper body: from the hips (under the belt) to the neck, sleeves to the wrist
    top = piece(t, 'tunic', 'helper-tights', lambda v, dv: (zw(t, v) >= pelvis_z - 0.02 or w(dv, arm | hand) > 0.3)
                and w(dv, hand) < 0.25 and zw(t, v) < neck_z + 0.015)
    loosen(top, 0.016, smooth=8)
    me = top.data
    gi = {g.index for g in top.vertex_groups if g.name.startswith('lowerarm_')}
    for v in me.vertices:
        f = sum(g.weight for g in v.groups if g.group in gi)
        v.co += v.normal * 0.008 * f
    top.data.materials.append(material('tunic', hexcol(look.get('robe') if long_robe else look.get('shirt', '#6b5a48')), 0.95))
    garments.append(top)

    # the skirt of the tunic / the robe / the kirtle: the skirt hull, which hangs free of the legs
    s = frozen_copy(human, 'skirt')
    lo = ankle_z + 0.06 if (long_robe or skirt_long) else hem_z
    keep_group(s, 'helper-skirt', lambda v, dv: lo <= zw(s, v) <= pelvis_z + 0.02)
    loosen(s, 0.012, smooth=4)
    colour = look.get('robe') if long_robe else (look.get('skirt') or look.get('pants', '#4a3b2a')) if skirt_long else look.get('shirt', '#6b5a48')
    s.data.materials.append(material('skirt', hexcol(colour), 0.95))
    garments.append(s)

    # belt
    b = belt_band(top, belt, rig)
    b.data.materials.append(material('belt', hexcol(look.get('belt', '#3b2a1c')), 0.7))
    garments.append(b)

    # trousers (under a short tunic only): loose, into the boots
    if not (long_robe or skirt_long):
        tr = piece(t, "trousers", "helper-tights", lambda v, dv: boot_z - 0.12 <= zw(t, v) < pelvis_z + 0.03
                   and w(dv, foot) < 0.3 and w(dv, arm | hand) < 0.3)
        loosen(tr, 0.011, smooth=6)
        tr.data.materials.append(material('trousers', hexcol(look.get('pants', '#3a3028')), 0.95))
        garments.append(tr)

    # boots: feet and lower legs, matte leather
    bo = piece(t, 'boots', 'helper-tights', lambda v, dv: zw(t, v) <= (boot_z if not (long_robe or skirt_long) else ankle_z + 0.12)
               and w(dv, arm | hand) < 0.3)
    loosen(bo, 0.014, smooth=3)
    bo.data.materials.append(material('boots', hexcol(look.get('boots', '#4a3424')), 0.75))
    garments.append(bo)

    # apron: the skirt hull's front, over everything
    if look.get('apron'):
        a = frozen_copy(human, 'apron')
        cy = (rig.matrix_world @ rig.data.bones['pelvis'].head_local).y
        keep_group(a, 'helper-skirt', lambda v, dv: (a.matrix_world @ v.co).y < cy - 0.03 and knee_z - 0.1 <= zw(a, v) <= pelvis_z + 0.02)
        loosen(a, 0.03, smooth=3)
        a.data.materials.append(material('apron', hexcol(look['apron']), 0.9))
        garments.append(a)
    bpy.data.objects.remove(t)

    # the body: no helpers, and nothing where cloth covers it (it would poke through when moving)
    body = frozen_copy(human, 'body')
    keep_group(body, 'body')
    cover, edge = [], []
    for g in garments:
        gb = bmesh.new(); gb.from_mesh(g.data)
        for v in gb.verts:
            cover.append(g.matrix_world @ v.co)
            if v.is_boundary:
                edge.append(g.matrix_world @ v.co)
        gb.free()
    def tree(pts):
        kd = KDTree(max(1, len(pts)))
        for i, c in enumerate(pts):
            kd.insert(c, i)
        kd.balance()
        return kd
    kd, ke = tree(cover), tree(edge or [Vector((1e6, 0, 0))])
    bm = bmesh.new(); bm.from_mesh(body.data)
    hidden = {v.index for v in bm.verts
              if kd.find(body.matrix_world @ v.co)[2] < 0.05 and ke.find(body.matrix_world @ v.co)[2] > 0.045}
    faces = [f for f in bm.faces if all(v.index in hidden for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data); bm.free()
    body.data.materials.clear()
    for m in human.data.materials:
        # skin is opaque: the texture's alpha would punch holes into it
        p = m.node_tree.nodes.get('Principled BSDF')
        for l in list(p.inputs['Alpha'].links):
            m.node_tree.links.remove(l)
        p.inputs['Alpha'].default_value = 1.0
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'DITHERED'
        m.blend_method = 'OPAQUE' if hasattr(m, 'blend_method') else None
        body.data.materials.append(m)
    parts = [body] + garments + [c for c in set(human.children) | set(rig.children) if c.type == 'MESH' and c is not human]
    for o in [body] + garments:
        o.parent = rig
        o.matrix_parent_inverse = rig.matrix_world.inverted()
        mod = o.modifiers.new('rig', 'ARMATURE'); mod.object = rig
    bpy.data.objects.remove(human)
    for o in parts:
        if o.name in bpy.data.objects:
            for m in [m for m in o.modifiers if m.type != 'ARMATURE']:
                o.modifiers.remove(m)
            # only the bones' groups matter in the game
            for g in [g for g in o.vertex_groups if g.name not in rig.data.bones]:
                o.vertex_groups.remove(g)
    return [o for o in parts if o.name in bpy.data.objects]


# ---------------------------------------------------------------- the motions onto this skeleton
def retarget(rig, src_rest, clips, fps):
    W = rig.matrix_world
    rest = {b.name: W @ b.matrix_local for b in rig.data.bones}
    # the target's rest turned so each bone points as the library's rest does (T pose vs A pose)
    aligned = {}
    for s, t in MAP.items():
        bs, bt = src_rest[s], rest[t]
        ds = rot(bs) @ Vector((0, 1, 0))
        dt = rot(bt) @ Vector((0, 1, 0))
        aligned[t] = dt.rotation_difference(ds).to_matrix() @ rot(bt)
    inv = {v: k for k, v in MAP.items()}
    hip_s = src_rest['DEF-hips'].translation.z
    hip_t = rest['pelvis'].translation.z
    k = hip_t / hip_s
    rig.animation_data_create()
    for key, frames in clips.items():
        act = bpy.data.actions.new(key)
        rig.animation_data.action = act
        for pb in rig.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        for fi, fr in enumerate(frames):
            G = {}
            for t, a in aligned.items():
                s = inv[t]
                G[t] = rot(fr[s]) @ rot(src_rest[s]).inverted() @ a
            for pb in rig.pose.bones:
                b = pb.bone
                if b.name not in G:
                    continue
                par = b.parent.name if b.parent else None
                Pg = G.get(par) if par else None
                Pr = rot(rest[par]) if par else rot(W)
                if Pg is None:
                    Pg = Pr
                Lrest = Pr.inverted() @ rot(rest[b.name])
                Lpose = Pg.inverted() @ G[b.name]
                q = (Lrest.inverted() @ Lpose).to_quaternion()
                pb.rotation_quaternion = q
                pb.keyframe_insert('rotation_quaternion', frame=fi + 1)
                if b.name == 'pelvis':
                    d = (fr['DEF-hips'].translation - src_rest['DEF-hips'].translation) * k
                    pb.location = rot(rest['pelvis']).inverted() @ d / W.to_scale().x
                    pb.keyframe_insert('location', frame=fi + 1)
        # check: every bone must point where the library's bone points
        bpy.context.scene.frame_set(len(frames) // 2 + 1)
        fr = frames[len(frames) // 2]
        worst = sorted(((rot(W @ rig.pose.bones[t].matrix) @ Vector((0, 1, 0))).dot(rot(fr[s]) @ Vector((0, 1, 0))), t) for s, t in MAP.items())[:3]
        print(f'  {key}: worst bone agreement', [(t, round(d, 3)) for d, t in worst])
        fl = W @ rig.pose.bones['foot_l'].head; fr_ = W @ rig.pose.bones['foot_r'].head
        print(f'  {key}: feet at x {fl.x:.3f} / {fr_.x:.3f}, library {fr["DEF-foot.L"].translation.x:.3f} / {fr["DEF-foot.R"].translation.x:.3f}')
        tr = rig.animation_data.nla_tracks.new(); tr.name = key
        tr.strips.new(key, 1, act)
        rig.animation_data.action = None
    bpy.context.scene.render.fps = int(round(fps))


def tint_hair(look):
    if look.get('hair'):
        tint('/hair/', look['hair'])



def tint(where, colour):
    want = np.array([x ** (1 / 2.2) for x in hexcol(colour)[:3]], np.float32)
    for im in bpy.data.images:
        if im.source != 'FILE' or where not in im.filepath or 'normal' in im.filepath:
            continue
        if not im.has_data:
            im.reload()
        px = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(px); px = px.reshape(-1, 4)
        lum = px[:, :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        ref = np.percentile(lum[px[:, 3] > 0.5], 70) if (px[:, 3] > 0.5).any() else 0.5
        # the strands' light and dark, but calmer: hair textures are made for their own colour, tinted at full
        # contrast they turn blotchy
        rel = np.clip(0.82 + 0.4 * (np.clip(lum / max(ref, 1e-4), 0, 1.6) - 1.0), 0.45, 1.15)
        px[:, :3] = np.clip(rel[:, None] * want[None, :] * 1.05, 0, 1)
        im.pixels.foreach_set(px.ravel())
        im.pack()


def shrink_images(size):
    for im in bpy.data.images:
        if im.source != 'FILE':
            continue
        if not im.has_data:
            im.reload()
        print('  image', im.name, im.filepath, tuple(im.size), im.has_data)
        if im.size[0] > size:
            im.scale(size, max(1, int(im.size[1] * size / im.size[0])))
        if im.size[0] > 0:
            im.pack()   # the exporter then writes these pixels, not the file on disk


def bake(n, src):
    clear()
    human, rig = make_body(n)
    parts = dress(n, human, rig)
    retarget(rig, *src)
    tint_hair(n.get('look', {}))
    shrink_images(TEX)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts + [rig]:
        o.select_set(True)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, n['id'] + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_image_format='AUTO', export_image_quality=85,
                              export_yup=True, export_apply=False, export_skins=True, export_morph=False,
                              export_def_bones=True, export_optimize_animation_size=True)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in parts)
    print(f"{n['id']}: {len(parts)} parts, {tris} triangles, {os.path.getsize(path) // 1024} kB")


argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = read_source()
for path in sorted(glob.glob(os.path.join(ROOT, 'content', 'core', 'places', '*.json'))):
    place = json.load(open(path))
    for g in place.get('guards', []):
        g.setdefault('look', {}).setdefault('trousers', True)   # guards: tunic and trousers, never a long skirt
    for n in place.get('npcs', []) + place.get('guards', []):
        if n.get('body') and (not argv or n['id'] in argv):
            bake(n, src)
# the players' figures
for n in json.load(open(os.path.join(OUT, 'players.json')))['players']:
    if not argv or n['id'] in argv:
        bake(n, src)
