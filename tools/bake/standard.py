"""Bakes the standard people: content/core/people/std/ — Quaternius' Universal Base Characters and Modular Character
Outfits - Fantasy (both CC0, standard editions) as they come, for the web, and the Universal Animation Library's clips
on their skeleton. Nothing reshaped: this is the core everything else is made from.

    blender -b --factory-startup -noaudio --python tools/bake/standard.py

Out:
  {m,f}_head.glb           the head (and neck) of the base character, its eyes and brows: the outfits carry the rest
                           of the body ("only the head of the model is required", the outfits' readme)
  {m,f}_{peasant,ranger}.glb   an outfit's body, arms (with the hands), legs, feet
  {m,f}_ranger_hood.glb, {m,f}_ranger_pauldron(s).glb   the ranger's extras
  hair_<style>.glb         the hairstyles rigged to the head bone
  anim.glb                 the library's clips with this skeleton's bone names (the rests agree to < 1 degree)
  tex/*.jpg                variant colour maps (peasant 2, ranger 3), applied at play time
Textures go down to 2048 (colour) and 1024 (normal, roughness/ORM) and into the files (JPEG; the hair and lashes keep their alpha as PNG)."""
import bpy, os, glob

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'content', 'core', 'people', 'std')
Q = os.environ.get('QUATERNIUS', '/root/dl/quaternius')
UBC = glob.glob(os.path.join(Q, 'ubc', 'Universal Base Characters*'))[0]
OF = glob.glob(os.path.join(Q, 'mcof', 'Modular Character Outfits*'))[0]
OUTFITS = os.path.join(OF, 'Exports', 'glTF (Godot-Unreal)')
UAL = os.environ.get('UAL', '/root/dl/ual/x/gltf-universal-animation-library-main/glTF/AnimationLibrary_Godot_Standard.gltf')
TEXDIRS = [d for d in glob.glob(os.path.join(Q, '**', '*'), recursive=True) if os.path.isdir(d)]
CLIPS = {'idle': 'Idle_Loop', 'talk': 'Idle_Talking_Loop', 'walk': 'Walk_Loop', 'run': 'Jog_Fwd_Loop', 'jump': 'Jump_Loop',
         'sprint': 'Sprint_Loop'}

# library bone -> this skeleton's bone
UAL2UE = {'root': 'root', 'DEF-hips': 'pelvis', 'DEF-spine.001': 'spine_01', 'DEF-spine.002': 'spine_02', 'DEF-spine.003': 'spine_03',
          'DEF-neck': 'neck_01', 'DEF-head': 'Head'}
for _s, _t in (('L', 'l'), ('R', 'r')):
    UAL2UE.update({f'DEF-shoulder.{_s}': f'clavicle_{_t}', f'DEF-upper_arm.{_s}': f'upperarm_{_t}', f'DEF-forearm.{_s}': f'lowerarm_{_t}',
                   f'DEF-hand.{_s}': f'hand_{_t}', f'DEF-thigh.{_s}': f'thigh_{_t}', f'DEF-shin.{_s}': f'calf_{_t}',
                   f'DEF-foot.{_s}': f'foot_{_t}', f'DEF-toe.{_s}': f'ball_{_t}'})
    for _f in ('index', 'middle', 'pinky', 'ring'):
        for _k in (1, 2, 3):
            UAL2UE[f'DEF-f_{_f}.0{_k}.{_s}'] = f'{_f}_0{_k}_{_t}'
    for _k in (1, 2, 3):
        UAL2UE[f'DEF-thumb.0{_k}.{_s}'] = f'thumb_0{_k}_{_t}'


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def find_texture(name):
    for d in TEXDIRS:
        p = os.path.join(d, name)
        if os.path.exists(p) and 'Normals-UnrealEngine' not in d:
            return p
    return None


def load(path):
    clear()
    bpy.ops.import_scene.gltf(filepath=path)
    # the outfits' glTFs name their textures but do not carry them: take them from the packs' texture folders
    for im in bpy.data.images:
        if not im.has_data:
            p = find_texture(os.path.basename(im.filepath) or im.name)
            if p:
                im.filepath = p
                im.reload()
    for im in bpy.data.images:
        if im.has_data and im.size[0] > 0:
            want = 2048 if 'basecolor' in im.name.lower() or 'basecolor' in im.filepath.lower() or im.name.lower().endswith(('_dark', '_ligh', '_light')) else 1024
            if im.size[0] > want:
                im.scale(want, want * im.size[1] // im.size[0])
            im.pack()
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)
    rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    return rig


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_animations=False, export_yup=True,
                              export_skins=True, export_def_bones=False, export_image_format='JPEG', export_image_quality=88,
                              export_morph=False)
    print(f'  {os.path.basename(path)}: {os.path.getsize(path) // 1024} kB')


