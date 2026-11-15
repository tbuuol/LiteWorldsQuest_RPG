"""Sidestep clips for the standard people, made the way an animator would: the feet are placed (when they stand,
when and how they swing), the legs follow by IK, the upper body is the library's idle; then baked into plain clips
(content/core/people/std/strafe.glb). Two kinds, each to the right and to the left:

  side_walk_r/l   a slow sidestep: the leading foot steps out, the other closes up; the feet never cross
  side_run_r/l    a side shuffle (as a defender moves): both feet push off almost together, a short flight, land

    blender -b --factory-startup -noaudio --python tools/bake/strafe.py

Runs after standard.py (it reads anim.glb, the library's clips already on this skeleton)."""
import bpy, os, math
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
STD = os.path.join(ROOT, 'content', 'core', 'people', 'std')
FPS = 30

# (name, frames per cycle, metres the body moves per cycle, stance width, lift lead, lift trail, mode, hip bob)
KINDS = [
    ('side_walk', 30, 0.50, 0.30, 0.07, 0.07, 'step', 0.015),
    ('side_run', 14, 0.90, 0.30, 0.13, 0.09, 'shuffle', 0.05),
]


def smooth(t):
    return t * t * (3 - 2 * t)


def foot_offsets(kind, u, S):
    """where each foot is along the way (metres, + = the way it goes, relative to its own base) and how high it is
    lifted (0..1), at phase u of the cycle; the body stays put (the clip is in place), so a standing foot slides back"""
    name, frames, dist, width, lift_lead, lift_trail, mode, bob = kind
    if mode == 'step':
        # lead: swings 0..0.5, stands 0.5..1; trail: stands 0..0.5, swings 0.5..1 (each moves S/2 per swing)
        def one(p):  # p: phase where 0..0.5 is its swing
            if p < 0.5:
                s = smooth(p / 0.5)
                return -S / 4 + s * S / 2, math.sin(math.pi * p / 0.5)
            s = (p - 0.5) / 0.5
            return S / 4 - s * S / 2, 0.0
        lead = one(u)
        trail = one((u + 0.5) % 1)
        return lead, trail
    # shuffle: both feet in flight together for 40 % (the trail a little later), standing 60 %
    def one(p, lag):
        p = (p - lag) % 1
        if p < 0.4:
            s = smooth(p / 0.4)
            return -S / 2 * 0.6 + s * S * 0.6, math.sin(math.pi * p / 0.4)
        s = (p - 0.4) / 0.6
        return S * 0.3 - s * S * 0.6, 0.0
    return one(u, 0.0), one(u, 0.08)


