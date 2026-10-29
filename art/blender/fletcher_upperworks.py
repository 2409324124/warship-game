"""Fletcher-only Mk30-inspired guns and early round-bridge visual interpretation.

Does not replace shared gun collections or export any game resources.
Coordinates at every helper boundary are hull (x, up, fore).
"""
import math

STEEL = (.52, .58, .63)
EDGE = (.40, .46, .51)
LIGHT = (.62, .67, .70)
DARK = (.08, .12, .15)
DECK = (.23, .28, .30)


def build_single_gun(api):
    """Return static/moving buffers with the existing us5s trunnion and muzzle."""
    t = api['TS']['us5s']
    base, moving = api['Buf'](), api['Buf']()
    py, pz = t['h'] * .5, t['len'] * .18

    def emit(buf, shape, col=STEEL):
        buf.emit(*shape, col=col)

    def quad(buf, points, col=STEEL):
        emit(buf, ([api['W'](*p) for p in points], [(0, 1, 2), (0, 2, 3)]), col)

    # Eight-sided house, sloping front and bevelled roof. First edge is the face.
    lo = [(-1.13, 1.92), (1.13, 1.92), (1.65, 1.35), (1.65, -1.5),
          (1.15, -2.05), (-1.15, -2.05), (-1.65, -1.5), (-1.65, 1.35)]
    hi = [(-1.02, 1.24), (1.02, 1.24), (1.46, .83), (1.46, -1.45),
          (1.08, -1.88), (-1.08, -1.88), (-1.46, -1.45), (-1.46, .83)]
    height = 2.48
    v, f = api['p_prism'](lo, hi, 0, height, True, True)
    emit(base, (v, f[2:]))  # actual open gun slot, not a dark decal
    def face(x, y):
        return (x, y, 1.92 + (1.24 - 1.92) * y / height)
    def width(y):
        return 1.13 + (1.02 - 1.13) * y / height
    for a, b in ((0, .50), (2.25, height)):
        quad(base, [face(-width(a), a), face(width(a), a), face(width(b), b), face(-width(b), b)])
    for side in (-1, 1):
        quad(base, [face(side * .39, .50), face(side * width(.50), .50),
                    face(side * width(2.25), 2.25), face(side * .39, 2.25)])
    corners = [face(-.39, .50), face(.39, .50), face(.39, 2.25), face(-.39, 2.25)]
    for a, b in zip(corners, corners[1:] + corners[:1]):
        quad(base, [a, b, (b[0], b[1], b[2] - .20), (a[0], a[1], a[2] - .20)], DARK)
    roof = [(x * .91, z * .94) for x, z in hi]
    emit(base, api['p_prism'](hi, roof, height, 2.69, True, False), LIGHT)
    emit(base, api['p_cyl'](0, -.20, 0, 1.39, 1.35, .30, 20), EDGE)
    # Rear access door, hinges and roof sight hood, not oversized cupolas.
    emit(base, api['p_box'](.0, .22, -2.075, .85, 1.6, .07), EDGE)
    emit(base, api['p_box'](.0, .32, -2.12, .70, 1.36, .025), STEEL)
    for y in (.55, 1.5):
        emit(base, api['p_box'](-.43, y, -2.14, .13, .10, .07), LIGHT)
    emit(base, api['p_box'](.20, 1.04, -2.17, .18, .05, .06), DARK)
    emit(base, api['p_box'](.65, 2.67, -.45, .56, .24, .80), STEEL)
    emit(base, api['p_box'](.65, 2.76, -.035, .36, .08, .025), DARK)
    for side in (-1, 1):
        emit(base, api['p_box'](side * 1.655, .6, -.6, .035, .40, .70), EDGE)
        for j in range(3):
            emit(base, api['p_box'](side * 1.68, .66 + j * .10, -.6, .03, .035, .55), DARK)
    # True hollow muzzle, bore diameter 127 mm, recessed bore end.
    profile = [(.24, -.25), (.25, .55), (.20, 1.35), (.15, 2.3),
               (.095, 5.0), (.088, t['bl']), (.0635, t['bl']), (.0635, t['bl'] - .38)]
    emit(moving, api['p_lathe_z'](0, py, pz, profile, 12), (.25, .30, .34))
    emit(moving, api['p_cyl_z'](0, py, pz + t['bl'] - .39, .0634, .01, 12), (.012, .018, .025))
    emit(moving, api['p_lathe_z'](0, py, pz,
                                [(.264, .42), (.27, .66), (.264, .78), (.245, .78)], 12), EDGE)
    # Curved cradle moves about the trunnion; leave a real opening for the barrel.
    for aa, bb in zip((-60, -40, -20, 0, 20, 40), (-40, -20, 0, 20, 40, 60)):
        a, b = math.radians(aa), math.radians(bb)
        strips = ((-.36, -.30), (.30, .36)) if abs((aa + bb) / 2) < 42 else ((-.36, .36),)
        for x0, x1 in strips:
            quad(moving, [(x0, py + .70 * math.sin(a), pz + .70 * math.cos(a)),
                          (x1, py + .70 * math.sin(a), pz + .70 * math.cos(a)),
                          (x1, py + .70 * math.sin(b), pz + .70 * math.cos(b)),
                          (x0, py + .70 * math.sin(b), pz + .70 * math.cos(b))], STEEL)
    return base, moving, (0, py, pz)


