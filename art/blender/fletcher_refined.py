"""Fletcher class: hull, deckhouse/bridge, funnels, torpedo tubes and visual guns.

Built from anchors resolved ONCE per group, so a layout change cannot leave
windows or supports behind. Simulation guns stay on their own pivots.
"""
import bpy
import bmesh
import importlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(r'D:\warship-game\art\blender')
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
_cache = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    import fletcher_profile
    FletcherProfile = importlib.reload(fletcher_profile).FletcherProfile
finally:
    sys.dont_write_bytecode = _cache

KEY = 'us_dd_game'
STEEL = (0.58, 0.63, 0.67)
EDGE = (0.45, 0.50, 0.54)
DECK = (0.26, 0.31, 0.33)
DARK = (0.10, 0.14, 0.17)

ANCHORS = {
    'BRIDGE': 22.0,
    'FUNNEL_01': 8.0,
    'FUNNEL_02': -6.0,
    'TORPEDO_01': 1.0,
    'TORPEDO_02': -17.5,
    'AFT_HOUSE': -27.0,
    'MAST': 17.0,
}


def load_api():
    ns = {}
    path = ROOT / 'warship_build.py'
    exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), ns)
    return ns


def detail_material(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    shader = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    colour = next((n for n in nodes if n.type == 'VERTEX_COLOR'), None)
    if colour is None:
        colour = nodes.new('ShaderNodeVertexColor')
    colour.layer_name = 'Col'
    mat.node_tree.links.new(colour.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = 0.72
    return mat


class Kit:
    def __init__(self, api, buf, origin):
        self.a, self.b, self.origin = api, buf, origin

    def emit(self, shape, col=STEEL):
        vertices, faces = shape
        x, y, z = self.origin
        self.b.emit([(v[0] + x, v[1] - z, v[2] + y) for v in vertices], faces, col=col)

    def box(self, x, y, z, w, h, d, col=STEEL):
        self.emit(self.a['p_box'](x, y, z, w, h, d), col)

    def rod(self, p, q, r=0.05, col=EDGE, seg=4):
        v, f = self.a['p_rod'](p, q, r, seg)
        self.emit((v, f[:2 * seg]), col)

    def body(self, z, y, length, width, height, shrink=0.08, col=STEEL):
        lo = [(x, zz + z) for x, zz in self.a['plan_poly'](length, width, 0.4, 0.3, 3)]
        hi = [(x, zz + z) for x, zz in self.a['plan_poly'](length - shrink, width - shrink, 0.4, 0.3, 3)]
        self.emit(self.a['p_prism'](lo, hi, y, y + height, True, True), col)
        return lo

    def windows(self, outline, y, h=0.42):
        for p, q in zip(outline, outline[1:] + outline[:1]):
            dx, dz = q[0] - p[0], q[1] - p[1]
            length = math.hypot(dx, dz)
            if length < 0.5:
                continue
            nx, nz = -dz / length, dx / length
            for i in range(max(1, int(length / 0.8))):
                t = (i + 0.5) / max(1, int(length / 0.8))
                self.emit(self.a['p_box_y'](p[0] + dx * t + nx * 0.025, y, p[1] + dz * t + nz * 0.025,
                                            0.44, h, 0.035, math.atan2(-dz, dx)), (0.10, 0.16, 0.19))
    def rails(self, z, y, length, width, height=0.8):
        outline = [(x, zz + z) for x, zz in self.a['plan_poly'](length, width, 0.5, 0.3, 3)]
        for p, q in zip(outline, outline[1:] + outline[:1]):
            for up in (0.42, height):
                self.rod((p[0], y + up, p[1]), (q[0], y + up, q[1]), 0.023, DARK, 3)
        for p in outline:
            self.rod((p[0], y, p[1]), (p[0], y + height, p[1]), 0.028, EDGE, 3)


def hull_mesh(api, p, coll):
    count = len(p.levels)
    ring = 2 * count - 1
    vertices, faces, decks = [], [], []
    stations = p.stations()
    for s in stations:
        half = [p.sample(s, *level) for level in p.levels]
        vertices.extend(api['W'](*v) for v in half + [(-x, y, z) for x, y, z in reversed(half[1:])])
    for row in range(len(stations) - 1):
        for j in range(ring):
            k = (j + 1) % ring
            faces.append((row * ring + j, row * ring + k, (row + 1) * ring + k, (row + 1) * ring + j))
            if j == count - 1:
                decks.append(len(faces) - 1)
    faces.append(tuple(reversed(range(ring))))
    mesh = bpy.data.meshes.new('fletcher_production_hull')
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(detail_material('fletcher_game_shell'))
    mesh.materials.append(detail_material('fletcher_game_deck'))
    colours = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    for face in mesh.polygons:
        face.use_smooth = True
        for li in face.loop_indices:
            colours.data[li].color = (*STEEL, 1)
    for i in decks:
        mesh.polygons[i].material_index = 1
        mesh.polygons[i].use_smooth = False
        for li in mesh.polygons[i].loop_indices:
            colours.data[li].color = (*DECK, 1)
    mesh.polygons[-1].use_smooth = False
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    for edge in bm.edges:
        if len({f.material_index for f in edge.link_faces}) > 1:
            edge.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    hull = bpy.data.objects.new('refhull_' + KEY, mesh)
    coll.objects.link(hull)
    hull['visual_profile'] = 'Fletcher game hull, 114x12m'
    return hull


def build_fletcher():
    api = load_api()
    spec = api['SHIPS']['us_dd']
    original = json.dumps(spec, sort_keys=True)
    p = FletcherProfile()
    deck = lambda z: p.deck(z / spec['L'] + 0.5)
    ship = api['coll_named']('ship_' + KEY)
    ref = api['coll_named']('ref_' + KEY)
    hull = hull_mesh(api, p, ref)

    buf = api['Buf']()
    k = Kit(api, buf, (0.0, 0.0, 0.0))

    # Carry elevated equipment on real deckhouses rather than leaving it in air.
    # Bases extend slightly into the sloping deck; gun pivots themselves stay free.
    k.body(1.0, min(deck(-12.5), deck(14.5)) - 0.12, 27.0, 6.4, 2.60, 0.12)
    k.body(-17.5, deck(-17.5) - 0.10, 6.0, 4.6, 2.50, 0.10)
    for mount in spec['tur']:
        if mount['y'] > 0:
            z = mount['z']; y = deck(z)
            k.body(z, min(deck(z - 3.0), deck(z + 3.0)) - 0.1,
                   6.0, 5.4, mount['y'] + y - min(deck(z - 3.0), deck(z + 3.0)) + 0.1,
                   0.08)

    upper = {}
    path = ROOT / 'fletcher_upperworks.py'
    exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), upper)
    upper['build_bridge'](api, buf, Kit, deck, ANCHORS)
    upper['build_mast'](api, buf, Kit, deck, ANCHORS)

    # two raked funnels
    for ident, radius, height in (('FUNNEL_01', 1.75, 8.2), ('FUNNEL_02', 1.75, 7.6)):
        z = ANCHORS[ident]
        y = deck(z) + 2.4
        rake = math.radians(9)
        shift = -math.tan(rake) * height
        k.emit(api['p_cyl'](0, y, z, radius, radius * 0.94, height, seg=18, squash=1.0, rake=rake), STEEL)
        k.emit(api['p_cyl'](0, y + height - 0.5, z + shift, radius * 0.97, radius * 0.92, 0.55, seg=18), DARK)
        outer = [(math.cos(i * math.tau / 18) * radius * 1.03, y + height,
                  z + shift + math.sin(i * math.tau / 18) * radius * 1.03) for i in range(18)]
        inner = [(x * 0.84, yy, zz + (z + shift - zz) * 0.16) for x, yy, zz in outer]
        verts = [api['W'](*v) for v in outer + inner]
        faces = []
        for i in range(18):
            j = (i + 1) % 18
            faces.extend(((i, j, 18 + j), (i, 18 + j, 18 + i)))
        k.emit((verts, faces), DARK)
        upper['funnel_details'](api, buf, Kit, z, y, radius, height, rake)

    # quintuple torpedo tubes on the centreline, with their shields
    # Quintuple tubes, trainable to one side: five clearly separated barrels on
    # a visible pedestal, angled so the mount reads as torpedo armament.
    for ident, train in (('TORPEDO_01', 32.0), ('TORPEDO_02', -32.0)):
        z = ANCHORS[ident]
        y = deck(z) + 2.4
        k.emit(api['p_cyl'](0, y, z, 1.25, 1.18, 0.85, seg=16), EDGE)
        k.box(0, y + 0.85, z, 2.4, 0.55, 3.2, STEEL)
        angle = math.radians(train)
        ca, sa = math.cos(angle), math.sin(angle)
        for i in range(5):
            ox, oz = -0.62 + i * 0.31, 0.0
            cx, cz = ox * ca - oz * sa, ox * sa + oz * ca
            start = len(buf.v)
            k.emit(api['p_lathe_z'](cx, y + 1.65, z + cz,
                                    [(0.24, -2.6), (0.25, 2.5), (0.21, 2.6), (0.13, 2.6)], 10), (0.40, 0.44, 0.48))
            end = len(buf.v)
            for vi in range(start, end):
                vx, vy, vz = buf.v[vi]
                # buf holds Blender coords: hull x = vx, hull z = -vy.
                rx, rz = vx - cx, -vy - (z + cz)
                hx = cx + rx * ca - rz * sa
                hz = (z + cz) + rx * sa + rz * ca
                buf.v[vi] = (hx, -hz, vz)
        # shield over the tubes, carried on real posts down to the mount
        k.box(0, y + 2.35, z, 2.6, 0.12, 4.0, EDGE)
        for dx in (-1.1, 1.1):
            k.rod((dx, y + 1.1, z - 1.0), (dx, y + 2.35, z - 1.0), 0.07, EDGE, 4)
            k.rod((dx, y + 1.1, z + 1.0), (dx, y + 2.35, z + 1.0), 0.07, EDGE, 4)

    # aft deckhouse, searchlight platform and depth charge racks
    aft_z = ANCHORS['AFT_HOUSE']
    aft_y = deck(aft_z)
    aft = k.body(aft_z, aft_y, 11.0, 7.0, 2.8, 0.2)
    k.windows(aft, aft_y + 1.0)
    k.emit(api['p_cyl'](0, aft_y + 2.8, aft_z - 4.0, 0.7, 0.66, 0.5, 12), EDGE)
    k.emit(api['p_cyl_z'](0, aft_y + 3.3, aft_z - 3.7, 0.5, 0.6, 12), STEEL)
    for side in (-1, 1):
        for dz in (-1.0, 0.6):
            k.box(side * 4.6, aft_y + 0.2, aft_z + dz, 1.6, 0.7, 1.0, EDGE)
            k.emit(api['p_cyl'](side * 4.6, aft_y - 0.2, aft_z + dz, 0.22, 0.22, 0.7, seg=8), DARK)

    ob = api['make_obj']('super_' + KEY, buf, coll=ship)
    ob.data.materials[0] = detail_material('fletcher_game_detail')
    ob['PREVIEW_ONLY'] = True
    ob['anchors'] = json.dumps(ANCHORS)

    rails = api['Buf']()
    stats = {}
    path = ROOT / 'game_railings.py'
    ns = {}
    exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), ns)
    # Stop short of the razor-thin bow tip: the shared generator's 8cm minimum
    # lateral offset would otherwise put its final posts outside this fine entry.
    stats = ns['add_deck_railings'](api, rails, lambda s: p.sample(min(s, .993), 'upper', 1), spec['L'])
    rails_ob = api['make_obj']('super_' + KEY + '_rails', rails, coll=ship)
    rails_ob.data.materials[0] = detail_material('fletcher_game_rails')
    for face in rails_ob.data.polygons:
        face.use_smooth = True
    rails_ob['railStats'] = json.dumps(stats)
    rails_ob['railFeet'] = json.dumps(rails.rail_feet)

    # Independent Fletcher-only models: never mutate shared approved gun sources.
    from mathutils import Matrix, Vector
    preview = api['coll_named']('preview_' + KEY)
    b, g, pivot = upper['build_single_gun'](api)
    base = api['make_obj']('fletcher_mk30_base_0', b, coll=preview)
    barrel = api['make_obj']('fletcher_mk30_barrel_0', g, origin=pivot, coll=preview)
    for i, mount in enumerate(spec['tur']):
        transform = (Matrix.Translation(Vector(api['W'](mount['x'], deck(mount['z']) + mount['y'], mount['z'])))
                     @ Matrix.Rotation(mount['face'], 4, 'Z'))
        for source, role, origin in ((base, 'base', (0, 0, 0)), (barrel, 'barrel', pivot)):
            obj = source if i == 0 else bpy.data.objects.new('fletcher_mk30_' + role + '_' + str(i), source.data)
            if i: preview.objects.link(obj)
            obj.matrix_world = transform @ Matrix.Translation(Vector(api['W'](*origin)))
            obj['mount_index'] = i
            obj['export_role'] = role
            obj['kind'] = 'us5s_fletcher_preview'
            obj.data.materials[0] = detail_material('fletcher_game_gun')
    api['show_ship'](KEY)
    bpy.context.view_layer.update()
    assert json.dumps(spec, sort_keys=True) == original, 'simulation snapshot mutated'
    validate_fletcher()
    return hull


