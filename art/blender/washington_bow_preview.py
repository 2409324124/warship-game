"""Rebuild the isolated BB-56 bow blockout without exporting or moving live mounts.

In Blender: exec(compile(open(PATH, encoding='utf-8').read(), PATH, 'exec'))
Then: build_bow_preview(); review_bow(); save_bow_checkpoint()
"""
import json
import importlib
import math
import sys
from pathlib import Path

import bpy
import bmesh

ROOT = Path(r'D:\warship-game\art\blender')
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
_bytecode_setting = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    import washington_bow_profile
    BowProfile = importlib.reload(washington_bow_profile).BowProfile
finally:
    sys.dont_write_bytecode = _bytecode_setting

KEY = 'us_bb_bow'


def api():
    ns = {}
    path = ROOT/'warship_build.py'
    exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), ns)
    return ns


def material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .78
    mat.diffuse_color = (*color, 1)
    return mat


def build_bow_preview():
    ns = api()
    spec = ns['SHIPS']['us_bb']
    profile = BowProfile(spec)
    assert bpy.data.objects.get('super_us_bb_draft'), 'Build battery_layout_preview first'
    # All three collections are new; the checkpoint_11 draft remains untouched.
    ship = ns['coll_named']('ship_'+KEY)
    ref = ns['coll_named']('ref_'+KEY)
    guns = ns['coll_named']('preview_'+KEY)
    source = bpy.data.objects['super_us_bb_draft']
    island = source.copy()
    island.data = source.data.copy()
    island.name = 'super_'+KEY
    ship.objects.link(island)
    # Old proxy anchor boxes were placed against the old hull. Remove them only
    # from this duplicate; don't leave floating black cubes outside the new bow.
    bm = bmesh.new()
    bm.from_mesh(island.data)
    z = spec['L']*.42
    hw = spec['B']/2*ns['half_w'](z/spec['L']+.5)
    yy = ns['deck_y'](spec,z)-1.6
    stale = [v for v in bm.verts if abs(abs(v.co.x)-(hw-.5)) < .251
             and abs(-v.co.y-z) < .801 and yy-.001 <= v.co.z <= yy+.501]
    bmesh.ops.delete(bm, geom=stale, context='VERTS')
    bm.to_mesh(island.data)
    bm.free()
    island['bow_preview_removed_proxy_anchor_vertices'] = len(stale)
    # Linked mesh copies preserve all existing turret articulation and positions.
    for original in bpy.data.collections['preview_us_bb_draft'].objects:
        obj = original.copy()
        obj.name = 'bow_'+original.name
        guns.objects.link(obj)

    vertices, faces, deck_faces = [], [], []
    count = len(profile.levels)
    ring_count = 2*count-1
    stations = profile.stations()
    for s in stations:
        half = [profile.sample(s,*level) for level in profile.levels]
        ring = half+[(-x,y,z) for x,y,z in reversed(half[1:])]
        vertices.extend(ns['W'](*p) for p in ring)
    for r in range(len(stations)-1):
        for j in range(ring_count):
            k = (j+1)%ring_count
            faces.append((r*ring_count+j,r*ring_count+k,(r+1)*ring_count+k,(r+1)*ring_count+j))
            if j == count-1:
                deck_faces.append(len(faces)-1)
    # Stern transom. At the bow both halves converge on the same raked centreline.
    faces.append(tuple(reversed(range(ring_count))))
    mesh = bpy.data.meshes.new('washington_bow_indexed_hull')
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material('bow_blockout_shell',(.43,.48,.53)))
    mesh.materials.append(material('bow_blockout_deck',(.24,.29,.34)))
    for p in mesh.polygons:
        p.use_smooth = True
    for i in deck_faces:
        mesh.polygons[i].material_index = 1
        mesh.polygons[i].use_smooth = False
    mesh.polygons[-1].use_smooth = False
    # Weld the keel and stem, remove zero-area faces and orient the closed shell.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    # Only the waterline-and-above knife stem is sharp. The underwater keel
    # stays smooth: marking its final edges sharp made a false centre seam.
    for edge in mesh.edges:
        a,b = (mesh.vertices[i].co for i in edge.vertices)
        if abs(a.x)<1e-5 and abs(b.x)<1e-5 and max(a.y,b.y)<-106.6 and min(a.z,b.z)>=-1e-6:
            edge.use_edge_sharp = True
    hull = bpy.data.objects.new('refhull_'+KEY,mesh)
    ref.objects.link(hull)
    hull['PREVIEW_ONLY'] = True
    hull['profile_source'] = 'washington_bow_profile.json'
    hull['historical_accuracy'] = profile.data['uncertainty']
    hull['waterline_stem_setback_m'] = profile.data['stemWaterlineSetback']
    hull['triangle_count'] = sum(len(p.vertices)-2 for p in mesh.polygons)
    hull['triangle_budget'] = 8000
    hull['deck_is_part_of_closed_shell'] = True
    hull['midship_beam_normalization'] = profile.beam_correction
    hull['underbody_version'] = profile.data['underbodyVersion']
    marks = ns['coll_named']('marks_'+KEY)
    water_mesh = bpy.data.meshes.new('bow_review_waterline')
    water_mesh.from_pydata([(-1000,-1000,0),(1000,-1000,0),(1000,1000,0),(-1000,1000,0)],[],[(0,1,2,3)])
    water_mat = material('bow_review_water',(.055,.085,.11))
    water_shader = next(n for n in water_mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    # This is a waterline mask, not a ground plane: don't cast distracting hull
    # shadows across it and imply extra geometry beneath the photographed stem.
    water_shader.inputs['Base Color'].default_value = (0,0,0,1)
    water_shader.inputs['Emission Color'].default_value = (.055,.085,.11,1)
    water_shader.inputs['Emission Strength'].default_value = 1
    water_shader.inputs['Specular IOR Level'].default_value = 0
    water_mesh.materials.append(water_mat)
    water = bpy.data.objects.new('bow_review_waterline',water_mesh)
    water['REVIEW_ONLY_NOT_PART_OF_SHIP'] = True
    marks.objects.link(water)
    ns['show_ship'](KEY)
    bpy.context.view_layer.update()
    whole_triangles = validate_bow()
    text = bpy.data.texts.get('START_HERE_bow_blockout.txt') or bpy.data.texts.new('START_HERE_bow_blockout.txt')
    text.clear()
    text.write('BB-56 BOW / UNDERBODY v2 — visual preview, not exported.\n'
               'Game-oriented rounded forefoot, no hanging toe or lower-section waist.\n'
               f'Actual hull bounds 222 x 33m; hull+deck {hull["triangle_count"]} tri; visible ship {whole_triangles} tri.\n'
               'Original upper sections and mount transforms preserved. No sim, GLB or manifest changed.\n'
               'Save target: checkpoint_15_washington_bottom_refined.blend\n'
               'See WASHINGTON_BOW.md for diagnosis, tests, comparison images and rebuild.\n'
               'Previous hull retained hidden as refhull_us_bb_bow_before_bottom.\n')
    for name in ('washington_bow_profile.py','washington_bow_profile.json','washington_bow_preview.py','washington_bottom_review.py','WASHINGTON_BOW.md'):
        path = ROOT/name
        if path.exists():
            text = bpy.data.texts.get(name) or bpy.data.texts.new(name)
            text.clear()
            text.write(path.read_text(encoding='utf-8'))
    print('Bow blockout built. Unchanged live game and battery source; old proxy anchor boxes omitted:',len(stale))
    return hull


def validate_bow():
    from mathutils import Vector
    hull = bpy.data.objects['refhull_'+KEY]
    bm = bmesh.new()
    bm.from_mesh(hull.data)
    assert not [e for e in bm.edges if not e.is_manifold], 'Open or nonmanifold shell'
    assert all(f.calc_area()>1e-9 for f in bm.faces), 'Degenerate hull faces'
    assert bm.calc_volume(signed=True)>0, 'Hull normals point inward'
    bm.free()
    verts = [v.co for v in hull.data.vertices]
    assert all(math.isfinite(a) for v in verts for a in v)
    assert max(abs(v.x) for v in verts)<=16.5+1e-5
    assert abs(max(v.x for v in verts)-min(v.x for v in verts)-33)<1e-4
    assert abs(max(v.y for v in verts)-min(v.y for v in verts)-222)<1e-4
    assert hull['triangle_count']<=hull['triangle_budget']
    for copy in bpy.data.collections['preview_'+KEY].objects:
        name = copy.name.removeprefix('bow_')
        original = bpy.data.objects[name]
        assert all(abs(copy.matrix_world[i][j]-original.matrix_world[i][j])<1e-6 for i in range(4) for j in range(4)), name
    tri = sum(len(p.vertices)-2 for c in ('ship_','preview_','ref_')
              for o in bpy.data.collections[c+KEY].objects if o.type=='MESH' for p in o.data.polygons)
    assert tri<40000, ('Whole-ship blockout exceeds target',tri)
    visible_hulls = [o.name for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('refhull_') and not o.hide_get() and not o.hide_render]
    assert visible_hulls == [hull.name], visible_hulls
    print('VALID: manifold closed shell, positive volume, finite vertices, actual 222 x 33m, mount transforms unchanged')
    print('HULL+DECK:',hull['triangle_count'],'tri; FULL DRAFT:',tri,'tri; visible hull:',visible_hulls)
    return tri


def review_bow():
    ns = api()
    ns['show_ship'](KEY)
    ns['SHOTDIR'] = str(ROOT/'qa')
    objects = [o for prefix in ('ship_','ref_','preview_') for o in bpy.data.collections[prefix+KEY].objects]
    hull = bpy.data.objects['refhull_'+KEY]
    water = bpy.data.objects['bow_review_waterline']
    shots = [
        ('bow_blockout_side',objects,dict(yaw=90,pitch=0,ortho=True,res=(1440,620))),
        ('bow_blockout_top',objects,dict(yaw=0,pitch=90,ortho=True,res=(1440,620))),
        ('bow_blockout_front',objects,dict(yaw=0,pitch=0,ortho=True,res=(900,1000))),
        ('bow_blockout_qbow',objects,dict(yaw=38,pitch=14,res=(1280,800))),
        ('bow_blockout_fore_side',[hull],dict(yaw=90,pitch=0,ortho=True,focus=(0,3,87),span=62,res=(1280,680))),
        ('bow_blockout_fore_top',[hull],dict(yaw=0,pitch=90,ortho=True,focus=(0,5,85),span=48,res=(900,1100))),
        ('bow_blockout_fore_qbow',objects,dict(yaw=36,pitch=8,focus=(0,5,91),span=55,res=(1280,800))),
        ('bow_blockout_waterline_qbow',objects+[water],dict(yaw=36,pitch=8,focus=(0,6,91),span=55,res=(1280,800))),
        ('bow_blockout_waterline_side',objects+[water],dict(yaw=90,pitch=2,ortho=True,focus=(0,5,87),span=62,res=(1280,680))),
        ('bow_blockout_waterline_front',objects+[water],dict(yaw=0,pitch=5,ortho=True,focus=(0,7,65),span=42,res=(1100,800))),
    ]
    return [ns['render_shot'](name,obs,**settings) for name,obs,settings in shots]


def save_bow_checkpoint():
    validate_bow()
    path = ROOT/'checkpoint_15_washington_bottom_refined.blend'
    # Explicitly refuse to replace a previous on-disk checkpoint in another session.
    assert not path.exists() or bpy.data.filepath == str(path), 'Checkpoint exists; choose a new filename'
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    print('Saved',path)
