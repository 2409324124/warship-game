"""Budgeted game-scale gun geometry. Preserve sim trunnions, gun spacing and muzzle positions.

Shape/armour/bore are visual interpretations; no firing characteristics are modified.
"""
import math
from types import SimpleNamespace


def build_us_gun(kind, api):
    k = SimpleNamespace(**api)
    t = k.TS[kind]
    b,g = k.Buf(),k.Buf()
    steel=(.63,.68,.73); barrelpaint=(.31,.35,.39); dark=(.085,.10,.12)
    h,w,d=t['h'],t['w'],t['len']
    main=kind=='us16t'
    # Game-provided pivot and end of bore are deliberately unchanged.
    py,pz=h*.5,d*.18
    positions=[(i-(t['n']-1)/2)*w*.28 for i in range(t['n'])]

    def emit(buf, shape, color=steel, y0=None, span=4):
        buf.emit(*shape,col=color,y0=y0,span=span,lo=.78)

    def quad(buf, points, color=steel):
        emit(buf,([k.W(*p) for p in points],[(0,1,2),(0,2,3)]),color)

    # A chamfered armour house with a real sloping front, not an upright scaled cube.
    if main:
        bot=[(-5.4,8),(5.4,8),(6.5,6.8),(6.5,-6.5),(5.4,-8),(-5.4,-8),(-6.5,-6.5),(-6.5,6.8)]
        top=[(-4.8,5.6),(4.8,5.6),(5.8,4.8),(5.8,-6.1),(4.8,-7.4),(-4.8,-7.4),(-5.8,-6.1),(-5.8,4.8)]
        port_bottom,port_top,port_half=1.40,4.70,.92
    else:
        bot=[(-1.47,2.3),(1.47,2.3),(1.9,1.78),(1.9,-1.78),(1.5,-2.3),(-1.5,-2.3),(-1.9,-1.78),(-1.9,1.78)]
        top=[(-1.32,1.62),(1.32,1.62),(1.70,1.18),(1.70,-1.68),(1.32,-2.12),(-1.32,-2.12),(-1.70,-1.68),(-1.70,1.18)]
        port_bottom,port_top,port_half=.53,2.08,.33
    verts,faces=k.p_prism(bot,top,0,h,True,True)
    # Remove the first wall; construct its remaining panels around actual gun slots below.
    emit(b,(verts,faces[2:]),steel,0,h+1)
    def front(x,y):
        z=bot[0][1]+(top[0][1]-bot[0][1])*y/h
        return (x,y,z)
    def half_width(y):
        return -bot[0][0]+(bot[0][0]-top[0][0])*y/h
    def panel(x0,x1,y0,y1):
        quad(b,[front(x0,y0),front(x1,y0),front(x1,y1),front(x0,y1)])
    for y0,y1 in ((0,port_bottom),(port_top,h)):
        quad(b,[front(-half_width(y0),y0),front(half_width(y0),y0),
                front(half_width(y1),y1),front(-half_width(y1),y1)])
    prev=None
    for x in positions:
        if prev is None:
            quad(b,[front(-half_width(port_bottom),port_bottom),front(x-port_half,port_bottom),
                    front(x-port_half,port_top),front(-half_width(port_top),port_top)])
        else:
            panel(prev,x-port_half,port_bottom,port_top)
        prev=x+port_half
        # Dark recessed four-wall reveal, not a flat dark sticker over an uncut wall.
        corners=[front(x-port_half,port_bottom),front(x+port_half,port_bottom),
                 front(x+port_half,port_top),front(x-port_half,port_top)]
        for a,c in zip(corners,corners[1:]+corners[:1]):
            quad(b,[a,c,(c[0],c[1],c[2]-.24),(a[0],a[1],a[2]-.24)],dark)
    quad(b,[front(prev,port_bottom),front(half_width(port_bottom),port_bottom),
            front(half_width(port_top),port_top),front(prev,port_top)])

    emit(b,k.p_cyl(0,-1.3,0,w*.44,w*.42,1.3,20 if main else 16),steel,-1.3,3)
    # Small roof edge bevel rather than a large overhanging slab.
    cx=sum(x for x,z in top)/len(top);cz=sum(z for x,z in top)/len(top)
    inset=[(cx+(x-cx)*.988,cz+(z-cz)*.988) for x,z in top]
    emit(b,k.p_prism(top,inset,h,h+(.12 if main else .07),True,False),(.69,.73,.76))

    if main:
        for side in (-1,1):
            plan=[(x+side*6.25,z-3.25) for x,z in k.plan_poly(2.0,1.1,.35,.2,2)]
            emit(b,k.p_prism(plan,plan,3.55,4.35,True,True),steel)
            emit(b,k.p_box(side*6.81,3.76,-3.25,.06,.32,1.15),dark)
        for x in (-3.1,0,3.1):
            emit(b,k.p_cyl(x,h+.12,-1.45,.43,.43,.12,8),(.54,.59,.63))
        emit(b,k.p_box(2.6,h+.12,-5.5,1.0,.38,1.2),steel)
        emit(b,k.p_box(2.6,h+.23,-4.88,.60,.13,.035),dark)
        for side in (-1,1):
            emit(b,k.p_box(side*3.7,h+.12,-4.7,.70,.16,.7),(.46,.50,.54))
        # Short rear access ladder; three-sided rods suffice for screen-scale detail.
        for x in (-2.65,-2.12):
            emit(b,k.p_rod((x,1.1,-8.02),(x,4.7,-7.60),.045,3),barrelpaint)
        for i in range(8):
            yy=1.35+i*.44;zz=-8.02+(yy-1.1)/3.6*.42
            emit(b,k.p_rod((-2.65,yy,zz),(-2.12,yy,zz),.033,3),barrelpaint)
    else:
        emit(b,k.p_box(.75,h+.07,-.35,.72,.30,.95),steel)
        emit(b,k.p_box(.75,h+.15,.14,.42,.10,.04),dark)
        emit(b,k.p_cyl(-.72,h+.07,-1.1,.22,.22,.12,6),barrelpaint)

    for x in positions:
        if main:
            seg=16
            outer=[(.72,-.70),(.80,3.25),(.70,4.45),(.61,5.25),(.48,9.0),(.35,16.5),(.32,t['bl'])]
            bore=.203
        else:
            seg=8
            outer=[(.22,-.18),(.24,1.00),(.17,2.0),(.12,4.4),(.105,t['bl'])]
            bore=.0635
        assert all(a[1]<=c[1] for a,c in zip(outer,outer[1:])),kind
        # Reverse-distance inner profile is intentional: a visible bore, not a capped muzzle.
        profile=outer+[(bore,t['bl']),(bore,t['bl']-(.65 if main else .22))]
        emit(g,k.p_lathe_z(x,py,pz,profile,seg),barrelpaint)
        emit(g,k.p_cyl_z(x,py,pz+t['bl']-(.64 if main else .21),bore*.995,.015,8),dark)
        emit(g,k.p_box(x,py-(.64 if main else .21),pz-(.48 if main else .18),
                        1.15 if main else .38,1.28 if main else .42,1.4 if main else .45),dark)
        # Curved sliding shield behind the armour slot, with clearance around the bore.
        # It turns about the actual trunnion. No giant flat panel can poke through the roof.
        radius=2.8 if main else .9
        half=.87 if main else .30
        hole=.78 if main else .235
        angles=(-24,-18,0,18,28,38) if main else (-32,-16,0,16,32,48)
        cut=18 if main else 16
        for aa,bb in zip(angles,angles[1:]):
            mid=(aa+bb)/2
            strips=((-half,-hole),(hole,half)) if abs(mid)<cut else ((-half,half),)
            a,c=math.radians(aa),math.radians(bb)
            for lo,hi in strips:
                quad(g,[(x+lo,py+radius*math.sin(a),pz+radius*math.cos(a)),
                        (x+hi,py+radius*math.sin(a),pz+radius*math.cos(a)),
                        (x+hi,py+radius*math.sin(c),pz+radius*math.cos(c)),
                        (x+lo,py+radius*math.sin(c),pz+radius*math.cos(c))],(.40,.44,.48))
    b.budget_label='16in house' if main else '5in twin house'
    g.budget_label='16in moving tubes' if main else '5in moving tubes'
    return b,g,(0,py,pz)