def build_bridge(api, buf, Kit, deck, anchors):
    z = anchors['BRIDGE']
    # The entire group is local, including windows, rails and director.
    k = Kit(api, buf, (0, deck(z), z))
    def prism(plan, bottom, top, col=STEEL, shrink=.0):
        k.emit(api['p_prism'](plan, [(x * (1 - shrink), zz * (1 - shrink)) for x, zz in plan],
                               bottom, top, True, True), col)
    def plan(length, width, dz=0):
        return [(x, zz + dz) for x, zz in api['plan_poly'](length, width, .70, .45, 5)]
    lower = plan(13.0, 7.4)
    prism(lower, -.32, 2.40)
    # Mostly solid lower house: portholes, watertight doors, not three window ribbons.
    for side in (-1, 1):
        for zz in (-3.4, -.8, 1.8, 4.3):
            k.emit(api['p_cyl_x'](side * 3.72, 1.30, zz, .15, .055, 10), DARK)
        k.box(side * 3.73, .15, -2.15, .055, 1.8, .85, EDGE)
        k.box(side * 3.77, .26, -2.15, .025, 1.56, .69, STEEL)
        k.box(side * 3.80, 1.12, -1.98, .04, .06, .17, DARK)
        # Raised external pipe along house; restrained rather than decorative ribs.
        k.rod((side * 3.75, .60, -5.0), (side * 3.75, .60, 5.0), .035, EDGE, 4)
    chart = plan(7.5, 6.3, .65)
    pilot = plan(5.8, 5.8, 1.05)
    prism(chart, 2.40, 4.42)
    prism(pilot, 4.42, 6.18)
    # Select front/forward sides only. No glazing at the rear bulkheads.
    for outline, y, h in ((chart, 3.28, .48), (pilot, 5.22, .58)):
        for p, q in zip(outline, outline[1:] + outline[:1]):
            dx, dz = q[0] - p[0], q[1] - p[1]
            length = math.hypot(dx, dz)
            if length < .3 or (p[1] + q[1]) / 2 < -.2:
                continue
            nx, nz = -dz / length, dx / length
            n = max(1, int(length / .9))
            for i in range(n):
                t = (i + .5) / n
                k.emit(api['p_box_y'](p[0] + dx * t + nx * .028, y, p[1] + dz * t + nz * .028,
                                      min(.54, length / n * .68), h, .045, math.atan2(-dz, dx)), DARK)
    # Solid open bridge floor, low splinter shield and separate upper guard.
    open_plan = plan(7.8, 7.0, .25)
    prism(open_plan, 6.18, 6.34, DECK)
    for p, q in zip(open_plan, open_plan[1:] + open_plan[:1]):
        dx, dz = q[0] - p[0], q[1] - p[1]
        k.emit(api['p_box_y']((p[0] + q[0]) / 2, 6.34, (p[1] + q[1]) / 2,
                              math.hypot(dx, dz), .62, .08, math.atan2(-dz, dx)), STEEL)
        k.rod((p[0], 7.20, p[1]), (q[0], 7.20, q[1]), .025, EDGE, 4)
        k.rod((p[0], 6.9, p[1]), (p[0], 7.2, p[1]), .025, EDGE, 4)
    for side in (-1, 1):
        # Visible brackets carry bridge-wing overhangs.
        k.rod((side * 2.70, 5.55, .6), (side * 3.38, 6.18, .6), .08, EDGE, 6)
        # Navigation binoculars on short posts within the bridge shield.
        k.emit(api['p_cyl'](side * 2.25, 6.34, 1.8, .09, .09, .65, 8), EDGE)
        k.emit(api['p_cyl_x'](side * 2.25, 7.00, 1.8, .14, .50, 8), DARK)
    # Mk37-inspired enclosed director, elevated on a real cylindrical trunk.
    dz = -1.45
    k.emit(api['p_cyl'](0, 6.34, dz, .76, .72, 1.0, 16), EDGE)
    director = [(x, zz + dz) for x, zz in api['plan_poly'](2.5, 2.35, .55, .35, 3)]
    prism(director, 7.34, 8.75, STEEL, .09)
    k.emit(api['p_cyl_x'](0, 8.08, dz, .20, 3.25, 12), EDGE)
    for side in (-1, 1):
        k.box(side * 1.54, 8.02, dz + .21, .30, .18, .025, DARK)
    k.box(0, 8.75, dz, .65, .18, .65, EDGE)
    # Small framed open antenna, deliberately not a post-war solid radar dish.
    for x in (-.85, 0, .85):
        k.rod((x, 8.96, dz), (x, 9.86, dz - .30), .032, EDGE, 4)
    for y in (0, .3, .6, .9):
        k.rod((-.85, 8.96 + y, dz - y / 3), (.85, 8.96 + y, dz - y / 3), .024, EDGE, 4)


