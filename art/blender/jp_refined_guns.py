"""Budgeted game-scale Japanese gun geometry. Sim trunnions, spacing and muzzle stay fixed.

Shape and armour are a visual interpretation of the 41st Year Type 14 in twin mount
carried by the Kongō class; no firing characteristics are modified.
"""
import math
from types import SimpleNamespace


def build_jp_gun(kind, api):
    if kind=='jp6c':return build_casemate_gun(api)
    k = SimpleNamespace(**api)
    t = k.TS[kind]
    b, g = k.Buf(), k.Buf()
    g.smooth_faces=[]
    steel = (0.63, 0.68, 0.73)
    plate = (0.55, 0.60, 0.65)
    paint = (0.31, 0.35, 0.39)
    dark = (0.085, 0.10, 0.12)
    h, w, d = t['h'], t['w'], t['len']
    hw, hl = w / 2, d / 2
    # Game-provided pivot and end of bore are deliberately unchanged.
    py, pz = h * 0.5, d * 0.18
    ports = [(i - (t['n'] - 1) / 2) * w * 0.28 for i in range(t['n'])]

    def emit(buf, shape, color=steel, y0=None, span=4):
        buf.emit(*shape, col=color, y0=y0, span=span, lo=0.78)

    def quad(buf, points, color=steel):
        emit(buf, ([k.W(*p) for p in points], [(0, 1, 2), (0, 2, 3)]), color)

    # ---------------------------------------------------------------- base
    bot = k.plan_poly(d, w, 0.28, 0.34, 3)
    # Sides pull in slightly and the front face slopes back, as on the real house.
    top = [(x * 0.90, (z - 1.75) if z > 0 else z * 0.985) for (x, z) in bot]
    verts, faces = k.p_prism(bot, top, 0, h, True, True)
    # Drop the generated front wall; real gun slots are built around the bores.
    emit(b, (verts, faces[2:]), steel, 0, h + 1)
    ring = k.p_cyl(0, -1.5, 0, w * 0.44, w * 0.42, 1.55, seg=20)
    emit(b, ring, plate, -1.5, 2)

    def front_z(y):
        return hl + ((hl - 1.75) - hl) * (y / h)

    def half_w(y):
        # The front panel ends at the chamfer, not at the full side breadth.
        return abs(bot[0][0])+(abs(top[0][0])-abs(bot[0][0]))*y/h

    port_bottom, port_top, port_half = 1.08, 4.18, 0.95
    xs = [-half_w(0), ports[0] - port_half, ports[0] + port_half,
          ports[1] - port_half, ports[1] + port_half, half_w(0)]
    ys = [0.0, port_bottom, port_top, h]
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            if j == 1 and i in (1, 3):
                continue  # the two gun slots
            lo,hi=ys[j],ys[j+1]
            left=lambda y: -half_w(y) if i==0 else xs[i]
            right=lambda y: half_w(y) if i==len(xs)-2 else xs[i+1]
            quad(b, [(left(lo),lo,front_z(lo)),(right(lo),lo,front_z(lo)),
                     (right(hi),hi,front_z(hi)),(left(hi),hi,front_z(hi))])
    # port hoods: a heavy brow over each slot reads at game distance
    for x in ports:
        quad(b, [(x - port_half - 0.18, port_top, front_z(port_top) - 0.05),
                 (x + port_half + 0.18, port_top, front_z(port_top) - 0.05),
                 (x + port_half + 0.18, port_top + 0.42, front_z(port_top) - 0.62),
                 (x - port_half - 0.18, port_top + 0.42, front_z(port_top) - 0.62)], plate)

    # The previous decorative belt bridged both gun slots. Remove that geometry
    # instead of attributing its intersections to rendering shadows.
    chamfer = [(x * 0.94, z * 0.94) for (x, z) in top]
    emit(b, k.p_prism(top, chamfer, h, h + 0.20), steel, h, 2)
    roof_y = h + 0.20
    emit(b, k.p_prism(chamfer, chamfer, roof_y, roof_y + 0.10, True, False), steel, h, 2)
    for x in (-1.5,1.5):
        hatch=[(a+x,z-4.65) for a,z in k.plan_poly(1.15,1.15,.25,.25,2)]
        emit(b,k.p_prism(hatch,hatch,roof_y+.10,roof_y+.22,True,True),plate)
    for x in (-3.0, 3.0):
        emit(b, k.p_cyl(x, roof_y + 0.10, -4.35, 0.22, 0.20, 0.24, seg=8), dark, h, 2)
    for x in ports:
        emit(b, k.p_cyl(x, roof_y + 0.10, hl * 0.30, 0.30, 0.30, 0.14, seg=8), plate, h, 2)
    # Armoured optical hood across the REAR roof. The old pipe with circular
    # end caps looked like a second pair of gun barrels perched on trestles.
    # Shared game-scale interpretation: not a claim that all four houses carried
    # identical instruments or that this oversized game gunhouse is a scale plan.
    optic_z=-2.55
    optic_y=h-.20
    profile=[(-.56,0),(.56,0),(.68,.18),(.58,.68),(.35,.86),(-.35,.86),(-.58,.68),(-.68,.18)]
    # The baseline is inside the armoured roof. Only the side hoods should
    # project prominently; do not replace the old pipe with another roof rack.
    vertices=[k.W(x,optic_y+y*.45,optic_z+z) for x in (-4.75,4.75) for z,y in profile]
    faces=[]
    for i in range(8):
        j=(i+1)%8;faces.extend(((i,j,8+j),(i,8+j,8+i)))
    faces.extend((tuple(reversed(range(8))),tuple(range(8,16))))
    emit(b,(vertices,faces),steel)
    for side in (-1,1):
        # Broad armoured side ears overlap the casing and roof shoulder, with
        # forward-facing optical windows rather than round plugs on the X ends.
        cx=side*5.10
        lower=[(cx+x,optic_z+z) for x,z in k.plan_poly(1.70,2.15,.45,.35,2)]
        upper=[(cx+x*.92,optic_z+z*.84) for x,z in k.plan_poly(1.70,2.15,.45,.35,2)]
        emit(b,k.p_prism(lower,upper,h-.25,optic_y+.90,True,True),plate)
        lens_x=side*5.50
        emit(b,k.p_box(lens_x,optic_y+.17,optic_z+.88,.38,.38,.035),dark)
        emit(b,k.p_cyl_z(lens_x,optic_y+.36,optic_z+.93,.14,.045,12),(.12,.18,.20))
        emit(b,k.p_box(cx,optic_y+.91,optic_z,.72,.07,.95),steel)
    b.optics_style='internal optical baseline, integral rear shoulder hoods, forward optical windows'

    # ---------------------------------------------------------------- moving group
    for x in ports:
        outer = [(0.32, -1.05), (0.72, -1.05), (0.74, 0.30), (0.67, 3.4),
                 (0.60, 8.2), (0.58, 12.2), (0.585, t['bl']), (0.57, t['bl'])]
        assert all(a[1] <= c[1] for a, c in zip(outer, outer[1:])), kind
        profile = outer + [(0.33, t['bl']), (0.33, t['bl'] - 0.30)]
        start=len(g.f)
        emit(g, k.p_lathe_z(x, py, pz, profile, 12), paint)
        g.smooth_faces.extend(range(start,len(g.f)))
        emit(g, k.p_cyl_z(x, py, pz + t['bl'] - 0.29, 0.32, 0.02, 12), dark)
        emit(g, k.p_box(x, py - 0.34, pz - 0.85, 0.86, 0.78, 1.1), dark)
        emit(g, k.p_cyl_z(x, py - 0.55, pz + 0.9, 0.34, 2.6, 10), plate)
        emit(g, k.p_cyl_z(x, py + 0.62, pz + 1.1, 0.26, 2.4, 10), plate)
        # curved sliding shield turning about the real trunnion, slotted for the bore
        radius, half, hole, cut = 2.70, port_half - 0.05, 0.80, 17
        angles = (-48,-32,-20,-12,0,12)
        for aa, bb in zip(angles, angles[1:]):
            mid = (aa + bb) / 2
            strips = ((-half, -hole), (hole, half)) if abs(mid) < cut else ((-half, half),)
            a, c = math.radians(aa), math.radians(bb)
            for lo, hi in strips:
                quad(g, [(x + lo, py + radius * math.sin(a), pz + radius * math.cos(a)),
                         (x + hi, py + radius * math.sin(a), pz + radius * math.cos(a)),
                         (x + hi, py + radius * math.sin(c), pz + radius * math.cos(c)),
                         (x + lo, py + radius * math.sin(c), pz + radius * math.cos(c))], (0.42, 0.46, 0.50))
    b.budget_label = '14in twin house'
    g.budget_label = '14in moving tubes'
    return b, g, (0, py, pz)


