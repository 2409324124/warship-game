"""User-directed chunky pagoda, central mast and supported visual AA stations.

Fuso-inspired game massing per user feedback, not a dimensioned reconstruction.
Every group is built locally then translated ONCE.
"""
import math
import json
from pathlib import Path

STEEL=(.55,.60,.64)
EDGE=(.43,.48,.52)
DECK=(.25,.30,.32)
DARK=(.095,.135,.155)
GLASS=(.095,.16,.19)


def upperworks_layout(api):
    return json.loads(Path(api['JSON_PATH']).with_name('kirishima_upperworks_layout.json').read_text(encoding='utf-8'))


class Kit:
    def __init__(self,api,buf,origin):
        self.a,self.b,self.origin=api,buf,origin

    def emit(self,shape,col=STEEL):
        vertices,faces=shape
        x,y,z=self.origin
        # primitives have already converted their LOCAL hull coordinates using W.
        self.b.emit([(vx+x,vy-z,vz+y) for vx,vy,vz in vertices],faces,col=col)

    def plan(self,z,length,width,rf=.5,rr=.3):
        return [(x,zz+z) for x,zz in self.a['plan_poly'](length,width,rf,rr,3)]

    def body(self,z,y,length,width,height,shrink=.08):
        lo=self.plan(z,length,width)
        hi=self.plan(z,length-shrink,width-shrink)
        self.emit(self.a['p_prism'](lo,hi,y,y+height,True,True))
        return lo

    def rod(self,p,q,r=.035,col=EDGE,seg=4):
        vs,fs=self.a['p_rod'](p,q,r,seg)
        self.emit((vs,fs[:2*seg]),col)

    def box(self,x,y,z,w,h,d,col=STEEL):
        self.emit(self.a['p_box'](x,y,z,w,h,d),col)

    def windows(self,outline,y,h=.48):
        for p,q in zip(outline,outline[1:]+outline[:1]):
            dx,dz=q[0]-p[0],q[1]-p[1]
            length=math.hypot(dx,dz)
            if length<.48:continue
            count=max(1,int(length/.8))
            nx,nz=-dz/length,dx/length
            for i in range(count):
                t=(i+.5)/count
                self.emit(self.a['p_box_y'](p[0]+dx*t+nx*.025,y,p[1]+dz*t+nz*.025,
                                           .44,h,.035,math.atan2(-dz,dx)),GLASS)

    def rails(self,outline,y,height=.82):
        # Continuous horizontal members; posts distributed by arc length instead
        # of one at every little corner segment of the rounded outline.
        walked=0.;next_post=0.
        for p,q in zip(outline,outline[1:]+outline[:1]):
            distance=math.dist(p,q)
            if distance<1e-6:continue
            for up in (.43,height):self.rod((p[0],y+up,p[1]),(q[0],y+up,q[1]),.023,DARK,3)
            while next_post<=walked+distance:
                t=(next_post-walked)/distance
                x,z=p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t
                self.rod((x,y,z),(x,y+height,z),.029,EDGE,3)
                next_post+=1.6
            walked+=distance

    def deck(self,z,y,length,width,wall=0):
        outline=self.plan(z,length,width,.55,.25)
        self.emit(self.a['p_prism'](outline,outline,y-.17,y,True,True),DECK)
        if wall:
            inner=[(x*.97,z+(zz-z)*.97) for x,zz in outline]
            # Narrow solid parapet strip, not a cap over the entire deck.
            n=len(outline)
            for i in range(n):
                j=(i+1)%n
                plan=[outline[i],outline[j],inner[j],inner[i]]
                self.emit(self.a['p_prism'](plan,plan,y,y+wall,True,True),STEEL)
        self.rails(outline,y+wall,.75 if wall else .82)
        return outline

    def knees(self,y,z,width,length):
        for side in (-1,1):
            for dz in (-length*.28,length*.28):
                self.rod((side*1.45,y-1.65,z+dz*.58),(side*(width/2-.18),y-.18,z+dz),.085,EDGE,5)

    def ladder(self,x,z,y0,y1):
        for dx in (-.25,.25):self.rod((x+dx,y0,z),(x+dx,y1,z),.025,EDGE,4)
        for i in range(int((y1-y0)/.42)+1):
            y=y0+i*.42
            self.rod((x-.25,y,z),(x+.25,y,z),.022,EDGE,3)

    def optical(self,x,y,z,span=6):
        self.box(x,y,z,span,.48,.62,EDGE)
        for side in (-1,1):
            self.box(x+side*(span/2-.25),y-.12,z,.74,.78,1.05,STEEL)
            self.box(x+side*(span/2-.25),y+.10,z+.54,.24,.24,.025,DARK)

    def searchlight(self,x,y,z):
        self.emit(self.a['p_cyl'](x,y,z,.22,.22,.55,8),EDGE)
        for dx in (-.4,.4):self.box(x+dx,y+.4,z,.10,.6,.30,EDGE)
        self.emit(self.a['p_cyl_z'](x,y+.9,z,.50,.62,12),STEEL)
        self.emit(self.a['p_cyl_z'](x,y+.9,z+.33,.41,.025,12),(.55,.61,.61))


