"""Kirishima 1942 coordinate placeholder map. No export, no change to existing ships.

Stage 1 of the Kirishima build: prove the zones and anchors before any real geometry.
Every block is a labelled placeholder carrying the id, z and deck offset it stands for.

In Blender:
    path = r'D:\\warship-game\\art\\blender\\kirishima_1942_layout.py'
    exec(compile(open(path, encoding='utf-8').read(), path, 'exec'))
    build_layout(); review_layout(); save_layout()
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

ROOT = Path(r'D:\warship-game\art\blender')
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
LAYOUT_PATH = ROOT / 'kirishima_1942_layout.json'
KEY = 'jp_bb_kiri_draft'

COLOURS = {
    'main': (0.20, 0.45, 0.85),
    'super': (0.85, 0.45, 0.15),
    'funnel': (0.24, 0.24, 0.28),
    'mast': (0.55, 0.56, 0.60),
    'secondary': (0.25, 0.70, 0.35),
    'envelope': (0.95, 0.85, 0.20),
    'candidate': (0.95, 0.30, 0.85),
    'zone': (0.30, 0.62, 0.72),
}


def load_api():
    ns = {}
    path = ROOT / 'warship_build.py'
    exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), ns)
    return ns


def solid(name, colour):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    node = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value = (*colour, 1)
    node.inputs['Roughness'].default_value = 0.7
    m.diffuse_color = (*colour, 1)
    return m


def read_layout():
    return json.loads(LAYOUT_PATH.read_text(encoding='utf-8'))


def zone_of(layout, z):
    for zone in layout['zones']:
        if zone['z'][0] <= z <= zone['z'][1]:
            return zone['id']
    return None


def make_label(coll, text, x, y, z, facing, size=1.5):
    curve = bpy.data.curves.new('lbc_' + text, type='FONT')
    curve.body = text
    curve.size = size
    curve.extrude = 0.04
    curve.bevel_depth = 0.008
    ob = bpy.data.objects.new('lb_' + text, curve)
    if facing == 'up':
        ob.rotation_euler = (0.0, 0.0, 0.0)
    elif facing == 'plan':
        # rotated so a plan-view label runs along the ship instead of across it
        ob.rotation_euler = (0.0, 0.0, math.radians(90.0))
    else:
        # text up = world +Z, normal = world +X, so the side view reads left to right
        ob.rotation_euler = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))).to_euler()
    ob.location = (x, -z, y)
    coll.objects.link(ob)
    return ob


def envelope(api, x, z, base, footprint):
    """Corner posts plus a top outline: a height allowance, not a building.

    Returns one (verts, faces) pair so the caller can colour it as a whole.
    """
    ln, wd, h = footprint['len'], footprint['w'], footprint['h']
    verts, faces = [], []
    for sx in (-1, 1):
        for sz in (-1, 1):
            v, f = api['p_rod']((x + sx * wd / 2, base, z + sz * ln / 2),
                                (x + sx * wd / 2, base + h, z + sz * ln / 2), 0.09, 5)
            verts.extend(v)
            faces.extend(f)
    corners = [(x - wd / 2, z - ln / 2), (x + wd / 2, z - ln / 2),
               (x + wd / 2, z + ln / 2), (x - wd / 2, z + ln / 2)]
    for a, b in zip(corners, corners[1:] + corners[:1]):
        v, f = api['p_rod']((a[0], base + h, a[1]), (b[0], base + h, b[1]), 0.09, 5)
        offset = len(verts)
        verts.extend(v)
        faces.extend(tuple(offset + i for i in face) for face in f)
    return verts, faces


SHORT = {
    'MAIN_01': 'M01', 'MAIN_02': 'M02', 'MAIN_03': 'M03', 'MAIN_04': 'M04',
    'BRIDGE_BASE': 'BR_BASE', 'BRIDGE_TOWER': 'BR_TOWER', 'FOREMAST': 'F_MAST',
    'MID_DECKHOUSE': 'MID_DH', 'FUNNEL_01': 'FUN1', 'FUNNEL_02': 'FUN2',
    'AFT_CONTROL_BASE': 'AFT_BASE', 'AFT_TOWER': 'AFT_TW', 'MAINMAST': 'M_MAST',
}


def short(ident):
    return SHORT.get(ident, ident)


def pack_lanes(specs, size, along_ship):
    """Assign a lane per label so no two labels in one lane overlap.

    Both the plan labels (rotated to run fore and aft) and the side labels run
    along the ship, so the spacing that matters is the rendered text length.
    """
    lanes = []
    out = {}
    for ident, z, offset in sorted(specs, key=lambda s: -s[1]):
        text = label_text(ident, z, offset, along_ship)
        gap = 0.62 * size * len(text) + 1.5
        lane = 0
        while lane < len(lanes) and (lanes[lane] - z) < gap:
            lane += 1
        if lane == len(lanes):
            lanes.append(z)
        else:
            lanes[lane] = z
        out[ident] = lane
    return out


def label_text(ident, z, offset, side):
    name = short(ident)
    if offset is None:
        return '%s z%g' % (name, z)
    return '%s z%g' % (name, z) if side else '%s z%g h%+g' % (name, z, offset)


def place_labels(api, add, top, side, deck, deck0, half_width, anchors, zones):
    size = 1.8
    anchor_side = pack_lanes(anchors, size, True)
    anchor_top = pack_lanes(anchors, size, False)
    zone_side = pack_lanes(zones, size, True)
    zone_top = pack_lanes(zones, size, False)
    base_row = deck0 + 36.0
    zone_row = base_row + (max(anchor_side.values()) + 1) * 3.6

    for ident, z, offset in anchors:
        lane = anchor_top[ident]
        x = 18.5 + lane * 3.2
        make_label(top, label_text(ident, z, offset, False), x, deck(z) + 0.4, z, 'plan', size)
        make_label(side, label_text(ident, z, offset, True), 0.0,
                   base_row + anchor_side[ident] * 3.6, z, 'side', size)
        # leader from the label to its own anchor, one line per id, with a
        # visible dot at the anchor end so the line reads as a pointer
        add('zone', *api['p_rod']((x - 1.0, deck(z) + 0.4, z),
                                  (half_width(z) + 0.3, deck(z) + 0.4, z), 0.05, 4))
        add('zone', *api['p_box'](half_width(z) + 0.3, deck(z) + 0.15, z, 0.5, 0.5, 0.5))
        add('zone', *api['p_rod']((0.0, deck(z) + 0.4, z),
                                  (0.0, base_row + anchor_side[ident] * 3.6 - 1.2, z), 0.05, 4))

    for ident, z, _ in zones:
        x = -18.5 - zone_top[ident] * 3.2
        make_label(top, label_text(ident, z, None, False), x, deck(z) + 0.4, z, 'plan', size)
        make_label(side, label_text(ident, z, None, True), 0.0,
                   zone_row + zone_side[ident] * 3.6, z, 'side', size)
        add('zone', *api['p_rod']((x + 1.0, deck(z) + 0.4, z),
                                  (-half_width(z) - 0.3, deck(z) + 0.4, z), 0.05, 4))


def build_layout():
    api = load_api()
    layout = read_layout()
    spec = api['SHIPS']['jp_bb']
    assert spec['L'] == layout['frame']['length'] and spec['B'] == layout['frame']['beam']
    ship = api['coll_named']('ship_' + KEY)
    ref = api['coll_named']('ref_' + KEY)
    preview = api['coll_named']('preview_' + KEY)
    top = api['coll_named']('labels_top_' + KEY)
    side = api['coll_named']('labels_side_' + KEY)
    hull = api['build_hull_ref']('jp_bb', ref)
    hull['PREVIEW_ONLY'] = True

    bufs = {name: api['Buf']() for name in COLOURS}

    def add(name, *shape):
        bufs[name].emit(*shape, col=COLOURS[name])

    deck = lambda z: api['deck_y'](spec, z)
    half_width = lambda z: spec['B'] / 2 * api['half_w'](z / spec['L'] + 0.5)

    deck0 = deck(0.0)
    label_specs = []
    zone_specs = []

    # zone boundary markers: a bar across the deck plus a post at each side
    for zone in layout['zones']:
        for edge in zone['z']:
            hw = half_width(edge)
            add('zone', *api['p_box'](0, deck(edge) + 0.05, edge, hw * 2, 0.12, 0.12))
            for sx in (-1, 1):
                add('zone', *api['p_box'](sx * (hw - 0.25), deck(edge) - 3.0, edge, 0.2, 9.0, 0.2))
        mid = (zone['z'][0] + zone['z'][1]) / 2
        zone_specs.append((zone['id'], mid, None))

    for anchor in layout['anchors']:
        x, z = anchor['x'], anchor['z']
        base = deck(z) + anchor['deckOffset']
        kind = anchor['kind']
        if kind == 'main':
            t = api['TS'][anchor['turret']]
            add(kind, *api['p_cyl'](x, base, z, t['w'] / 2, t['w'] / 2 * 0.94, t['h'], seg=16))
            # barrel at zero elevation, pointing along the mount's face angle
            yaw = math.radians(anchor['face'])
            pivot = (x, base + t['h'] * 0.5, z + t['len'] * 0.18 * math.cos(yaw))
            tip = (pivot[0], pivot[1], pivot[2] + t['bl'] * math.cos(yaw))
            add(kind, *api['p_rod'](pivot, tip, t['br'] * 2.4, 8))
            top_y = base + t['h'] + 2.6
        elif kind == 'super':
            f = anchor['footprint']
            plan = [(px + x, pz + z) for px, pz in api['plan_poly'](f['len'], f['w'], 0.3, 0.3, 3)]
            add(kind, *api['p_prism'](plan, plan, base, base + f['h'], True, True))
            top_y = base + f['h'] + 2.6
        elif kind == 'funnel':
            f = anchor['footprint']
            rake = math.radians(f['rakeDeg'])
            add(kind, *api['p_cyl'](x, base, z, f['r'], f['r'] * 0.9, f['h'], seg=16, rake=rake))
            top_y = base + f['h'] + 2.2
        elif kind == 'mast':
            f = anchor['footprint']
            add(kind, *api['p_cyl'](x, base, z, f['r'], f['r'] * 0.6, f['h'], seg=8))
            add(kind, *api['p_cyl_x'](x, base + f['h'] * 0.7, z, 0.15, 8, 6))
            top_y = base + f['h'] + 2.2
        else:  # envelope
            add(kind, *envelope(api, x, z, base, anchor['footprint']))
            top_y = base + anchor['footprint']['h'] + 1.6
        label_specs.append((anchor['id'], z, anchor['deckOffset']))

    for mount in layout['secondary']:
        for sx in (1, -1):
            z = mount['z']
            y = deck(z) + mount['deckOffset']
            add('secondary', *api['p_cyl'](sx * mount['x'], y, z, 1.15, 1.15, 1.4, seg=10))
    for cand in layout['candidates']:
        add('candidate', *envelope(api, 0, (cand['z'][0] + cand['z'][1]) / 2, deck(cand['z'][1]),
                                   {'len': cand['z'][1] - cand['z'][0], 'w': 12.0, 'h': 6.0}))
        mid = (cand['z'][0] + cand['z'][1]) / 2
        zone_specs.append((cand['id'] + ' ?', mid, None))

    place_labels(api, add, top, side, deck, deck0, half_width, label_specs, zone_specs)

    objects = {}
    for name, buf in bufs.items():
        if not buf.v:
            continue
        ob = api['make_obj']('layout_' + name + '_' + KEY, buf, coll=ship)
        ob.data.materials[0] = solid('layout_' + name, COLOURS[name])
        ob['PREVIEW_ONLY'] = True
        objects[name] = ob

    api['show_ship'](KEY)
    bpy.context.view_layer.update()
    report = validate_layout()
    hull['layout_report'] = json.dumps(report)
    for name in ('kirishima_1942_layout.py', 'kirishima_1942_layout.json', 'KIRISHIMA_1942_PLAN.md'):
        path = ROOT / name
        if path.exists():
            text = bpy.data.texts.get(name) or bpy.data.texts.new(name)
            text.clear()
            text.write(path.read_text(encoding='utf-8'))
    print('Kirishima layout placeholder built:', len(layout['anchors']), 'anchors,',
          len(layout['zones']), 'zones')
    return hull, objects, report


def validate_layout():
    api = load_api()
    layout = read_layout()
    spec = api['SHIPS']['jp_bb']
    deck = lambda z: api['deck_y'](spec, z)
    half_width = lambda z: spec['B'] / 2 * api['half_w'](z / spec['L'] + 0.5)
    problems = []
    notes = []

    zones = sorted(layout['zones'], key=lambda z: z['z'][0])
    if zones[0]['z'][0] != -111 or zones[-1]['z'][1] != 111:
        problems.append('zones do not cover the full length')
    for a, b in zip(zones, zones[1:]):
        if a['z'][1] != b['z'][0]:
            problems.append('zone gap/overlap %s %s' % (a['id'], b['id']))

    for anchor in layout['anchors']:
        z = anchor['z']
        if zone_of(layout, z) != anchor['zone']:
            problems.append('%s is in %s, declared %s' % (anchor['id'], zone_of(layout, z), anchor['zone']))
        f = anchor.get('footprint', {})
        if anchor['kind'] == 'main':
            reach = api['TS'][anchor['turret']]['w'] / 2
        elif 'r' in f:
            reach = f['r']
        else:
            reach = f['w'] / 2
        margin = half_width(z) - (abs(anchor['x']) + reach)
        if margin < 0:
            problems.append('%s overhangs the hull by %.2fm' % (anchor['id'], -margin))
        elif margin < 0.5:
            notes.append('%s only %.2fm inside the hull side' % (anchor['id'], margin))

    for mount in layout['secondary']:
        margin = half_width(mount['z']) - mount['x']
        if margin < 0:
            problems.append('%s casemate is outside the hull' % mount['id'])
        elif margin < 0.5:
            notes.append('%s casemate only %.2fm inside the hull side' % (mount['id'], margin))

    # superfiring clearance: the raised turret must shoot over the turret it fires past
    t = api['TS']['jp14d']
    for raised, below in (('MAIN_02', 'MAIN_01'), ('MAIN_03', 'MAIN_04')):
        a = next(x for x in layout['anchors'] if x['id'] == raised)
        b = next(x for x in layout['anchors'] if x['id'] == below)
        pivot = deck(a['z']) + a['deckOffset'] + t['h'] * 0.5
        roof = deck(b['z']) + b['deckOffset'] + t['h']
        clearance = pivot - roof
        notes.append('%s barrel centreline clears %s roof by %.2fm' % (raised, below, clearance))
        if clearance < 0.3:
            problems.append('%s does not clear %s' % (raised, below))

    # known sweeps that must be resolved by gameplay limits or geometry, not by silence
    bridge = next(x for x in layout['anchors'] if x['id'] == 'BRIDGE_TOWER')
    for tid in ('MAIN_01', 'MAIN_02'):
        a = next(x for x in layout['anchors'] if x['id'] == tid)
        pivot_z = a['z'] - t['len'] * 0.18
        muzzle_z = pivot_z - t['bl']
        if bridge['z'] - bridge['footprint']['len'] / 2 <= muzzle_z <= bridge['z'] + bridge['footprint']['len'] / 2:
            notes.append('%s firing astern reaches z%.1f, inside the bridge tower footprint' % (tid, muzzle_z))
    t2 = next(x for x in layout['anchors'] if x['id'] == 'MAIN_02')
    notes.append('MAIN_02 astern muzzle z%.1f vs bridge tower top y%.1f; barrel centreline y%.1f'
                 % (t2['z'] - t['len'] * 0.18 - t['bl'], deck(40) + bridge['footprint']['h'],
                    deck(t2['z']) + t2['deckOffset'] + t['h'] * 0.5))

    if any(c['status'] != 'unresolved' for c in layout['candidates']):
        problems.append('candidate areas must stay unresolved until a photo check')

    visible = [o.name for o in bpy.context.scene.objects
               if o.name.startswith('refhull_') and not o.hide_get() and not o.hide_render]
    if len(visible) != 1:
        problems.append('more than one hull is visible: %s' % visible)

    if problems:
        raise AssertionError('layout problems: %s' % problems)
    print('LAYOUT VALID: zones contiguous, anchors inside their zones and the hull,'
          ' superfiring clearance positive, one hull visible')
    for n in notes:
        print('  note:', n)
    return {'notes': notes, 'problems': problems}


def review_layout():
    api = load_api()
    api['show_ship'](KEY)
    api['SHOTDIR'] = str(ROOT / 'qa')
    objects = [o for prefix in ('ship_', 'ref_', 'preview_') for o in bpy.data.collections[prefix + KEY].objects]
    top = list(bpy.data.collections['labels_top_' + KEY].objects)
    side = list(bpy.data.collections['labels_side_' + KEY].objects)

    def show(labels):
        for o in top + side:
            o.hide_render = o not in labels

    out = []
    show(top)
    out.append(api['render_shot']('kirishima_layout_top', objects + top, yaw=0, pitch=90,
                                  ortho=True, res=(2000, 760)))
    for tag, zc in (('bow', 58), ('stern', -58)):
        out.append(api['render_shot']('kirishima_layout_top_' + tag, objects + top, yaw=0, pitch=90,
                                      ortho=True, focus=(0, 0, zc), span=140, res=(1500, 900)))
    show(side)
    out.append(api['render_shot']('kirishima_layout_side', objects + side, yaw=90, pitch=0,
                                  ortho=True, res=(2000, 760)))
    for tag, zc in (('bow', 58), ('stern', -58)):
        out.append(api['render_shot']('kirishima_layout_side_' + tag, objects + side, yaw=90, pitch=0,
                                      ortho=True, focus=(0, 14, zc), span=140, res=(1500, 900)))
    out.append(api['render_shot']('kirishima_layout_qbow', objects + side, yaw=38, pitch=14,
                                  res=(1400, 850)))
    return out


def save_layout():
    validate_layout()
    path = ROOT / 'checkpoint_18_kirishima_layout_blockout.blend'
    assert not path.exists() or bpy.data.filepath == str(path), 'Refuse to overwrite another checkpoint'
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    print('Saved', path)