def build_casemate_gun(api):
    """Low curved port shield and internal carriage, not a small deck turret."""
    k=SimpleNamespace(**api);t=k.TS['jp6c']
    b,g=k.Buf(),k.Buf();g.smooth_faces=[]
    steel=(.55,.60,.64);dark=(.10,.14,.17)
    py,pz=t['h']/2,t['len']*.18
    def emit(buf,shape,col=steel):buf.emit(*shape,col=col)
    # The carriage and short bearing are behind the opening, below the bore.
    emit(b,k.p_cyl(0,-.15,-.65,.55,.49,.55,12))
    emit(b,k.p_box(0,.25,-.60,.70,.55,.95),(.35,.40,.44))
    # Curved armoured mantlet, with an actual vertical gun slot.
    angles=(-65,-40,-18,18,40,65)
    rows=(.08,.40,1.22,1.52)
    for i,(a,c) in enumerate(zip(angles,angles[1:])):
        for j,(lo,hi) in enumerate(zip(rows,rows[1:])):
            if i==2 and j==1:continue
            a0,c0=math.radians(a),math.radians(c)
            pts=[(1.1*math.sin(v),y,-.80+1.1*math.cos(v)) for v,y in ((a0,lo),(c0,lo),(c0,hi),(a0,hi))]
            emit(b,([k.W(*v) for v in pts],[(0,1,2),(0,2,3)]))
    for side in (-1,1):
        emit(b,k.p_box(side*.98,.10,-.55,.10,1.4,.55))
    profile=[(.24,-.65),(.26,.2),(.22,1.2),(.18,3.0),(.16,t['bl']),(.076,t['bl']),(.076,t['bl']-.25)]
    start=len(g.f);emit(g,k.p_lathe_z(0,py,pz,profile,10),(.28,.33,.37))
    g.smooth_faces.extend(range(start,len(g.f)))
    emit(g,k.p_cyl_z(0,py,pz+t['bl']-.245,.075,.015,10),dark)
    emit(g,k.p_cyl_z(0,py,pz-.35,.29,.9,10),(.40,.45,.49))
    emit(g,k.p_box(0,py-.3,pz-.8,.52,.6,.65),dark)
    return b,g,(0,py,pz)


