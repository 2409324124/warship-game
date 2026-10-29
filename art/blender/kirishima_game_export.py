"""Kirishima recesses and generic production visual exports; no turrets baked in."""
import json
from pathlib import Path
import bpy
import bmesh

ROOT=Path(r'D:\warship-game\art\blender')


def port_schedule(profile,spec):
    ports=[]
    for index,mount in enumerate(spec['tur']):
        if not mount.get('sec'):continue
        z=mount['z'];s=z/spec['L']+.5
        axis=profile.deck(s)+mount['y']+.8
        surface=profile.sample(s,'upper',axis/profile.deck(s))[0]
        ports.append({'mount':index,'side':1 if mount['x']>0 else -1,
                      'z':z,'axis_y':axis,'surface_x':surface})
    assert len(ports)==8
    return ports


def carve_casemates(api,hull,profile,spec):
    """Subtract eight shallow rooms from the closed shell, not dark boxes on it."""
    ports=port_schedule(profile,spec)
    buf=api['Buf']()
    for p in ports:
        x=p['side']*(p['surface_x']+.8)
        buf.emit(*api['p_box'](x,p['axis_y']-1.25,p['z'],4.8,2.50,3.4),col=(.2,.2,.2))
    me=bpy.data.meshes.new('casemate_cutters')
    me.from_pydata(buf.v,[],buf.f);me.update()
    cutter=bpy.data.objects.new('casemate_cutters',me)
    bpy.context.scene.collection.objects.link(cutter)
    bm=bmesh.new();bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
    try:
        for ob in bpy.context.selected_objects:ob.select_set(False)
        hull.select_set(True);bpy.context.view_layer.objects.active=hull
        modifier=hull.modifiers.new('Eight recessed casemates','BOOLEAN')
        operations=[i.identifier for i in modifier.bl_rna.properties['operation'].enum_items]
        modifier.operation=next(x for x in operations if x.lower()=='difference')
        solvers=[i.identifier for i in modifier.bl_rna.properties['solver'].enum_items]
        modifier.solver=next(x for x in solvers if 'exact' in x.lower())
        modifier.object=cutter
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        bm=bmesh.new();bm.from_mesh(hull.data)
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(hull.data);bm.free();hull.data.update()
        for face in hull.data.polygons:
            c=face.center
            for p in ports:
                if abs(-c.y-p['z'])<1.8 and abs(c.z-p['axis_y'])<1.35:
                    if abs(face.normal.y)>.85 or abs(face.normal.z)>.85 or abs(c.x)<p['surface_x']-1.1:
                        face.use_smooth=False
        hull['casematePorts']=json.dumps(ports)
        hull['casemateCount']=8
    finally:
        bpy.data.objects.remove(cutter,do_unlink=True)
        if me.users==0:bpy.data.meshes.remove(me)
    return ports


def build_port_frames(api,buf,profile,spec):
    steel=(.53,.58,.62);dark=(.10,.14,.17)
    for p in port_schedule(profile,spec):
        x=p['side']*(p['surface_x']+.08);y=p['axis_y'];z=p['z']
        # A narrow hood, sill and two jambs, not sixteen overlapping port boxes.
        for yy in (y-1.42,y+1.25):
            buf.emit(*api['p_box'](x,yy,z,.85,.17,3.75),col=steel)
        for dz in (-1.8,1.8):
            buf.emit(*api['p_box'](x,y-1.25,z+dz,.85,2.5,.18),col=steel)
        back=p['side']*(p['surface_x']-1.58)
        buf.emit(*api['p_box'](back,y-1.23,z,.045,2.46,3.35),col=dark)


def validate_port_recesses(hull):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    tree=BVHTree.FromPolygons([hull.matrix_world@v.co for v in hull.data.vertices],
                             [list(f.vertices) for f in hull.data.polygons])
    ports=json.loads(hull['casematePorts'])
    for p in ports:
        hit=tree.ray_cast(Vector((p['side']*21,-p['z'],p['axis_y'])),Vector((-p['side'],0,0)),12)
        assert hit[0] is not None and abs(hit[0].x)<p['surface_x']-1.0,('casemate mouth still covered',p,hit)
    print('CASEMATES VALID: all eight mouths genuinely recessed into the shell')


def export_ship_visuals(api,profile,detail_material,key,game_key):
    """Export a Blender source key as a production ship key (US or JP)."""
    out=ROOT.parent.parent/'public/models/ships'
    assert out.is_dir()
    temp=api['coll_named']('export_'+game_key+'_production')
    created=[]
    try:
        # Merge static island geometry into one colour-material primitive. Keep
        # articulated turrets OUT of this mesh, and outline rails with the hull.
        vertices=[];faces=[];colours=[];smooth=[]
        sources=[o for o in bpy.data.collections['ship_'+key].objects
                 if o.type=='MESH' and not o.name.endswith('_rails')]
        for ob in sources:
            mesh=ob.data;offset=len(vertices)
            vertices.extend(tuple(ob.matrix_world@v.co) for v in mesh.vertices)
            attr=mesh.color_attributes.get('Col')
            assert attr is not None,ob.name
            for face in mesh.polygons:
                faces.append(tuple(offset+i for i in face.vertices));smooth.append(face.use_smooth)
                colours.extend(tuple(attr.data[i].color) for i in face.loop_indices)
        mesh=bpy.data.meshes.new(game_key+'_production_island')
        mesh.from_pydata(vertices,[],faces);mesh.update()
        attr=mesh.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
        assert len(attr.data)==len(colours)
        for dst,col in zip(attr.data,colours):dst.color=col
        for face,value in zip(mesh.polygons,smooth):face.use_smooth=value
        mesh.materials.append(detail_material(game_key+'_production_colours'))
        island=bpy.data.objects.new('game_'+game_key+'_super',mesh);temp.objects.link(island);created.append(island)
        api['export_collection'](temp,str(out/(game_key+'_super.glb')))
        temp.objects.unlink(island)

        source=bpy.data.objects['refhull_'+key]
        hull=bpy.data.objects.new('visual_hull',source.data.copy())
        temp.objects.link(hull);created.append(hull)
        stations=[]
        for s in sorted(set(profile.stations()+[.55])):
            if s<.55:continue
            half,_,z=profile.sample(s,'lower',1)
            stations.append([s,half,z])
        hull['waterlineStations']=json.dumps(stations)
        hull['casematePorts']=source.get('casematePorts','[]');hull['casemateCount']=source.get('casemateCount',0)
        hull['visualShipKey']=game_key
        rail_source=bpy.data.objects['super_'+key+'_rails']
        rails=bpy.data.objects.new('visual_rails',rail_source.data.copy())
        rails['physicalRailings']=True
        rails['railStats']=rail_source.get('railStats','{}')
        temp.objects.link(rails);created.append(rails)
        api['export_collection'](temp,str(out/(game_key+'_hull.glb')),extras=True)
        print('PRODUCTION:',game_key,'island, visual hull and rails exported; turret pivots remain separate')
    finally:
        for ob in created:
            mesh=ob.data;bpy.data.objects.remove(ob,do_unlink=True)
            if mesh.users==0:bpy.data.meshes.remove(mesh)
        if temp.users:bpy.data.collections.remove(temp)


def export_kirishima(api,profile,detail_material,key):
    return export_ship_visuals(api,profile,detail_material,key,'jp_bb')
