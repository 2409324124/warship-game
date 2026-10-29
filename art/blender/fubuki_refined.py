"""Fubuki Type I game-oriented review model. Does not export any registered asset.

In Blender: exec(compile(open(PATH,encoding='utf-8').read(),PATH,'exec'))
build_fubuki(); review_fubuki(); save_fubuki()
"""
import bpy
import bmesh
import math
import json
import sys
import importlib
from pathlib import Path
from mathutils import Vector

ROOT=Path(r'D:\warship-game\art\blender')
if str(ROOT) not in sys.path: sys.path.insert(0,str(ROOT))
_cache=sys.dont_write_bytecode
try:
    sys.dont_write_bytecode=True
    import fubuki_profile
    FubukiProfile=importlib.reload(fubuki_profile).FubukiProfile
finally:
    sys.dont_write_bytecode=_cache
KEY='jp_dd_refined'


def load_api():
    ns={};path=ROOT/'warship_build.py'
    exec(compile(path.read_text(encoding='utf-8'),str(path),'exec'),ns)
    return ns


def solid_material(name,color):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes=True
    n=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    n.inputs['Base Color'].default_value=(*color,1)
    n.inputs['Roughness'].default_value=.78
    m.diffuse_color=(*color,1)
    return m


def hull_mesh(a,p,coll):
    verts=[];faces=[];decks=[]
    n=len(p.levels);r=2*n-1;stations=p.stations()
    for s in stations:
        half=[p.sample(s,*layer) for layer in p.levels]
        verts.extend(a['W'](*v) for v in half+[(-x,y,z) for x,y,z in reversed(half[1:])])
    for j in range(len(stations)-1):
        for i in range(r):
            k=(i+1)%r
            faces.append((j*r+i,j*r+k,(j+1)*r+k,(j+1)*r+i))
            if i==n-1:decks.append(len(faces)-1)
    faces.append(tuple(reversed(range(r))))
    me=bpy.data.meshes.new('fubuki_indexed_shell')
    me.from_pydata(verts,[],faces)
    me.materials.append(solid_material('fubuki_shell',(.31,.35,.39)))
    me.materials.append(solid_material('fubuki_deck',(.15,.185,.21)))
    for face in me.polygons:face.use_smooth=True
    for i in decks:me.polygons[i].material_index=1;me.polygons[i].use_smooth=False
    me.polygons[-1].use_smooth=False
    bm=bmesh.new();bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(me);bm.free();me.update()
    for e in me.edges:
        u,v=(me.vertices[i].co for i in e.vertices)
        if abs(u.x)<1e-5 and abs(v.x)<1e-5 and min(u.z,v.z)>=0 and max(u.y,v.y)<-57:
            e.use_edge_sharp=True
    ob=bpy.data.objects.new('refhull_'+KEY,me);coll.objects.link(ob)
    ob['PREVIEW_ONLY']=True;ob['profile_source']='fubuki_profile.json'
    return ob