def bake_kind(rig, idle, kind, side):
    name, frames, dist, width, lift_lead, lift_trail, mode, bob = kind
    W = rig.matrix_world
    bones = rig.data.bones
    # the body's axes, from its rest: right (thigh_r - thigh_l), up, forward
    right = (W @ bones['thigh_r'].head_local - W @ bones['thigh_l'].head_local).normalized()
    up = Vector((0, 0, 1))
    fwd = up.cross(right).normalized()
    if (W @ bones['ball_l'].head_local - W @ bones['foot_l'].head_local).dot(fwd) < 0:
        fwd = -fwd
    way = right if side == 'r' else -right
    lead_side, trail_side = ('r', 'l') if side == 'r' else ('l', 'r')
    feet0 = {s: W @ bones[f'foot_{s}'].head_local for s in 'lr'}
    hips0 = W @ bones['pelvis'].head_local
    mid = (feet0['l'] + feet0['r']) / 2
    base = {s: mid + (right if s == 'r' else -right) * width / 2 for s in 'lr'}
    for s in 'lr':
        base[s].z = feet0[s].z
    # targets: a foot target and a knee pole per leg
    targets, poles = {}, {}
    for s in 'lr':
        t = bpy.data.objects.new(f'foot_t_{s}', None); bpy.context.collection.objects.link(t); targets[s] = t
        p = bpy.data.objects.new(f'knee_p_{s}', None); bpy.context.collection.objects.link(p); poles[s] = p
        p.location = W @ bones[f'calf_{s}'].head_local + fwd * 0.6
    # constraints: IK on the shins (two bones), feet keep their rest turn (flat, toes ahead)
    rest_rot = {s: (W @ bones[f'foot_{s}'].matrix_local).to_quaternion() for s in 'lr'}
    for s in 'lr':
        c = rig.pose.bones[f'calf_{s}'].constraints.new('IK')
        c.target = targets[s]; c.pole_target = poles[s]; c.chain_count = 2; c.pole_angle = 0.0
        holder = bpy.data.objects.new(f'foot_r_{s}', None); bpy.context.collection.objects.link(holder)
        holder.rotation_mode = 'QUATERNION'; holder.rotation_quaternion = rest_rot[s]
        cr = rig.pose.bones[f'foot_{s}'].constraints.new('COPY_ROTATION'); cr.target = holder
    ad = rig.animation_data
    ad.action = idle
    if hasattr(ad, 'action_slot') and idle.slots:
        ad.action_slot = idle.slots[0]
    f0 = int(idle.frame_range[0]); idle_len = int(idle.frame_range[1] - idle.frame_range[0])

    def place(u):
        (lx, ll), (tx, tl) = foot_offsets(kind, u, dist)
        for s, (x, l, lift) in ((lead_side, (lx, ll, lift_lead)), (trail_side, (tx, tl, lift_trail))):
            targets[s].location = base[s] + way * x + up * (l * lift)
        return max(ll, tl)

    # the pole angle that bends the knees forward (rigs differ): try the four, keep the one with knees most ahead
    best = None
    for ang in (0.0, math.pi / 2, -math.pi / 2, math.pi):
        for s in 'lr':
            rig.pose.bones[f'calf_{s}'].constraints['IK'].pole_angle = ang
        place(0.25)
        bpy.context.scene.frame_set(f0)
        knee = sum(((W @ rig.pose.bones[f'calf_{s}'].head) - (W @ rig.pose.bones[f'thigh_{s}'].head)).dot(fwd) for s in 'lr')
        if best is None or knee > best[0]:
            best = (knee, ang)
    for s in 'lr':
        rig.pose.bones[f'calf_{s}'].constraints['IK'].pole_angle = best[1]
    # the hips: down as the feet land, up in flight; a little lean into the way
    out = bpy.data.actions.new(f'{name}_{side}')
    frames_list = []
    for i in range(frames + 1):
        u = (i % frames) / frames
        airborne = place(u)
        bpy.context.scene.frame_set(f0 + (i % max(1, idle_len)))
        frames_list.append((i, airborne))
        pel = rig.pose.bones['pelvis']
        drop = bob * (airborne - 0.5) * 2 if mode == 'shuffle' else -bob * abs(math.cos(2 * math.pi * u * 2))
        pel.location = pel.location  # keep the idle's
        pel.matrix = Matrix.Translation((W.inverted() @ (hips0 + up * drop + way * 0.0))) @ pel.matrix.to_3x3().to_4x4()
        bpy.context.view_layer.update()
        # bake this frame: every bone's visual pose as keys
        for pb in rig.pose.bones:
            m = pb.matrix.copy()
            pb.keyframe_insert  # noqa
        frames_list[-1] = (i, {pb.name: pb.matrix.copy() for pb in rig.pose.bones})
    # write the keys: local transforms from the visual (armature space) matrices, with no constraints
    for pb in rig.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
    ad.action = out
    if hasattr(ad, 'action_slot') and out.slots:
        ad.action_slot = out.slots[0]
    for i, mats in frames_list:
        for pb in rig.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        # parents first: setting pb.matrix needs the parent's current pose
        for pb in sorted(rig.pose.bones, key=lambda b: len(b.parent_recursive)):
            pb.matrix = mats[pb.name]
            bpy.context.view_layer.update()
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=i + 1)
            if pb.name == 'pelvis':
                pb.keyframe_insert('location', frame=i + 1)
    for o in list(targets.values()) + list(poles.values()) + [o for o in bpy.data.objects if o.name.startswith('foot_r_')]:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f'  {out.name}: {frames} frames, {dist / (frames / FPS):.2f} m/s, pole {math.degrees(best[1]):.0f}')
    return out


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(STD, 'anim.glb'))
rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.context.scene.render.fps = FPS
idle = bpy.data.actions['idle']
ad = rig.animation_data or rig.animation_data_create()
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
made = []
for kind in KINDS:
    for side in 'rl':
        made.append(bake_kind(rig, idle, kind, side))
ad.action = None
for a in made:
    tr = ad.nla_tracks.new(); tr.name = a.name
    st = tr.strips.new(a.name, 1, a)
    if hasattr(st, 'action_slot') and a.slots:
        st.action_slot = a.slots[0]
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True)
path = os.path.join(STD, 'strafe.glb')
bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_animations=True,
                          export_animation_mode='NLA_TRACKS', export_yup=True, export_skins=True, export_def_bones=False,
                          export_optimize_animation_size=True, export_materials='NONE')
print(f'strafe.glb: {os.path.getsize(path) // 1024} kB')