def build_bridge_refined(api,buf,deck,layout,dz=0):
    root=next(a for a in layout['anchors'] if a['id']=='BRIDGE_BASE')
    # Resolve Y before applying the test translation: changing the anchor should
    # not rebuild each floor against a different patch of deck.
    k=Kit(api,buf,(root['x'],deck(root['z'])+root['deckOffset'],root['z']+dz))
    start=len(buf.v)
    # Broad lower bridge, rounded conning position, glazed navigation bridge.
    base=k.body(0,-.20,15.4,13.2,4.50,.35)
    for side in (-1,1):
        for z in (-4.5,-2.0,.5,3.0,5.0):
            k.emit(api['p_cyl_x'](side*6.62,1.65,z,.13,.04,8),DARK)
    conning=k.body(2.8,4.25,8.4,8.8,3.0,.20)
    k.windows(conning,6.55,.22)
    k.deck(1.2,7.5,11.4,12.8,.30)
    pilot=k.body(1.0,7.5,10.0,10.2,2.50,.12)
    k.windows(pilot,8.80,.64)
    k.deck(1.2,10.05,11.6,13.0,.20)

    # User requests a heavier Fuso-inspired impression: broaden the enclosed
    # backbone and rooms, retaining stepped decks instead of enlarging railings.
    p0=k.plan(-1.8,7.2,6.4)
    p1=k.plan(-1.0,5.2,4.3)
    k.emit(api['p_prism'](p0,p1,4.3,28.7,True,True),STEEL)
    for side in (-1,1):
        k.rod((side*2.9,4.3,-3.9),(side*.7,29.5,-1.6),.19,EDGE,8)
        for y in (5.5,10.5,15.5,20.5):
            k.rod((side*2.7,y,-3.7),(side*.7,y+4.5,-1.7),.075,EDGE,5)

    # Unequal deck sizes/offsets and separate enclosures make a pagoda silhouette,
    # rather than adding thin lips around one full-height solid truncated cone.
    tiers=[(.3,12.8,10.6,10.4),(-.3,16.0,9.4,10.8),
           (.9,19.3,8.5,8.4),(.3,22.4,7.4,9.1),
           (1.2,25.5,6.2,7.0),(.8,28.3,5.8,6.0)]
    rooms=upperworks_layout(api)['rooms']
    for z,y,length,width in tiers:
        k.deck(z,y,length,width,.20 if y in (16.,22.4) else 0)
        k.knees(y,z,width,length)
    for z,y,length,width,height in rooms:
        plan=k.body(z,y,length,width,height,.08)
        k.windows(plan,y+.85,.40)
    # Observers / binocular positions, compact rather than giant gun-like rods.
    for side in (-1,1):
        for z,y,x in ((2.4,12.85,4.7),(1.0,22.65,3.9)):
            k.emit(api['p_cyl'](side*x,y,z,.16,.14,.65,8),EDGE)
            k.box(side*x,y+.65,z,.55,.22,.45,DARK)
        k.emit(api['p_cyl'](side*5.6,15.82,-1.8,.85,.85,.18,12),DECK)
        k.rod((side*3.5,14.5,-1.8),(side*5.6,15.82,-1.8),.085,EDGE,5)
        k.searchlight(side*5.6,16.0,-1.8)
    k.optical(0,19.65,4.15,5.4)
    for x in (-1.5,1.5):k.emit(api['p_cyl'](x,19.3,4.15,.12,.12,.35,8),EDGE)

    # Armoured main director on its own upper platform, optical ears integrated.
    director=k.body(.8,28.3,4.8,5.0,1.7,.18)
    k.windows(director,28.95,.24)
    k.optical(0,29.8,.8,8.2)
    # Signal mast aft of the tower, tied into the mast-supported core.
    k.rod((0,5,-3.4),(0,34,-2.8),.13,STEEL,8)
    for y,w in ((21.0,10.2),(26.4,7.1),(31.5,4.1)):
        k.rod((-w/2,y,-3.1),(w/2,y,-3.1),.055,EDGE,5)
        for side in (-1,1):k.rod((side*w/2,y,-3.1),(0,y+2.0,-3.0),.013,DARK,3)
    k.ladder(5.55,-2.6,4.3,10.05)
    k.ladder(4.6,-3.7,12.8,16.0)
    k.ladder(3.65,0.0,19.3,25.5)
    k.box(3.55,25.4,0,.60,.10,.8,DECK)
    # The access flight is visibly attached to the lower bridge.
    for dx in (-.35,.35):k.rod((4.5+dx,4.3,-3.6),(4.5+dx,7.5,-5.1),.036,EDGE,4)
    for i in range(9):
        t=i/8;k.rod((4.15,4.3+3.2*t,-3.6-1.5*t),(4.85,4.3+3.2*t,-3.6-1.5*t),.045,EDGE,4)
    buf.pagoda_vertex_range=(start,len(buf.v))