def build_fubuki():
    a=load_api();p=FubukiProfile();spec=a['SHIPS']['jp_dd']
    original=json.dumps(spec,sort_keys=True)
    old_deck=a['deck_y']
    a['deck_y']=lambda spec,z: p.deck(z/118+.5) if spec['key']=='jp_dd' else old_deck(spec,z)
    ship=a['coll_named']('ship_'+KEY);ref=a['coll_named']('ref_'+KEY)
    hull=hull_mesh(a,p,ref)
    b=a['Buf']();steel=(.57,.62,.66);dark=(.12,.16,.19);deckpaint=(.29,.34,.37)
    smooth_faces=[]
    def emit(shape,col=steel):b.emit(*shape,col=col)
    def rod(v,w,r=.035,col=steel,seg=4,closed=False):
        vs,fs=a['p_rod'](v,w,r,seg)
        if not closed:fs=fs[:seg*2]
        emit((vs,fs),col)
    def plan(z,length,width,rf=.6,rr=.15):
        return [(x,zz+z) for x,zz in a['plan_poly'](length,width,rf,rr,3)]
    def body(z,length,width,y,h,rf=.6,rr=.15,col=steel):
        outline=plan(z,length,width,rf,rr)
        emit(a['p_prism'](outline,outline,y,y+h,True,True),col)
        return outline
    def rail(outline,y,height=.8):
        for u,v in zip(outline,outline[1:]+outline[:1]):
            if math.dist(u,v)<.05:continue
            for up in (.4,height):rod((u[0],y+up,u[1]),(v[0],y+up,v[1]),.023,dark,3)
            rod((u[0],y,u[1]),(u[0],y+height,u[1]),.028,dark,3)
    def windows(outline,y):
        for u,v in zip(outline,outline[1:]+outline[:1]):
            dx,dz=v[0]-u[0],v[1]-u[1];length=math.hypot(dx,dz)
            if length<.45:continue
            nx,nz=-dz/length,dx/length
            # plan_poly is clockwise in (x,z), so left normal is outward.
            for i in range(max(1,int(length/.85))):
                t=(i+.5)/max(1,int(length/.85))
                x=u[0]+dx*t+nx*.018;z=u[1]+dz*t+nz*.018
                emit(a['p_box_y'](x,y,z,.47,.40,.025,math.atan2(-dz,dx)),dark)

    # Compact continuous lower bridge, one enclosed wheelhouse, optical director.
    bridge_deck=p.deck(26.5/118+.5)
    body(26.5,8.8,6.4,bridge_deck-.05,2.05)
    wheel=body(27.1,6.4,5.8,bridge_deck+2,1.65)
    windows(wheel,bridge_deck+2.85)
    wings=body(26.8,6.6,7.2,bridge_deck+3.65,.10,col=deckpaint)
    rail(wings,bridge_deck+3.75,.7)
    body(27,3.8,3.5,bridge_deck+3.75,.95,rf=.8)
    emit(a['p_cyl_x'](0,bridge_deck+5.1,27.2,.20,3.3,10))
    emit(a['p_cyl'](0,bridge_deck+4.7,27.2,.48,.43,.4,10))
    for side in (-1,1):
        emit(a['p_box'](side*3.4,bridge_deck+3.8,27.5,.18,.24,.35),(.23,.40,.30) if side<0 else (.52,.20,.18))
        # Bridge-wing knees, reaching into the continuous lower house.
        for z in (25,28):rod((side*2.6,bridge_deck+1.8,z),(side*3.5,bridge_deck+3.65,z),.07,steel,5)
        for y in (bridge_deck+.65,bridge_deck+1.35):
            for z in (25,27.3,29.1):emit(a['p_cyl_x'](side*3.21,y,z,.11,.035,8),dark)

    # Foremast, tripod supports, yard and a small optical lookout; no radar.
    mastbase=p.deck(22/118+.5)+.1
    rod((0,mastbase,22),(0,20.2,20.7),.12,steel,8)
    for side in (-1,1):rod((side*1.45,mastbase,20.3),(0,14.8,21.2),.10,steel,6)
    rod((-3,15.3,21),(3,15.3,21),.055,dark,5)
    rod((-1.8,18.0,20.9),(1.8,18.0,20.9),.045,dark,4)
    lookout=plan(21.1,1.25,1.35,.7,.7)
    emit(a['p_prism'](lookout,lookout,13.0,13.65,True,True));rail(lookout,13.65,.45)
    for side in (-1,1):
        rod((side*2.7,15.3,21),(0,18.5,20.9),.013,dark,3)
    for i in range(9):rod((-.35,mastbase+.6+i*.65,21.9),(.35,mastbase+.6+i*.65,21.9),.02,dark,3)

    # Two raked elliptical funnels: Type I front funnel is broader, not Akatsuki.
    for z,r,flatten,h in ((9,1.80,.68,6.2),(-3,1.40,.78,5.4)):
        y=p.deck(z/118+.5)
        rake=math.radians(8);shift=-math.tan(rake)*h
        start=len(b.f)
        emit(a['p_cyl'](0,y,z,r,r*.94,h,20,False,flatten,rake,True))
        smooth_faces.extend(range(start,start+40))
        emit(a['p_cyl'](0,y+h-.45,z+shift+.06,r*.95,r*1.02,.45,20,False,flatten,0,False),dark)
        outer=[(math.cos(i*math.tau/20)*r*1.02*flatten,y+h,z+shift+math.sin(i*math.tau/20)*r*1.02) for i in range(20)]
        inner=[(x*.84,yy,zz+(z+shift-zz)*.16) for x,yy,zz in outer]
        vs=[a['W'](*v) for v in outer+inner];fs=[]
        for i in range(20):j=(i+1)%20;fs.extend(((i,j,20+j),(i,20+j,20+i)))
        emit((vs,fs),dark)
        emit(a['p_cyl'](0,y+h-.42,z+shift,r*.85,r*.85,.01,20,True,flatten),dark)
        # Thin steam pipes behind the casing, not black bands around its middle.
        for side in (-1,1):rod((side*r*flatten*.90,y,z-.25),(side*r*flatten*.90,y+h*.87,z+shift-.25),.055,dark,5)

    # Type I gooseneck ventilators, elbowed into forward-facing cowls.
    for z,height in ((13.0,3.1),(.0,2.7)):
        for side in (-1,1):
            x=side*2.0;y=p.deck(z/118+.5)
            emit(a['p_cyl'](x,y,z,.48,.43,.16,12))
            # Continuous quarter-torus elbow, rather than intersecting capped rods.
            rings=[(y,z,0)]
            for i in range(7):
                t=i*math.pi/12
                rings.append((y+height-.55+.55*math.sin(t),z+.55-.55*math.cos(t),t))
            rings.append((y+height,z+1.05,math.pi/2))
            vs=[];fs=[]
            for yy,zz,t in rings:
                for i in range(10):
                    q=i*math.tau/10
                    vs.append(a['W'](x+.37*math.cos(q),yy-.37*math.sin(q)*math.sin(t),zz+.37*math.sin(q)*math.cos(t)))
            for j in range(len(rings)-1):
                for i in range(10):
                    k=(i+1)%10
                    fs.extend(((j*10+i,j*10+k,(j+1)*10+k),(j*10+i,(j+1)*10+k,(j+1)*10+i)))
            start=len(b.f);emit((vs,fs));smooth_faces.extend(range(start,len(b.f)))
            emit(a['p_cyl_z'](x,y+height,z+1.10,.43,.12,12))
            emit(a['p_cyl_z'](x,y+height,z+1.17,.33,.02,12),dark)

    # Three triple torpedo mounts, all on the centreline, deck coordinates retained.
    for z in (3.5,-10,-18.5):
        y=p.deck(z/118+.5)
        emit(a['p_cyl'](0,y,z,1.18,1.15,.55,16),dark)
        emit(a['p_cyl'](0,y+.5,z,.64,.64,.45,12))
        for dz in (-1.5,1.5):emit(a['p_box'](0,y+.55,z+dz,2.25,.25,.20),deckpaint)
        for x in (-.68,0,.68):
            prof=[(.22,-3.5),(.22,3.35),(.24,3.45),(.16,3.45),(.16,3.05),(0,3.05)]
            emit(a['p_lathe_z'](x,y+.95,z,prof,10),(.30,.35,.39))
        body(z-.4,2.3,2.4,y+.85,.85,rf=.25,rr=.25)
        emit(a['p_box'](0,y+1.68,z-.4,1.65,.04,1.35),deckpaint)

    # Fixed foundation under the elevated aft main gun; never a floating turret.
    stern=p.deck(-27/118+.5)
    body(-29.6,12,5.0,stern-.05,2.25,rf=.2,rr=.5)
    body(-23.3,3.2,3.1,stern,1.2,rf=.2)
    rod((0,stern+1.0,-24),(0,14.1,-25),.10,steel,7)
    rod((-2.2,12.1,-24.8),(2.2,12.1,-24.8),.045,dark,4)
    # Limited AA proxy; do not mix in a late-war radar/AA forest.
    for side in (-1,1):
        x=side*3.45;z=-7.8;y=p.deck(z/118+.5)
        emit(a['p_cyl'](x,y,z,.82,.82,.15,12),deckpaint)
        a['build_part'](b,spec,{'k':'aa','x':x,'z':z,'y':.15,'kind':'j2'})
    # Ship's boats and real davit support legs, two abreast in the waist.
    for side in (-1,1):
        x=side*3.7;z=8;y=p.deck(z/118+.5)+.65
        bottom=[(xx+x,zz+z) for xx,zz in a['plan_poly'](4.6,1.2,.8,.8,3)]
        top=[(xx+x,zz+z) for xx,zz in a['plan_poly'](6,1.8,.7,.6,3)]
        inner=[(x+(xx-x)*.84,z+(zz-z)*.93) for xx,zz in top]
        emit(a['p_prism'](bottom,top,y,y+.70,False,True),(.63,.61,.55))
        vv,ff=a['p_prism'](inner,inner,y+.18,y+.67,False,True)
        emit((vv,[tuple(reversed(f)) for f in ff]),deckpaint)
        # Thin gunwale ring, open interior and benches; no davit posts through hull.
        for u,v in zip(top,top[1:]+top[:1]):rod((u[0],y+.7,u[1]),(v[0],y+.7,v[1]),.045,dark,4)
        for dz in (-1.4,0,1.4):emit(a['p_box'](x,y+.48,z+dz,1.35,.10,.30),(.60,.57,.49))
        for zz in (5.9,10.1):
            base=p.deck(zz/118+.5)
            rod((side*2.6,base,zz),(side*2.6,base+2.6,zz),.08,steel,5)
            rod((side*2.6,base+2.6,zz),(side*3.7,base+3.05,zz),.08,steel,5)
            rod((side*3.7,base+3.05,zz),(side*3.7,y+.72,zz),.018,dark,3)

    # Forecastle capstans, short anchor chains and small supported deck fittings.
    for side in (-1,1):
        for z in (46,49):emit(a['p_cyl'](side*.8,p.deck(z/118+.5),z,.28,.32,.42,10),dark)
        for z in (53,-50):
            y=p.deck(z/118+.5)
            emit(a['p_box'](side*1.1,y,z,.65,.08,1.4),dark)
            for dz in (-.4,.4):emit(a['p_cyl'](side*1.1,y+.08,z+dz,.14,.18,.32,8))
        for z in (-55.5,):
            y=p.deck(z/118+.5)
            emit(a['p_box'](side*1.1,y,z,.65,.18,3.8),dark)
            for dz in (-1.2,0,1.2):emit(a['p_cyl_x'](side*1.1,y+.42,z+dz,.25,.52,8),dark)
        rod((side*.8,p.deck(49/118+.5)+.08,49),(side*1.5,p.deck(54/118+.5)+.08,54),.035,dark,5)
    for z in (33,-39):emit(a['p_box'](0,p.deck(z/118+.5),z,1,.15,1.5),dark)

    # Thin side rails. Stop and restart at the forecastle break, not diagonally across it.
    for lo,hi in ((.025,.615),(.625,.992)):
        steps=math.ceil((hi-lo)*118/2.6)
        for side in (-1,1):
            points=[]
            for i in range(steps+1):
                x,y,z=p.sample(lo+(hi-lo)*i/steps,'upper',1)
                points.append((side*max(0,x-.08),y+.03,z))
            for u,v in zip(points,points[1:]):
                heights=(.82,) if -25<u[2]<20 else (.42,.82)
                for up in heights:rod((u[0],u[1]+up,u[2]),(v[0],v[1]+up,v[2]),.021,dark,3)
            for x,y,z in points:rod((x,y,z),(x,y+.82,z),.025,dark,3)

    island=a['make_obj']('super_'+KEY,b,coll=ship)
    for i in smooth_faces:island.data.polygons[i].use_smooth=True
    island['PREVIEW_ONLY']=True;island['profile']='Type I Fubuki photo-informed game interpretation'
    island['torpedo_mounts']=3;island['torpedo_tubes_per_mount']=3
    # Reuse existing shared gun meshes; refine these independently after silhouette review.
    a['preview_turrets']('jp_dd',collection_name='preview_'+KEY)
    a['show_ship'](KEY);bpy.context.view_layer.update()
    assert json.dumps(spec,sort_keys=True)==original,'Original simulation snapshot mutated'
    counts=validate_fubuki()
    hull['triangle_count']=counts['ref_'];island['triangle_count']=counts['ship_']
    island['review_status']='BLENDER_REVIEW_DRAFT_NOT_EXPORTED'
    text=bpy.data.texts.get('START_HERE_fubuki.txt') or bpy.data.texts.new('START_HERE_fubuki.txt')
    text.clear()
    text.write('FUBUKI TYPE I — independent game-oriented review model.\n'
               'Save target: checkpoint_17_fubuki_refined.blend\n'
               'Washington accepted baseline checkpoint_15 is unchanged.\n'
               f'Hull+deck {counts["ref_"]} tri; structure {counts["ship_"]} tri; guns {counts["preview_"]} tri; total {sum(counts.values())} tri.\n'
               'Actual 118 x 10.4m. Visual freeboard lowered; absolute turret preview heights follow new deck.\n'
               'No sim/collision/manifest/GLB changes. Existing shared main-gun meshes retained.\n'
               'See FUBUKI_REFINEMENT.md for reference, limitations and rebuild.\n'
               'show_ship("jp_dd_refined") for new draft; show_ship("jp_dd") for old game reference.\n')
    for name in ('fubuki_profile.py','fubuki_profile.json','fubuki_refined.py','FUBUKI_REFINEMENT.md'):
        path=ROOT/name
        if path.exists():
            text=bpy.data.texts.get(name) or bpy.data.texts.new(name)
            text.clear();text.write(path.read_text(encoding='utf-8'))
    return hull,island