def head(base, src):
    """the base character's head: the body's vertices that move with the head or the neck, its eyes and brows"""
    rig = load(src)
    body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.lower().startswith('superhero')][0]
    groups = {g.index for g in body.vertex_groups if g.name in ('Head', 'neck_01')}
    import bmesh
    bm = bmesh.new(); bm.from_mesh(body.data)
    dl = bm.verts.layers.deform.active
    kill = [v for v in bm.verts if sum(w for g, w in v[dl].items() if g in groups) < 0.5]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(body.data); bm.free()
    body.name = f'{base}_head'
    export(os.path.join(OUT, f'{base}_head.glb'), [rig] + [o for o in bpy.data.objects if o.type == 'MESH'])


def outfit(base, name, src):
    rig = load(src)
    export(os.path.join(OUT, f'{base}_{name}.glb'), [rig] + [o for o in bpy.data.objects if o.type == 'MESH'])


def part(out, src):
    rig = load(src)
    export(os.path.join(OUT, out), [rig] + [o for o in bpy.data.objects if o.type == 'MESH'])


def variant_maps():
    os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
    for name, file in (('peasant_1', 'T_Peasant_BaseColor.png'), ('peasant_2', 'T_Peasant_2_BaseColor.png'),
                       ('ranger_1', 'T_Ranger_BaseColor.png'), ('ranger_3', 'T_Ranger_3_BaseColor.png')):
        p = find_texture(file)
        if not p:
            print('  missing', file); continue
        im = bpy.data.images.load(p)
        im.scale(2048, 2048)
        im.filepath_raw = os.path.join(OUT, 'tex', name + '.jpg'); im.file_format = 'JPEG'
        im.save()
        print(f'  tex/{name}.jpg: {os.path.getsize(im.filepath_raw) // 1024} kB')


def motions():
    clear()
    bpy.ops.import_scene.gltf(filepath=UAL)
    rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    for o in list(bpy.data.objects):
        if o is not rig:
            bpy.data.objects.remove(o, do_unlink=True)
    # the bones and every channel that names them, renamed to this skeleton's names
    for b in rig.data.bones:
        if b.name in UAL2UE:
            b.name = UAL2UE[b.name]
    ad = rig.animation_data or rig.animation_data_create()
    for t in list(ad.nla_tracks):
        ad.nla_tracks.remove(t)
    ad.action = None
    for key, src in CLIPS.items():
        a = bpy.data.actions[src].copy(); a.name = key
        tr = ad.nla_tracks.new(); tr.name = key
        st = tr.strips.new(key, int(a.frame_range[0]), a)
        if hasattr(st, 'action_slot') and a.slots:
            st.action_slot = a.slots[0]
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True)
    path = os.path.join(OUT, 'anim.glb')
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_yup=True, export_skins=True, export_def_bones=False,
                              export_optimize_animation_size=True, export_materials='NONE')
    print(f'  anim.glb: {os.path.getsize(path) // 1024} kB')


os.makedirs(OUT, exist_ok=True)
bases = os.path.join(UBC, 'Base Characters', 'Godot - UE')
head('m', os.path.join(bases, 'Superhero_Male_FullBody.gltf'))
head('f', os.path.join(bases, 'Superhero_Female_FullBody.gltf'))
for b, B in (('m', 'Male'), ('f', 'Female')):
    for name in ('peasant', 'ranger'):
        outfit(b, name, os.path.join(OUTFITS, 'Outfits', f'{B}_{name.capitalize()}.gltf'))
    for f in glob.glob(os.path.join(glob.escape(OUTFITS), 'Modular Parts', f'{B}_Ranger_*.gltf')):   # the folders have [brackets]
        tail = os.path.basename(f)[len(B) + len('_Ranger_'):-5].lower()
        if tail.startswith(('head', 'acc')):
            part(f'{b}_ranger_{tail.replace("head_", "").replace("acc_", "")}.glb', f)
for f in sorted(glob.glob(os.path.join(glob.escape(UBC), 'Hairstyles', 'Rigged to Head Bone', 'glTF*', '*.gltf'))):
    part(f'hair_{os.path.basename(f)[:-5].lower()}.glb', f)
variant_maps()
motions()
