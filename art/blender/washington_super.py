"""BB-56 visual layout, based on the 18/21 August 1942 photographs.

Metre dimensions below are game-scale interpretations, NOT measurements from a shipyard plan.
All points use hull coordinates (x, up, bow). Simulation tables remain untouched.
"""
import math
from types import SimpleNamespace


def build_washington(buf, spec, api):
    k = SimpleNamespace(**api)
    steel = (0.63, 0.68, 0.73)
    dark = (0.12, 0.15, 0.18)
    deckpaint = (0.34, 0.39, 0.44)
    railpaint = (0.31, 0.36, 0.40)
    audit = {}

    def emit(shape, color=steel, y0=None, span=5, lo=0.78):
        buf.emit(*shape, col=color, y0=y0, span=span, lo=lo)

    def open_rod(a,b,r,seg=6):
        # warship_build.p_rod emits 2*seg side triangles, then both end fans.
        # Connected fine rods need neither fan nor the two unused centre vertices.
        verts,faces=k.p_rod(a,b,r,seg)
        return verts[:2*seg],faces[:2*seg]

    def outline(x, z, length, width, rf=0.5, rr=0.25):
        return [(a+x, b+z) for a,b in k.plan_poly(length,width,rf,rr,5)]

    def ellipse(x,z,width,length,n=32):
        return [(x+width/2*math.cos(-i*math.tau/n),
                 z+length/2*math.sin(-i*math.tau/n)) for i in range(n)]

    def record(name, start):
        verts = buf.v[start:]
        audit[name] = {'vertices':len(verts),
                       'x':[min(v[0] for v in verts),max(v[0] for v in verts)],
                       'height':[min(v[2] for v in verts),max(v[2] for v in verts)],
                       'bow':[min(-v[1] for v in verts),max(-v[1] for v in verts)]}

    def body(plan, y0, y1, shrink=0.15, color=steel):
        cx=sum(x for x,z in plan)/len(plan)
        cz=sum(z for x,z in plan)/len(plan)
        top=[]
        for x,z in plan:
            d=max(math.hypot(x-cx,z-cz),0.01)
            top.append((x-(x-cx)*shrink/d,z-(z-cz)*shrink/d))
        emit(k.p_prism(plan,top,y0,y1,True,True),color,y0,y1-y0)
        return top

    def edgewalls(plan,y,height=0.75,thickness=0.10,color=steel):
        # Real perimeter walls, not a solid lid across the entire open platform.
        for a,b in zip(plan,plan[1:]+plan[:1]):
            dx,dz=b[0]-a[0],b[1]-a[1]
            length=math.hypot(dx,dz)
            if length<0.03: continue
            emit(k.p_box_y((a[0]+b[0])/2,y,(a[1]+b[1])/2,
                           thickness,height,length,math.atan2(dx,dz)),color)

    def rails(plan,y,height=0.95):
        edges=[]
        perimeter=0.0
        for a,b in zip(plan,plan[1:]+plan[:1]):
            length=math.dist(a,b)
            if length<1e-6: continue
            edges.append((a,b,length))
            perimeter+=length
            for up in (height,0.48*height):
                emit(open_rod((a[0],y+up,a[1]),(b[0],y+up,b[1]),0.035,3),railpaint)
        if not edges: return
        # Carry distance across corners; arc tessellation must not dictate post density.
        # A closed loop has n equal gaps, including the last-to-first gap.
        n=max(1,math.ceil(perimeter/1.9))
        edge_index=0
        edge_start=0.0
        for j in range(n):
            distance=j*perimeter/n
            while edge_index<len(edges)-1 and distance>=edge_start+edges[edge_index][2]:
                edge_start+=edges[edge_index][2]
                edge_index+=1
            a,b,length=edges[edge_index]
            t=(distance-edge_start)/length
            x,z=a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t
            emit(open_rod((x,y,z),(x,y+height,z),0.037,3),railpaint)

    def gallery(plan,y,wall=False,braces=False):
        emit(k.p_prism(plan,plan,y-0.19,y,True,True),steel)
        inner=k.outset(plan,-0.22)
        emit(k.p_prism(inner,inner,y+0.01,y+0.035,True,False),deckpaint)
        if wall: edgewalls(plan,y,0.78)
        else: rails(inner,y)
        if braces:
            for x,z in plan[::max(1,len(plan)//8)]:
                emit(open_rod((x*0.55,y-1.7,29.5+(z-29.5)*0.55),
                             (x,y-0.22,z),0.085,5),steel)

    def openings(plan,y,rect=False,front_only=False):
        # Sample the actual surface, not an offset black ring floating over tapered walls.
        for a,b in zip(plan,plan[1:]+plan[:1]):
            dx,dz=b[0]-a[0],b[1]-a[1]
            length=math.hypot(dx,dz)
            if length<0.12: continue
            nx,nz=-dz/length,dx/length  # plan is clockwise in hull x/z
            if front_only and nz<-.15: continue
            n=max(1,int(length/(1.12 if rect else 1.5)))
            for j in range(n):
                t=(j+0.5)/n
                x,z=a[0]+dx*t,b[1]-dz*(1-t)
                if rect:
                    emit(k.p_box_y(x+nx*.05,y,z+nz*.05,.62,.42,.065,
                                   math.atan2(nx,nz)),dark)
                else:
                    # Planar eight-sided opening + rim: no hidden cylinder caps/draw cost.
                    verts=[]
                    for r in (.235,.175):
                        for q in range(8):
                            angle=q*math.tau/8
                            verts.append(k.W(x+nx*.09+dx/length*r*math.cos(angle),
                                             y+r*math.sin(angle),
                                             z+nz*.09+dz/length*r*math.cos(angle)))
                    faces=[]
                    for q in range(8):
                        j=(q+1)%8
                        faces.extend(((q,j,8+j),(q,8+j,8+q)))
                    emit((verts,faces),steel)
                    center=k.W(x+nx*.095,y,z+nz*.095)
                    emit(([center]+verts[8:],[(0,1+q,1+(q+1)%8) for q in range(8)]),dark)

    def radar(cx,cy,cz,width,height,yaw=0,lean=.0,cols=6,rows=4,curved=False):
        def point(u,v):
            depth=v*lean+(u*u/width*.17 if curved else 0)
            return (cx+u*math.cos(yaw)+depth*math.sin(yaw),cy+v,
                    cz-u*math.sin(yaw)+depth*math.cos(yaw))
        for j in range(cols+1):
            u=width*(j/cols-.5)
            emit(open_rod(point(u,0),point(u,height),.035 if j not in (0,cols) else .065,4),railpaint)
        for j in range(rows+1):
            v=height*j/rows
            sections=cols if curved else 1
            for s in range(sections):
                emit(open_rod(point(width*(s/sections-.5),v),point(width*((s+1)/sections-.5),v),
                             .035 if j not in (0,rows) else .065,3),railpaint)
        emit(open_rod(point(-width/2,0),point(width/2,height),.045,4),railpaint)
        emit(open_rod(point(width/2,0),point(-width/2,height),.045,4),railpaint)

    # Keep the gun installation deck, but no repeated gallery eaves or rails across gun arcs.
    start=len(buf.v)
    draft=api.get('BATTERY_PREVIEW_DATA')
    mainplan=outline(0,3,64,draft['coreDeckhouseWidth'] if draft else 24.8,.25,.25)
    body(mainplan,7.9,14.25,.25)
    emit(k.p_prism(mainplan,mainplan,14.25,14.31,True,False),deckpaint)
    # Omit the blanket rail above gun ports: narrow passage rails only at deckhouse ends.
    # (Gallery rail geometry below the barrel line is not added along the battery.)
    record('deckhouse',start)

    start=len(buf.v)
    lower=outline(0,32.0,18.2,14.0,.72,.2)
    lowertop=body(lower,14.22,18.05,.10)
    openings(k.outset(lowertop,.02),16.65)
    # Three oval float baskets along each side of the lower bridge (visible in the aerial).
    for side in (-1,1):
        for zc in (26.2,29.2,32.2):
            pts=[(side*7.12,16.05+.60*math.sin(i*math.tau/12),
                  zc+1.13*math.cos(i*math.tau/12)) for i in range(12)]
            for a,b in zip(pts,pts[1:]+pts[:1]):
                emit(open_rod(a,b,.10,4),(.57,.61,.62))
            for dz in (-.55,0,.55):
                emit(open_rod((side*7.13,15.65,zc+dz),(side*7.13,16.45,zc+dz),.027,3),railpaint)
    gallery(k.outset(lowertop,.42),18.13,wall=False)
    # Forward armoured conning structure is embedded in the bridge, not a separate tall pole.
    conning=ellipse(0,37.6,6.1,6.4)
    body(conning,13.1,21.1,.05,color=(.59,.64,.69))
    navigation=outline(0,35.2,11.8,10.4,.85,.3)
    navtop=body(navigation,18.12,20.85,.08)
    openings(k.outset(navtop,.02),19.65,rect=True,front_only=True)
    gallery(k.outset(navtop,.38),20.94,wall=True)
    # Forward local director, visible above the rounded bridge front in the August aerial.
    emit(k.p_cyl(0,21.1,37.5,1.62,1.48,1.45,20),steel)
    emit(k.p_box(0,22.10,37.5,4.6,.55,.65),steel)
    for side in (-1,1):
        emit(k.p_box(side*2.32,22.18,37.5,.08,.28,.40),dark)
    # Bridge wings grow from this actual deck, with braces ending in the lower house.
    for side in (-1,1):
        wing=outline(side*6.1,32.6,4.2,3.4,.4,.4)
        gallery(wing,20.94,wall=False)
        for z in (31.1,34.0):
            emit(open_rod((side*4.7,18.2,z),(side*7.4,20.7,z),.12,6))
    record('lower_bridge',start)

    # The decisive change: one continuous rounded, tapered tower aft of the bridge front.
    start=len(buf.v)
    fairing0=ellipse(0,29.5,8.5,9.1)
    fairing1=ellipse(0,29.5,6.7,7.25)
    emit(k.p_prism(fairing0,fairing1,18.05,22.0,True,True),steel,18.05,4,.87)
    tower0=ellipse(0,29.5,7.0,7.6)
    towermid=ellipse(0,29.4,5.85,6.4)
    tower1=ellipse(0,29.25,4.8,5.45)
    emit(k.p_prism(tower0,towermid,18.05,25.0,False,True),steel,18.05,16.25,0.85)
    emit(k.p_prism(towermid,tower1,25.0,34.3,True,False),steel,18.05,16.25,0.85)
    # Recesses, service trunk and ladder are kept subordinate to the continuous shaft.
    for yy,ww,ll in ((23.3,6.10,6.68),(28.5,5.46,6.0)):
        # A few service openings, not an invented full necklace of portholes.
        for angle in (math.radians(32),math.radians(75),math.radians(145)):
            px=ww/2*math.cos(angle);pz=29.4+ll/2*math.sin(angle)
            nx,nz=math.cos(angle),math.sin(angle)
            emit(k.p_rod((px,yy,pz),(px+nx*.09,yy,pz+nz*.09),.16,8),dark)
    # Short projecting optical hoods are visible on the tower face in the 18 August close-up.
    # Placement is a simplified interpretation, not a reconstruction of their internal optics.
    for yy in (25.6,28.0,30.1):
        depth=6.4-(yy-25.0)/9.3*(6.4-5.45)
        for side in (-1,1):
            px=side*1.10
            surface=29.35+depth/2*.91
            emit(k.p_rod((px,yy,surface-.12),(px,yy+.10,surface+.48),.18,8),steel)
            emit(k.p_rod((px,yy+.10,surface+.49),(px,yy+.11,surface+.53),.115,8),dark)
    for side in (-1,1):
        emit(open_rod((side*2.8,19.5,28.2),(side*2.14,33.4,28.1),.11,6))
        for z in (28.55,29.1):
            emit(open_rod((side*3.06,20.8,z),(side*2.48,31.8,z),.045,4),railpaint)
        for j in range(22):
            yy=21+j*.47
            xx=side*(3.06-(yy-20.8)/11*.58)
            emit(open_rod((xx,yy,28.55),(xx,yy,29.1),.032,4),railpaint)
    # Small lookout galleries, not four identical full-width storeys.
    for side in (-1,1):
        gallery(outline(side*3.4,28.9,2.7,2.4,.6,.5),27.0,wall=False)
        emit(open_rod((side*2.4,25.3,28.9),(side*4.15,26.8,28.9),.10,5))
    record('continuous_tower',start)

    start=len(buf.v)
    lookout=outline(0,29.35,7.8,10.3,.20,.12)
    gallery(lookout,34.25,wall=True,braces=True)
    # Narrow double edge visible under the prominent upper gallery.
    emit(k.p_prism(k.outset(lookout,.12),lookout,33.72,33.93,False,False),steel)
    # Lateral signal yards with triangular stays.
    emit(k.p_rod((-7.1,31.8,29.0),(7.1,31.8,29.0),.085,6),steel)
    for side in (-1,1):
        emit(open_rod((0,33.1,29),(side*7.1,31.8,29),.045,4),railpaint)
        emit(open_rod((side*7.1,31.8,29),(side*6.2,31.8,27.7),.045,4),railpaint)
    # Round director with long transverse optical rangefinder arms.
    body(ellipse(0,29.5,4.65,4.9),34.25,37.05,.12)
    emit(k.p_cyl(0,37.05,29.5,2.35,2.25,.3,24),steel)
    emit(k.p_box(0,36.15,29.55,11.7,1.0,1.3),steel)
    for side in (-1,1):
        emit(k.p_box(side*5.89,36.35,29.55,.14,.48,.80),dark)
    # Fire-control antenna and tall search array, separately articulated in silhouette.
    for side in (-1,1):
        emit(open_rod((side*1.10,37.24,30.0),(side*1.10,37.68,30.0),.065,5),steel)
    radar(0,37.65,30.0,3.7,1.9,0,-.20,10,5,curved=True)
    emit(open_rod((0,36.8,27.5),(0,40.0,27.5),.13,8),steel)
    radar(0,39.1,27.5,4.4,4.8,math.radians(35),.10,7,7)
    # SG: small front-of-tower mount underneath the upper gallery, not the tall top array.
    emit(open_rod((0,31.1,32.3),(0,32.8,33.0),.10,6),steel)
    emit(k.p_cyl(0,32.2,33.0,.28,.25,.5,10),steel)
    radar(0,32.65,33.0,1.15,.52,0,0,4,2)
    record('upper_platform_and_director',start)

    # Aft low director house is not another stepped front bridge.
    aft=outline(0,-22,10,11.5,.2,.45)
    afttop=body(aft,13.95,17.0,.15)
    openings(k.outset(afttop,.02),15.9)
    gallery(k.outset(afttop,.3),17.12)

    # Retain existing non-bridge equipment and all game gun mounts. Replace only island forms.
    for p in spec['parts']:
        if p['k']=='b': continue
        if p['k']=='m' and p['z']>20: continue
        if p['k']=='pl' and p['z']>20: continue
        if p['k']=='dr' and p['z']>20: continue
        if p['k']=='c':
            # Thinner flared lip, open-looking dark throat, no thick mid-height black belt.
            x,z=p['x'],p['z']; base=k.deck_y(spec,z)+p['y']
            r,h=p['r'],p['h']; rake=p.get('rake',0)
            shift=-math.tan(rake)*h
            emit(k.p_cyl(x,base,z,r,r*.91,h,24,False,1.0,rake,True),steel,base,h,.84)
            emit(k.p_cyl(x,base+h-.38,z+shift,r*.92,r*1.02,.38,24),(.24,.27,.30))
            emit(k.p_cyl(x,base+h+.005,z+shift,r*.86,r*.86,.025,24),dark)
            for side in (-1,1):
                emit(open_rod((x+side*r*.83,base,z-.35),
                             (x+side*r*.78,base+h*.92,z+shift-.35),.10,6),steel)
            continue
        # Light mounts retain the game's proxy layout; exact 1942 AA fitting is not claimed.
        k.build_part(buf,spec,p)
    k.add_extras(buf,spec)
    # Targeted seam validation: shaft stays at z~29.5, never returns to hull origin.
    assert audit['continuous_tower']['bow'][0]>24
    assert audit['continuous_tower']['bow'][1]<35
    return audit