def build_aft_refined(api,buf,deck,layout):
    root=next(a for a in layout['anchors'] if a['id']=='AFT_CONTROL_BASE')
    k=Kit(api,buf,(root['x'],deck(root['z']),root['z']))
    k.body(0,-.16,14.0,11.7,4.55,.30)
    p=k.body(1.4,4.35,9.1,8.3,3.1,.16)
    k.windows(p,5.7,.55)
    k.deck(.7,7.5,10.5,10.2,.25)
    k.body(.9,7.5,5.8,6.0,2.2,.12)
    k.optical(0,9.65,.9,7.0)
    # Mainmast is a tall, OPEN tripod behind a LOW director house.
    z=-6.0
    k.rod((0,4.4,z),(0,30.5,z-.6),.17,STEEL,8)
    for side in (-1,1):
        k.rod((side*2.7,4.4,z-1.4),(0,20.0,z-.4),.13,EDGE,6)
        for y in (6.5,11.,15.5):
            k.rod((side*2.1,y,z-1.0),(0,y+4.0,z-.3),.055,EDGE,4)
    k.deck(z,13.2,4.5,5.1)
    k.searchlight(-1.3,13.3,z)
    k.searchlight(1.3,13.3,z)
    k.deck(z-.2,21.4,2.6,2.7)
    for y,w in ((19.0,12.0),(25.7,8.2),(29.0,4.3)):
        k.rod((-w/2,y,z-.4),(w/2,y,z-.4),.055,EDGE,5)
        for side in (-1,1):k.rod((side*w/2,y,z-.4),(0,y+1.6,z-.4),.013,DARK,3)
    k.ladder(.8,z-.1,4.6,20.9)
    # Derrick before the aft battery, supported on the aft working deck.
    k.emit(api['p_cyl'](0,0,-11.5,.52,.48,7.0,12),EDGE)
    k.rod((0,6.7,-11.5),(5.2,10.9,-20.0),.11,STEEL,6)
    k.rod((0,7.0,-11.5),(5.2,10.9,-20.0),.035,DARK,4)
    k.rod((5.2,10.9,-20.0),(5.2,7.2,-20.0),.017,DARK,3)