def validate_fletcher():
    from mathutils import Vector, Matrix
    from mathutils.bvhtree import BVHTree
    api = load_api()
    spec = api['SHIPS']['us_dd']
    p = FletcherProfile()
    deck = lambda z: p.deck(z / spec['L'] + 0.5)
    hull = bpy.data.objects['refhull_' + KEY]
    bm = bmesh.new()
    bm.from_mesh(hull.data)
    assert all(e.is_manifold for e in bm.edges), 'open hull'
    assert all(f.calc_area() > 1e-9 for f in bm.faces), 'degenerate faces'
    assert bm.calc_volume(signed=True) > 0, 'inward normals'
    bm.free()
    assert abs(hull.dimensions.x - spec['B']) < 1e-4 and abs(hull.dimensions.y - spec['L']) < 1e-4
    surfaces = []
    for obj in (hull, bpy.data.objects['super_' + KEY]):
        surfaces.append(BVHTree.FromPolygons([obj.matrix_world @ v.co for v in obj.data.vertices],
                                           [tuple(f.vertices) for f in obj.data.polygons]))
    for i, mount in enumerate(spec['tur']):
        shape = api['TS'][mount['kind']]
        expected = (Matrix.Translation(Vector(api['W'](mount['x'], deck(mount['z']) + mount['y'], mount['z'])))
                    @ Matrix.Rotation(mount['face'], 4, 'Z')
                    @ Vector(api['W'](0, shape['h'] * 0.5, shape['len'] * 0.18)))
        barrel = next(o for o in bpy.data.collections['preview_' + KEY].objects
                      if o.get('mount_index') == i and o.get('export_role') == 'barrel')
        assert (barrel.matrix_world.translation - expected).length < 0.001
        hits = [tree.ray_cast(Vector(api['W'](mount['x'], 50, mount['z'])), Vector((0, 0, -1)))[0]
                for tree in surfaces]
        height = max(hit.z for hit in hits if hit is not None)
        assert abs(height - (deck(mount['z']) + mount['y'])) < .06, ('unsupported mount', i, height)
    assert hull.data.color_attributes.get('Col') is not None, 'missing hull colour attribute'
    feet = json.loads(bpy.data.objects['super_' + KEY + '_rails']['railFeet'])
    for foot in feet:
        hit = surfaces[0].ray_cast(Vector(api['W'](foot[0], 50, foot[2])), Vector((0, 0, -1)))[0]
        assert hit is not None and abs(hit.z - foot[1]) < .04, ('floating railing', foot)
    upper = {}
    path = ROOT / 'fletcher_upperworks.py'
    exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), upper)
    upper['validate_single_gun'](api)
    # Conservative plan-view sweep of each house, separate from bore elevation.
    p_radius = math.hypot(1.15, 2.05)
    for mount in spec['tur']:
        min_halfwidth = min(p.sample((mount['z'] + dz) / spec['L'] + .5, 'upper', 1)[0]
                            for dz in (-2.4, 0, 2.4))
        assert min_halfwidth - .14 > p_radius, ('house sweep too close to deck guard', mount)
    tri = sum(len(f.vertices) - 2 for prefix in ('ship_', 'ref_', 'preview_')
              for o in bpy.data.collections[prefix + KEY].objects if o.type == 'MESH' for f in o.data.polygons)
    assert tri < 20000, tri
    print('FLETCHER VALID: closed hull, actual %sx%sm, 5 visual deck-relative pivots; simulation untouched; %d tri' % (spec['L'], spec['B'], tri))
    return tri