def validate_jp14d_scene(api):
    """Check actual generated geometry, including the former blocked slots."""
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    parts=list(bpy.data.collections['gun_jp14d'].objects)
    base=next(o for o in parts if o.get('export_role')=='base')
    barrel=next(o for o in parts if o.get('export_role')=='barrel')
    t=api['TS']['jp14d']
    assert (barrel.location-Vector(api['W'](0,t['h']/2,t['len']*.18))).length<1e-5
    assert base.parent is None and barrel.parent is None
    assert all(math.isfinite(x) for o in parts for v in o.data.vertices for x in v.co)
    triangles=sum(len(p.vertices)-2 for o in parts for p in o.data.polygons)
    assert triangles<=2500,triangles
    tree=BVHTree.FromPolygons([v.co.copy() for v in base.data.vertices],
                             [list(p.vertices) for p in base.data.polygons])
    # Forward rays through both slots must not hit a solid waist strip or a
    # duplicated front panel. The moving tubes are intentionally not in this BVH.
    for side in (-1,1):
        x=side*t['w']*.14
        for y in (1.65,2.20,3.20):
            hit=tree.ray_cast(Vector(api['W'](x,y,7)),Vector((0,1,0)),2.6)
            assert hit[0] is None,('blocked gun slot',side,y,hit)
    # Optical windows must be visible from ahead, not buried inside the ears.
    for side in (-1,1):
        hit=tree.ray_cast(Vector(api['W'](side*5.50,t['h']+.16,0)),Vector((0,1,0)),3)
        assert hit[0] is not None and 1.3<hit[3]<2.0,('occluded lens',side,hit)
    muzzle_z=max(-v.co.y+t['len']*.18 for v in barrel.data.vertices)
    assert abs(muzzle_z-(t['len']*.18+t['bl']))<1e-4
    print('JP14D: pivot and muzzle unchanged; six slot rays clear; both lenses exposed;',triangles,'tri')
    return triangles
