"""Washington production hull and visible guard rails, using live GAME gun mounts.

Does not export the separate staggered-battery proposal or overwrite checkpoint_15.
"""
import bpy
import bmesh
import math
import json
import sys
import importlib
from pathlib import Path

ROOT=Path(r'D:\warship-game\art\blender')
KEY='us_bb_game'
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
_bytecode=sys.dont_write_bytecode
try:
    sys.dont_write_bytecode=True
    import washington_bow_profile
    BowProfile=importlib.reload(washington_bow_profile).BowProfile
finally:sys.dont_write_bytecode=_bytecode


def module(name):
    path=ROOT/name;ns={'__file__':str(path)}
    exec(compile(path.read_text(encoding='utf-8'),str(path),'exec'),ns)
    return ns


def api():return module('warship_build.py')


def game_profile(spec):
    controls=json.loads((ROOT/'washington_bow_profile.json').read_text(encoding='utf-8'))
    # Strengthen just the last 15% for normal game-camera legibility. All mount
    # stations remain on their existing deck heights and the approved body stays.
    controls['extraSheerMetres']=1.0
    return BowProfile(spec,controls)


def material(name,colour):
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes=True
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*colour,1)
    shader.inputs['Roughness'].default_value=.76
    mat.diffuse_color=(*colour,1)
    return mat


def build_hull(a,p,coll):
    count=len(p.levels);ring=2*count-1
    vertices=[];faces=[];decks=[];stations=p.stations()
    for s in stations:
        half=[p.sample(s,*level) for level in p.levels]
        vertices.extend(a['W'](*v) for v in half+[(-x,y,z) for x,y,z in reversed(half[1:])])
    for row in range(len(stations)-1):
        for j in range(ring):
            k=(j+1)%ring
            faces.append((row*ring+j,row*ring+k,(row+1)*ring+k,(row+1)*ring+j))
            if j==count-1:decks.append(len(faces)-1)
    faces.append(tuple(reversed(range(ring))))
    mesh=bpy.data.meshes.new('washington_production_hull')
    mesh.from_pydata(vertices,[],faces)
    mesh.materials.append(material('washington_game_shell',(.43,.48,.53)))
    mesh.materials.append(material('washington_game_deck',(.24,.29,.34)))
    for face in mesh.polygons:face.use_smooth=True
    for i in decks:mesh.polygons[i].material_index=1;mesh.polygons[i].use_smooth=False
    mesh.polygons[-1].use_smooth=False
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(mesh);bm.free();mesh.update()
    for edge in mesh.edges:
        u,v=(mesh.vertices[i].co for i in edge.vertices)
        if abs(u.x)<1e-5 and abs(v.x)<1e-5 and max(u.y,v.y)<-106.6 and min(u.z,v.z)>=0:
            edge.use_edge_sharp=True
    hull=bpy.data.objects.new('refhull_'+KEY,mesh);coll.objects.link(hull)
    hull['visual_profile']='Washington flared/raked bow and raised sheer, game version'
    hull['bow_extra_sheer_m']=p.data['extraSheerMetres']
    return hull


def build_washington():
    a=api();spec=a['SHIPS']['us_bb'];p=game_profile(spec)
    ship=a['coll_named']('ship_'+KEY);ref=a['coll_named']('ref_'+KEY)
    # Clone the current GAME island, not the staggered-battery draft.
    source=bpy.data.objects['super_us_bb']
    island=source.copy();island.data=source.data.copy();island.name='super_'+KEY+'_island';ship.objects.link(island)
    z=spec['L']*.42;hw=spec['B']/2*a['half_w'](z/spec['L']+.5);y=a['deck_y'](spec,z)-1.6
    bm=bmesh.new();bm.from_mesh(island.data)
    old=[v for v in bm.verts if abs(abs(v.co.x)-(hw-.5))<.251 and abs(-v.co.y-z)<.801 and y-.001<=v.co.z<=y+.501]
    assert len(old)==16,('unexpected old anchor geometry',len(old))
    bmesh.ops.delete(bm,geom=old,context='VERTS');bm.to_mesh(island.data);bm.free()
    hull=build_hull(a,p,ref)

    buf=a['Buf']()
    stats=module('game_railings.py')['add_deck_railings'](a,buf,lambda s:p.sample(s,'upper',1),spec['L'])
    rails=a['make_obj']('super_'+KEY+'_rails',buf,coll=ship)
    for face in rails.data.polygons:face.use_smooth=True
    rails['railStats']=json.dumps(stats);rails['railFeet']=json.dumps(buf.rail_feet)
    # Hawse and anchor silhouette attached to the NEW flared side, replacing the
    # old black proxy boxes that would otherwise float outside the finer bow.
    anchors=a['Buf']()
    def emit(shape,col=(.24,.28,.31)):anchors.emit(*shape,col=col)
    x,y,z=p.sample(.92,'upper',.82)
    for side in (-1,1):
        xx=side*(x+.10)
        emit(a['p_cyl_x'](xx,y,z,.34,.12,12),(.43,.47,.51))
        emit(a['p_cyl_x'](xx+side*.08,y,z,.24,.02,12),(.08,.11,.13))
        emit(a['p_rod']((xx+side*.10,y+.15,z+.08),(xx+side*.12,y-1.1,z-.42),.10,6))
        emit(a['p_rod']((xx+side*.12,y-.9,z-1.1),(xx+side*.12,y-.9,z+.28),.13,6))
        for dz in (-.9,.2):
            emit(a['p_rod']((xx+side*.12,y-1.0,z+dz),(xx+side*.10,y-.55,z+dz-.15),.14,5))
    a['make_obj']('super_'+KEY+'_anchors',anchors,coll=ship)
    a['preview_turrets']('us_bb',collection_name='preview_'+KEY)
    a['show_ship'](KEY)
    for coll in bpy.data.collections:
        if coll.name.startswith('labels_'):
            for ob in coll.objects:ob.hide_set(True);ob.hide_render=True
    bpy.context.view_layer.update()
    validate_washington()
    return hull