def build_central_mast(api,buf,deck,layout):
    """A substantial tripod BETWEEN the two funnels, rooted in the boat deck."""
    data=upperworks_layout(api)['central_mast']
    house=next(a for a in layout['anchors'] if a['id']=='MID_DECKHOUSE')
    roof=deck(house['z'])+house['footprint']['h']+.12
    k=Kit(api,buf,(data['x'],roof,data['z']))
    k.emit(api['p_cyl'](0,-.15,0,.85,.72,.65,12),EDGE)
    k.rod((0,0,0),(0,data['height_above_roof'],-.75),.25,STEEL,10)
    for side in (-1,1):
        k.emit(api['p_cyl'](side*2.6,-.12,-1.9,.44,.38,.30,10),EDGE)
        k.rod((side*2.6,0,-1.9),(0,18.0,-.5),.18,STEEL,8)
        for y in (3.5,7.5,11.5,15.5):
            k.rod((side*2.15,y,-1.6),(0,y+3.5,-.3),.075,EDGE,5)
    k.rod((0,0,1.6),(0,15.0,-.45),.17,STEEL,8)
    for z,y,length,width in ((-.2,9.8,5.2,6.2),(-.4,16.9,4.0,4.8)):
        k.deck(z,y,length,width,.2)
        # Unlike the broad bridge trunk, the mast shaft is narrow: braces must
        # start on that shaft, not at the bridge helper's +/-1.45m root points.
        shaft_z=-.75*(y-1.9)/data['height_above_roof']
        for side in (-1,1):
            for dz in (-length*.28,length*.28):
                k.rod((side*.13,y-1.9,shaft_z),
                      (side*(width/2-.18),y-.17,z+dz),.085,EDGE,5)
    k.body(-.35,9.8,2.7,2.8,1.65,.08)
    k.optical(0,11.4,-.35,4.4)
    for y,w in ((13.8,12.5),(20.4,8.5),(24.5,5.0)):
        k.rod((-w/2,y,-.5),(w/2,y,-.5),.075,EDGE,6)
        for side in (-1,1):k.rod((side*w/2,y,-.5),(0,y+1.5,-.55),.018,DARK,3)
    k.ladder(.60,-.15,.55,16.9)
    buf.mast_anchor={'x':data['x'],'z':data['z'],'roof_y':roof,
                     'top_y':roof+data['height_above_roof']}


def _rotate_station(buf,start,cx,cz,yaw):
    c,s=math.cos(math.radians(yaw)),math.sin(math.radians(yaw))
    for i in range(start,len(buf.v)):
        x,minus_z,y=buf.v[i]
        dx,dz=x-cx,-minus_z-cz
        buf.v[i]=(cx+dx*c+dz*s,-(cz-dx*s+dz*c),y)


def build_supported_aa(api,supports,guns,deck,layout,spec):
    """One visual AA schedule, with a continuous deck-to-pedestal support path.

    Replaces both old proxy sets. Gun and support vertex ranges are retained so
    validation probes the real geometry rather than trusting these coordinates.
    """
    records=[]
    def add(buf,shape,col=STEEL):buf.emit(*shape,col=col)
    for station in upperworks_layout(api)['aa_stations']:
        cx,cz=station['x'],station['z']
        floor=deck(cz);top=floor+station['height'];radius=station['radius']
        heavy=station['kind']=='heavy'
        begin=len(supports.v)
        # Broad foundation plate, tapered tower, overhanging deck and knees.
        add(supports,api['p_cyl'](cx,floor-.12,cz,1.30 if heavy else 1.0,
                                 1.20 if heavy else .9,.24,12,cap_bot=False),EDGE)
        add(supports,api['p_cyl'](cx,floor-.08,cz,1.12 if heavy else .85,
                                 .75 if heavy else .60,station['height']-.20,12,cap_bot=False))
        add(supports,api['p_cyl'](cx,top-.28,cz,radius,radius,.28,16),DECK)
        for dx,dz in ((-.65,-.65),(-.65,.65),(.65,-.65),(.65,.65)):
            a=(cx+dx,floor+.12,cz+dz)
            b=(cx+dx*radius*.94,top-.25,cz+dz*radius*.94)
            vs,fs=api['p_rod'](a,b,.095 if heavy else .075,5)
            add(supports,(vs,fs[:10]),EDGE)
        # 270-degree low splinter shield, open toward the barrels. Mesh is
        # connected around the arc instead of twelve overlapping box panels.
        vertices=[];faces=[];segments=12
        for i in range(segments+1):
            a=math.radians(45+270*i/segments)
            for rr,yy in ((radius-.12,top),(radius,top),
                          (radius-.12,top+.65),(radius,top+.65)):
                vertices.append(api['W'](cx+rr*math.sin(a),yy,cz+rr*math.cos(a)))
        for i in range(segments):
            n=i*4;m=n+4
            faces.extend(((n,m,m+2,n+2),(n+1,n+3,m+3,m+1),
                          (n+2,m+2,m+3,n+3),(n,n+1,m+1,m)))
        faces.extend(((0,2,3,1),(segments*4,segments*4+1,segments*4+3,segments*4+2)))
        add(supports,(vertices,faces))
        _rotate_station(supports,begin,cx,cz,station['yaw'])
        support_end=len(supports.v)

        gun_begin=len(guns.v)
        if heavy:
            add(guns,api['p_cyl'](cx,top,cz,1.42,1.34,.85,16),EDGE)
            add(guns,api['p_box'](cx,top+.85,cz-.30,2.6,1.05,.16))
            for ox in (-.55,.55):
                vs,fs=api['p_rod']((cx+ox,top+1.25,cz+.25),
                                   (cx+ox,top+1.95,cz+3.2),.13,8)
                add(guns,(vs,fs),DARK)
        else:
            api['build_part'](guns,spec,{'k':'aa','x':cx,'z':cz,
                 'y':top-api['deck_y'](spec,cz),'kind':'j2'})
        _rotate_station(guns,gun_begin,cx,cz,station['yaw'])
        records.append(dict(station,deck_y=floor,platform_y=top,
                            support_vertices=[begin,support_end],
                            gun_vertices=[gun_begin,len(guns.v)]))
    supports.aa_stations=records
    guns.aa_stations=records
    return records