def build_mast(api, buf, Kit, deck, anchors):
    z = anchors['MAST']
    k = Kit(api, buf, (0, deck(z) + 2.6, z))
    k.rod((0, -.12, 0), (0, 15.2, -.55), .12, STEEL, 10)
    for side in (-1, 1):
        k.rod((side * 1.5, -.12, -1.0), (0, 7.0, -.25), .085, EDGE, 6)
    for y, width in ((6.7, 7.4), (10.8, 4.6)):
        k.rod((-width / 2, y, -.25), (width / 2, y, -.25), .055, EDGE, 5)
        for side in (-1, 1):
            k.rod((0, y + 1.0, -.29), (side * width / 2, y, -.25), .022, DARK, 3)
    # Small open SC-style search array with support frame and spindle.
    k.emit(api['p_cyl'](0, 14.7, -.55, .17, .17, .9, 10), EDGE)
    for x in (-1.65, -.825, 0, .825, 1.65):
        k.rod((x, 15.6, -.55), (x, 16.65, -.55), .025, EDGE, 4)
    for y in (15.6, 15.95, 16.3, 16.65):
        k.rod((-1.65, y, -.55), (1.65, y, -.55), .025, EDGE, 4)
    k.rod((-1.65, 15.6, -.55), (1.65, 16.65, -.55), .022, EDGE, 3)
    k.rod((1.65, 15.6, -.55), (-1.65, 16.65, -.55), .022, EDGE, 3)


def funnel_details(api, buf, Kit, z, y, radius, height, rake):
    k = Kit(api, buf, (0, y, z))
    # Bands follow the funnel rake rather than remaining at the original centre.
    for yy in (.35, height * .50, height - .65):
        zz = -math.tan(rake) * yy
        r = radius * (1 - .06 * yy / height)
        k.emit(api['p_cyl'](0, yy, zz, r * 1.035, r * 1.035, .10, 20), EDGE)
    for side in (-1, 1):
        x = side * radius * .73
        k.rod((x, .1, -radius * .78), (x, height - .1, -radius * .78 - math.tan(rake) * height), .075, EDGE, 6)