def validate_fubuki():
    p=FubukiProfile();hull=bpy.data.objects['refhull_'+KEY]
    bm=bmesh.new();bm.from_mesh(hull.data)
    assert all(e.is_manifold for e in bm.edges),'Open hull'
    assert all(f.calc_area()>1e-9 for f in bm.faces),'Degenerate faces'
    assert bm.calc_volume(signed=True)>0,'Inward normals'
    bm.free()
    vertices=[v.co for v in hull.data.vertices]
    assert all(math.isfinite(c) for v in vertices for c in v)
    assert abs(max(v.x for v in vertices)-min(v.x for v in vertices)-10.4)<1e-4
    assert abs(max(v.y for v in vertices)-min(v.y for v in vertices)-118)<1e-4
    counts={}
    for prefix in ('ship_','ref_','preview_'):
        counts[prefix]=sum(len(f.vertices)-2 for o in bpy.data.collections[prefix+KEY].objects if o.type=='MESH' for f in o.data.polygons)
    assert counts['ref_']<=p.data['budgetHullDeck'],counts
    assert sum(counts.values())<=p.data['budgetWholePreview'],counts
    guns=list(bpy.data.collections['preview_'+KEY].objects)
    assert len(guns)==6
    a=load_api()
    for i,t in enumerate(a['SHIPS']['jp_dd']['tur']):
        barrel=next(o for o in guns if o.get('mount_index')==i and o.get('export_role')=='barrel')
        ts=a['TS'][t['kind']]
        # Matrix check uses the preview deck explicitly; no claim these absolute
        # heights equal the current game's original generic freeboard.
        from mathutils import Matrix
        expected=Matrix.Translation(Vector(a['W'](t['x'],p.deck(t['z']/118+.5)+t['y'],t['z']))) @ Matrix.Rotation(t['face'],4,'Z') @ Vector(a['W'](0,ts['h']/2,ts['len']*.18))
        assert (barrel.matrix_world.translation-expected).length<.001
    visible=[o.name for o in bpy.context.scene.objects if o.name.startswith('refhull_') and not o.hide_get() and not o.hide_render]
    assert visible==[hull.name],visible
    print('FUBUKI VALID: closed shell, positive volume, actual 118 x 10.4m, three articulated twin mounts, single visible ship')
    print('TRIANGLES',counts,'TOTAL',sum(counts.values()))
    return counts