def validate_supported_aa(api,deck,profile,key):
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    support=bpy.data.objects['super_'+key+'_aa_supports']
    gun=bpy.data.objects['super_'+key+'_aa_guns']
    hull=bpy.data.objects['refhull_'+key]
    records=json.loads(support['aa_stations'])
    assert len(records)==12 and len({r['id'] for r in records})==12
    def tree(ob):
        return BVHTree.FromPolygons([ob.matrix_world@v.co for v in ob.data.vertices],
                                   [list(f.vertices) for f in ob.data.polygons])
    support_tree,hull_tree=tree(support),tree(hull)
    error=0.
    for rec in records:
        x,z,y=rec['x'],rec['z'],rec['platform_y']
        # Probe the centre and two off-centre points of each actual platform.
        for dx,dz in ((0,0),(.45*rec['radius'],0),(0,.45*rec['radius'])):
            hit=support_tree.ray_cast(Vector(api['W'](x+dx,y+.035,z+dz)),Vector((0,0,-1)),.10)
            assert hit[0] is not None,('floating AA base',rec['id'],dx,dz)
            error=max(error,abs(hit[0].z-y))
        a,b=rec['gun_vertices']
        actual_base=min((gun.matrix_world@v.co).z for v in gun.data.vertices[a:b])
        assert abs(actual_base-y)<1e-4,('gun/platform height mismatch',rec['id'])
        a,b=rec['support_vertices']
        actual_foot=min((support.matrix_world@v.co).z for v in support.data.vertices[a:b])
        assert rec['deck_y']-.14<actual_foot<=rec['deck_y'],('tower root detached',rec['id'])
        hit=hull_tree.ray_cast(Vector(api['W'](x,rec['deck_y']+.05,z)),Vector((0,0,-1)),.12)
        assert hit[0] is not None and abs(hit[0].z-rec['deck_y'])<1e-4,('no hull deck under tower',rec['id'])
        half=profile.sample(z/profile.data['length']+.5,'upper',1)[0]
        assert abs(x)+rec['radius']<half-.15,('AA platform over hull side',rec['id'])
    assert error<1e-4,('AA platform probe error',error)
    mast=bpy.data.objects['super_'+key+'_central_mast']
    info=json.loads(mast['mast_anchor'])
    roof_tree=tree(bpy.data.objects['super_'+key+'_mid'])
    for dx,dz in ((0,0),(-2.6,-1.9),(2.6,-1.9),(0,1.6)):
        hit=roof_tree.ray_cast(Vector(api['W'](info['x']+dx,info['roof_y']+.035,info['z']+dz)),
                              Vector((0,0,-1)),.10)
        assert hit[0] is not None and abs(hit[0].z-info['roof_y'])<1e-4,('mast foot not on roof',dx,dz)
    support['support_validation']=json.dumps({'stations':12,'platform_probes':36,
                        'max_gap_m':error,'central_mast_foot_probes':4})
    print('AA VALID: 12 rooted towers, 36 platform probes, all pedestal bottoms seated; error',round(error,7),'m')
    print('CENTRAL MAST VALID: all four roots seated on the deckhouse roof')
    return records