def validate_single_gun(api):
    from mathutils import Vector, Matrix
    from mathutils.bvhtree import BVHTree
    b, g, pivot = build_single_gun(api)
    base = BVHTree.FromPolygons([Vector(v) for v in b.v], b.f)
    moving = BVHTree.FromPolygons([Vector(v) for v in g.v], g.f)
    t = api['TS']['us5s']
    # Fixed armour must not obstruct the bore line across the intended elevation.
    for angle in (-5, 0, 15, 30, 45):
        theta = math.radians(angle)
        direction = Vector(api['W'](0, math.sin(theta), math.cos(theta)))
        hit = base.ray_cast(Vector(api['W'](*pivot)), direction, t['bl'] + .5)[0]
        assert hit is None, ('gun slot blocks bore line', angle, hit)
        # The four outside envelope rays are stricter than a centreline-only test.
        up = Vector(api['W'](0, math.cos(theta), -math.sin(theta)))
        for offset in (Vector((.27, 0, 0)), Vector((-.27, 0, 0)), up * .27, up * -.27):
            hit = base.ray_cast(Vector(api['W'](*pivot)) + offset, direction, t['bl'] + .5)[0]
            assert hit is None, ('barrel envelope clips house', angle, offset)
        pivot_b = Vector(api['W'](*pivot))
        rotation = Matrix.Rotation(-theta, 3, 'X')
        swept = BVHTree.FromPolygons([pivot_b + rotation @ (Vector(v) - pivot_b) for v in g.v], g.f)
        assert not base.overlap(swept), ('moving gun intersects fixed house', angle)
    muzzle = Vector(api['W'](0, pivot[1], pivot[2] + t['bl'] + .2))
    hit, normal, index, distance = moving.ray_cast(muzzle, Vector((0, 1, 0)))
    assert hit is not None and .54 < distance < .61, ('not a recessed bore', distance)
    hit, normal, index, distance = moving.ray_cast(muzzle + Vector((.075, 0, 0)), Vector((0, 1, 0)))
    assert hit is not None and .19 < distance < .22, ('missing muzzle annulus', distance)
    tri = len(b.f) + len(g.f)
    assert tri < 900, tri
    print('FLETCHER SINGLE GUN: open bore, 127mm diameter, -5..45deg bore-axis clearance;', tri, 'tri')
    return tri


def review_upperworks(ns):
    import bpy
    from mathutils import Matrix
    api = ns['load_api']()
    api['SHOTDIR'] = str(ns['ROOT'] / 'qa')
    objects = [o for prefix in ('ship_', 'ref_', 'preview_')
               for o in bpy.data.collections[prefix + ns['KEY']].objects]
    for tag, yaw, pitch, focus, span in [
            ('upper_after', 45, 14, (0, 8, 26), 33),
            ('gun_after', 40, 12, (0, 5.6, 40), 12),
            ('bridge_after', 30, 12, (0, 8, 22), 21),
            ('overall_after', 40, 16, None, None)]:
        api['render_shot']('fletcher_' + tag, objects, yaw=yaw, pitch=pitch,
                           focus=focus, span=span, res=(1400, 950))
    lights = [(o.data, o.data.use_shadow) for o in bpy.data.objects
              if o.type == 'LIGHT' and hasattr(o.data, 'use_shadow')]
    try:
        for light, enabled in lights:
            light.use_shadow = False
        api['render_shot']('fletcher_bridge_connection_check', objects, yaw=70, pitch=10,
                           focus=(0, 5.8, 26), span=23, res=(1300, 900))
    finally:
        for light, enabled in lights:
            light.use_shadow = enabled
    guns = [o for o in bpy.data.collections['preview_' + ns['KEY']].objects if o.get('mount_index') == 0]
    api['render_shot']('fletcher_gun_front', guns, yaw=0, pitch=6, res=(1100, 1000))
    barrel = next(o for o in guns if o.get('export_role') == 'barrel')
    old = barrel.matrix_world.copy()
    try:
        barrel.matrix_world = old @ Matrix.Rotation(-math.radians(45), 4, 'X')
        api['render_shot']('fletcher_gun_elev45', guns, yaw=60, pitch=10, res=(1100, 1000))
    finally:
        barrel.matrix_world = old