def review_fubuki():
    a=load_api();a['show_ship'](KEY);a['SHOTDIR']=str(ROOT/'qa')
    obs=[o for prefix in ('ship_','ref_','preview_') for o in bpy.data.collections[prefix+KEY].objects]
    hull=bpy.data.objects['refhull_'+KEY]
    for label,kwargs in (
        ('side',dict(yaw=90,pitch=0,ortho=True,res=(1500,650))),
        ('top',dict(yaw=0,pitch=90,ortho=True,res=(1450,650))),
        ('front',dict(yaw=0,pitch=0,ortho=True,res=(800,1000))),
        ('qbow',dict(yaw=38,pitch=14,res=(1400,850))),
        ('qstern',dict(yaw=-140,pitch=18,res=(1300,800))),
        ('bridge',dict(yaw=42,pitch=12,focus=(0,6,23),span=28,res=(1200,850))),
        ('battery',dict(yaw=48,pitch=30,focus=(0,3,-7),span=42,res=(1200,850))),
    ):a['render_shot']('fubuki_refined_'+label,obs,**kwargs)
    a['render_shot']('fubuki_refined_bottom',[hull],yaw=36,pitch=-14,focus=(0,0,37),span=45,res=(1200,750))
    a['render_shot']('fubuki_refined_hull_side',[hull],yaw=90,pitch=0,ortho=True,res=(1500,650))
    mat=bpy.data.materials.get('fubuki_normal_diagnostic') or bpy.data.materials.new('fubuki_normal_diagnostic')
    mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear()
    g=nodes.new('ShaderNodeNewGeometry');mix=nodes.new('ShaderNodeMixRGB')
    mix.inputs[0].default_value=.5;mix.inputs[1].default_value=(1,1,1,1)
    em=nodes.new('ShaderNodeEmission');out=nodes.new('ShaderNodeOutputMaterial')
    links=mat.node_tree.links
    links.new(g.outputs['Normal'],mix.inputs[2]);links.new(mix.outputs[0],em.inputs['Color']);links.new(em.outputs[0],out.inputs['Surface'])
    layer=bpy.context.view_layer;old=layer.material_override
    try:
        layer.material_override=mat
        a['render_shot']('fubuki_refined_normals_bottom',[hull],yaw=36,pitch=-14,focus=(0,0,37),span=45,res=(1200,750))
        a['render_shot']('fubuki_refined_normals_front',[hull],yaw=0,pitch=-3,ortho=True,focus=(0,0,35),span=15,res=(900,1000))
    finally:layer.material_override=old


def save_fubuki():
    validate_fubuki()
    path=ROOT/'checkpoint_17_fubuki_refined.blend'
    assert not path.exists() or bpy.data.filepath==str(path),'Refuse to overwrite another checkpoint'
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    print('Saved',path)