def review_fletcher():
    api = load_api()
    api['show_ship'](KEY)
    api['SHOTDIR'] = str(ROOT / 'qa')
    objects = [o for prefix in ('ship_', 'ref_', 'preview_') for o in bpy.data.collections[prefix + KEY].objects]
    api['render_shot']('fletcher_side', objects, yaw=90, pitch=0, ortho=True, res=(1500, 650))
    api['render_shot']('fletcher_qbow', objects, yaw=40, pitch=14, res=(1300, 850))
    api['render_shot']('fletcher_bridge', objects, yaw=45, pitch=16, focus=(0, 9, 20), span=45, res=(1200, 850))


def review_fletcher_hull():
    api = load_api()
    api['show_ship'](KEY)
    api['SHOTDIR'] = str(ROOT / 'qa')
    objects = [o for prefix in ('ship_', 'ref_', 'preview_') for o in bpy.data.collections[prefix + KEY].objects]
    for tag, yaw, pitch in [('side', 90, 0), ('bow', 35, 16), ('stern', 145, 20)]:
        api['render_shot']('fletcher_hull_after_' + tag, objects, yaw=yaw, pitch=pitch,
                           ortho=(tag == 'side'), res=(1500, 650) if tag == 'side' else (1400, 850))
    hull = bpy.data.objects['refhull_' + KEY]
    for tag, yaw, pitch, focus, span in [
            ('top', 90, 90, None, None), ('bow_detail', 40, 2, (0, .5, 47), 27),
            ('stern_detail', 145, 12, (0, 0, -49), 25),
            ('front', 0, 0, (0, .5, 42), 19), ('rear', 180, 0, (0, 0, -49), 19)]:
        api['render_shot']('fletcher_hull_only_' + tag, [hull], yaw=yaw, pitch=pitch,
                           focus=focus, span=span, ortho=True, res=(1200, 800))