def validate_washington():
    from mathutils import Vector,Matrix
    from mathutils.bvhtree import BVHTree
    a=api();spec=a['SHIPS']['us_bb'];p=game_profile(spec)
    hull=bpy.data.objects['refhull_'+KEY]
    bm=bmesh.new();bm.from_mesh(hull.data)
    assert all(e.is_manifold for e in bm.edges)
    assert bm.calc_volume(signed=True)>0 and all(f.calc_area()>1e-9 for f in bm.faces)
    bm.free()
    assert abs(hull.dimensions.x-33)<1e-4 and abs(hull.dimensions.y-222)<1e-4
    tree=BVHTree.FromPolygons([v.co.copy() for v in hull.data.vertices],[list(f.vertices) for f in hull.data.polygons])
    feet=json.loads(bpy.data.objects['super_'+KEY+'_rails']['railFeet'])
    for x,y,z in feet:
        hit=tree.ray_cast(Vector(a['W'](x,y+.03,z)),Vector((0,0,-1)),.13)
        assert hit[0] is not None and abs(hit[0].z-y)<.05,('rail foot not on deck',x,y,z,hit)
    for i,mount in enumerate(spec['tur']):
        assert abs(p.deck(mount['z']/222+.5)-a['deck_y'](spec,mount['z']))<1e-7
        barrel=next(o for o in bpy.data.collections['preview_'+KEY].objects if o.get('mount_index')==i and o.get('export_role')=='barrel')
        shape=a['TS'][mount['kind']]
        expected=Matrix.Translation(Vector(a['W'](mount['x'],a['deck_y'](spec,mount['z'])+mount['y'],mount['z']))) @ Matrix.Rotation(mount['face'],4,'Z') @ Vector(a['W'](0,shape['h']/2,shape['len']*.18))
        assert (barrel.matrix_world.translation-expected).length<.001
    count=sum(len(f.vertices)-2 for prefix in ('ship_','ref_','preview_') for o in bpy.data.collections[prefix+KEY].objects if o.type=='MESH' for f in o.data.polygons)
    assert count<45000,count
    print('WASHINGTON VALID: raised/raked bow, actual 222x33m,',len(feet),'rail feet on deck, all 13 live mounts unchanged;',count,'tri')
    return count


def export_washington():
    a=api();p=game_profile(a['SHIPS']['us_bb'])
    module('kirishima_game_export.py')['export_ship_visuals'](a,p,lambda name:a['get_mat'](),KEY,'us_bb')


def update_kirishima_rails():
    a=api();k=module('kirishima_1942_build.py');p=k['KirishimaProfile']()
    buf=a['Buf']();stats=module('game_railings.py')['add_deck_railings'](a,buf,lambda s:p.sample(s,'upper',1),222)
    coll=bpy.data.collections['ship_jp_bb_kiri']
    old=bpy.data.objects['super_jp_bb_kiri_rails']
    was_hidden,was_render=old.hide_get(),old.hide_render
    bpy.data.objects.remove(old,do_unlink=True)
    rails=a['make_obj']('super_jp_bb_kiri_rails',buf,coll=coll)
    rails.data.materials[0]=k['detail_material']('kirishima_detail_rails')
    rails['railStats']=json.dumps(stats)
    for face in rails.data.polygons:face.use_smooth=True
    rails.hide_set(was_hidden);rails.hide_render=was_render
    k['game_export_module']()['export_kirishima'](a,p,k['detail_material'],'jp_bb_kiri')


def review_washington():
    a=api();a['show_ship'](KEY);a['SHOTDIR']=str(ROOT/'qa')
    objects=[o for prefix in ('ship_','ref_','preview_') for o in bpy.data.collections[prefix+KEY].objects]
    a['render_shot']('washington_game_side',objects,yaw=90,pitch=0,ortho=True,res=(1500,650))
    a['render_shot']('washington_game_bow',objects,yaw=40,pitch=9,focus=(0,10,82),span=75,res=(1300,850))
    a['render_shot']('washington_game_rails',objects,yaw=55,pitch=20,focus=(12,10,47),span=48,res=(1300,850))


def save_washington():
    validate_washington()
    path=ROOT/'checkpoint_27_washington_game_bow_and_rails.blend'
    assert not path.exists() or bpy.data.filepath==str(path)
    for name in ('washington_game_hull.py','game_railings.py','kirishima_game_export.py',
                 'kirishima_1942_build.py','washington_bow_profile.py','washington_bow_profile.json',
                 'WASHINGTON_GAME_HULL_AND_RAILS.md','WASHINGTON_BOW.md','README.md'):
        p=ROOT/name
        if p.exists():
            t=bpy.data.texts.get(name) or bpy.data.texts.new(name);t.clear();t.write(p.read_text(encoding='utf-8'))
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
