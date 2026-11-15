"""Bakes the motions of the people kit: content/core/people/kit/anim.glb — the clips of Quaternius' Universal Animation
Library (CC0) as they are, on its own skeleton, which is every person's skeleton (tools/bake/kit.py): nothing converted.

    blender -b --factory-startup -noaudio --python tools/bake/motions.py

Clips: idle, talk, walk, run, jump, sprint, and for the own body seen from its eyes fp_* variants made from them: the
trunk upright, the head steady (the camera rides it), the arms' swing smaller, the hips' bob softer."""
import bpy, os
from mathutils import Quaternion

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'content', 'core', 'people', 'kit')
UAL = os.environ.get('UAL', '/root/dl/ual/x/gltf-universal-animation-library-main/glTF/AnimationLibrary_Godot_Standard.gltf')
CLIPS = {'idle': 'Idle_Loop', 'talk': 'Idle_Talking_Loop', 'walk': 'Walk_Loop', 'run': 'Jog_Fwd_Loop', 'jump': 'Jump_Loop',
         'sprint': 'Sprint_Loop'}
TRUNK = ('DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003', 'DEF-neck', 'DEF-head')
ARMS = ('DEF-shoulder.', 'DEF-upper_arm.', 'DEF-forearm.', 'DEF-hand.')


def curves(act):
    if hasattr(act, 'fcurves'):
        return list(act.fcurves)
    return [fc for l in act.layers for s in l.strips for cb in s.channelbags for fc in cb.fcurves]


def mean_q(qs):
    m = Quaternion((0, 0, 0, 0))
    for q in qs:
        m += q if m.magnitude == 0 or m.dot(q) >= 0 else -q
    return m.normalized() if m.magnitude > 0 else Quaternion()


def first_person(act, name):
    """the own body's variant: trunk upright and steady (lean taken out, a third of its sway left), arms swinging 60 %,
    hips bobbing 40 %"""
    fp = act.copy(); fp.name = name
    groups = {}
    for fc in curves(fp):
        b = fc.data_path.split('"')[1] if '"' in fc.data_path else None
        groups.setdefault((b, fc.data_path.rsplit('.', 1)[-1]), {})[fc.array_index] = fc
    for (b, prop), comp in groups.items():
        if prop == 'rotation_quaternion' and len(comp) == 4 and (b in TRUNK or (b or '').startswith(ARMS)):
            n = min(len(comp[i].keyframe_points) for i in range(4))
            qs = [Quaternion([comp[i].keyframe_points[k].co[1] for i in range(4)]) for k in range(n)]
            mq = mean_q(qs)
            base, keep = (Quaternion().slerp(mq, 0.25), 0.33) if b in TRUNK else (mq, 0.6)
            for k, q in enumerate(qs):
                d = mq.inverted() @ (q if mq.dot(q) >= 0 else -q)   # the swing around the clip's mean
                q2 = base.slerp(base @ d, keep)
                for i in range(4):
                    comp[i].keyframe_points[k].co[1] = q2[i]
            for fc in comp.values():
                fc.update()
        elif prop == 'location' and b == 'DEF-hips':
            for fc in comp.values():
                vals = [p.co[1] for p in fc.keyframe_points]
                m = sum(vals) / len(vals)
                for p in fc.keyframe_points:
                    p.co[1] = m + (p.co[1] - m) * 0.4
                fc.update()
    return fp


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=UAL)
rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
for o in list(bpy.data.objects):
    if o is not rig:
        bpy.data.objects.remove(o, do_unlink=True)
ad = rig.animation_data or rig.animation_data_create()
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ad.action = None
made = {}
for key, src in CLIPS.items():
    a = bpy.data.actions[src].copy(); a.name = key
    made[key] = a
for key in ('idle', 'walk', 'run', 'sprint', 'jump'):
    made['fp_' + key] = first_person(made[key], 'fp_' + key)
for key, a in made.items():
    tr = ad.nla_tracks.new(); tr.name = key
    st = tr.strips.new(key, int(a.frame_range[0]), a)
    if hasattr(st, 'action_slot') and a.slots:
        st.action_slot = a.slots[0]
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True)
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'anim.glb')
bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_animations=True,
                          export_animation_mode='NLA_TRACKS', export_yup=True, export_skins=True, export_def_bones=False,
                          export_optimize_animation_size=True, export_materials='NONE')
print(f'anim: {len(made)} clips, {os.path.getsize(path) // 1024} kB')