def save_fletcher():
    validate_fletcher()
    path = ROOT / 'checkpoint_30_fletcher_guns_and_bridge.blend'
    assert not path.exists() or bpy.data.filepath == str(path)
    for name in ('fletcher_refined.py', 'fletcher_profile.py', 'fletcher_profile.json', 'game_railings.py',
                 'FLETCHER_HULL_REFINEMENT.md', 'test_fletcher_profile.py', 'fletcher_upperworks.py',
                 'FLETCHER_GUNS_AND_BRIDGE.md'):
        p = ROOT / name
        if p.exists():
            t = bpy.data.texts.get(name) or bpy.data.texts.new(name)
            t.clear()
            t.write(p.read_text(encoding='utf-8'))
    t = bpy.data.texts.get('START_HERE_fletcher.txt') or bpy.data.texts.new('START_HERE_fletcher.txt')
    t.clear()
    t.write('FLETCHER DD — hull, bridge, funnels and torpedo tubes.\n'
            'checkpoint_30_fletcher_guns_and_bridge.blend\n'
            'Fletcher-only single gun houses and early round bridge/director.\n'
            'Hull: lower flush deck, rounded fantail, raked stern run and V entry.\n'
            'Visual guns follow visual deck; longitudinal/lateral mounts unchanged.\n'
            'Not exported to the game yet; no simulation values changed.\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    print('Saved', path)
