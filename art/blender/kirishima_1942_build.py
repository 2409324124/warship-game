"""Kirishima 1942 stage 2: hull and superstructure blockout from the locked layout.

Stage 1 (kirishima_1942_layout.py) fixed the zones and anchors. This script builds
real geometry from those anchors and refuses to move them silently.

In Blender:
    path = r'D:\\warship-game\\art\\blender\\kirishima_1942_build.py'
    exec(compile(open(path, encoding='utf-8').read(), path, 'exec'))
    build_kirishima(); review_kirishima(); save_kirishima()
"""
import importlib
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh

ROOT = Path(r'D:\warship-game\art\blender')
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
_cache = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    import kirishima_1942_profile
    KirishimaProfile = importlib.reload(kirishima_1942_profile).KirishimaProfile
finally:
    sys.dont_write_bytecode = _cache

KEY = 'jp_bb_kiri'
LAYOUT_PATH = ROOT / 'kirishima_1942_layout.json'
STEEL = (0.57, 0.62, 0.66)
DARK = (0.12, 0.16, 0.19)
DECKPAINT = (0.29, 0.34, 0.37)


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
    node.inputs['Roughness'].default_value = 0.78
    m.diffuse_color = (*colour, 1)
    return m


def detail_material(name):
    """Preserve Buf's Col attribute; a constant Base Color erased every window."""
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes=True
    nodes=mat.node_tree.nodes
    shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    colour=next((n for n in nodes if n.type=='VERTEX_COLOR'),None)
    if colour is None:colour=nodes.new('ShaderNodeVertexColor')
    colour.layer_name='Col'
    mat.node_tree.links.new(colour.outputs['Color'],shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value=.72
    mat.diffuse_color=(.40,.46,.50,1)
    return mat


def island_module():
    path=ROOT/'kirishima_island_refined.py'
    module={}
    exec(compile(path.read_text(encoding='utf-8'),str(path),'exec'),module)
    return module


def game_export_module():
    path=ROOT/'kirishima_game_export.py'
    module={}
    exec(compile(path.read_text(encoding='utf-8'),str(path),'exec'),module)
    return module


def refined_island(which,api,buf,deck,layout,dz=0):
    module=island_module()
    if which=='bridge':return module['build_bridge_refined'](api,buf,deck,layout,dz)
    if which=='central_mast':return module['build_central_mast'](api,buf,deck,layout)
    return module['build_aft_refined'](api,buf,deck,layout)


def anchor(layout, ident):
    return next(a for a in layout['anchors'] if a['id'] == ident)


def isolate_stage():
    """Hide the stage-1 coordinate labels: they must not sit over the model."""
    for coll in bpy.data.collections:
        if coll.name.startswith('labels_') or coll.name.endswith('jp_bb_kiri_draft'):
            coll.hide_viewport = True
            coll.hide_render = True
            for o in coll.objects:
                o.hide_set(True)
                o.hide_render = True
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- hull


def hull_mesh(api, p, coll):
    verts, faces, decks = [], [], []
    n = len(p.levels)
    ring = 2 * n - 1
    stations = p.stations()
    for s in stations:
        half = [p.sample(s, *level) for level in p.levels]
        verts.extend(api['W'](*v) for v in half + [(-x, y, z) for x, y, z in reversed(half[1:])])
    for j in range(len(stations) - 1):
        for i in range(ring):
            k = (i + 1) % ring
            faces.append((j * ring + i, j * ring + k, (j + 1) * ring + k, (j + 1) * ring + i))
            if i == n - 1:
                decks.append(len(faces) - 1)
    faces.append(tuple(reversed(range(ring))))
    me = bpy.data.meshes.new('kirishima_indexed_shell')
    me.from_pydata(verts, [], faces)
    me.materials.append(solid('kirishima_shell', (0.44, 0.48, 0.52)))
    me.materials.append(solid('kirishima_deck', (0.13, 0.16, 0.19)))
    for f in me.polygons:
        f.use_smooth = True
    for i in decks:
        me.polygons[i].material_index = 1
        me.polygons[i].use_smooth = False
    me.polygons[-1].use_smooth = False
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    me.update()
    for e in me.edges:
        u, v = (me.vertices[i].co for i in e.vertices)
        if abs(u.x) < 1e-5 and abs(v.x) < 1e-5 and min(u.z, v.z) >= 0 and max(u.y, v.y) < -107.0:
            e.use_edge_sharp = True
    ob = bpy.data.objects.new('refhull_' + KEY, me)
    coll.objects.link(ob)
    ob['PREVIEW_ONLY'] = True
    ob['profile_source'] = 'kirishima_1942_profile.json'
    return ob


# ---------------------------------------------------------------- helpers


def rod(api, buf, a, b, r=0.035, col=STEEL, seg=4, closed=False):
    v, f = api['p_rod'](a, b, r, seg)
    if not closed:
        f = f[:seg * 2]
    buf.emit(v, f, col=col)


def outline(api, z, length, width, rf=0.5, rr=0.3):
    return [(x, zz + z) for x, zz in api['plan_poly'](length, width, rf, rr, 3)]


def frustum(api, buf, z, y0, y1, ln0, w0, ln1, w1, rf=0.5, col=STEEL):
    """One tapered level. Consecutive levels share a section, so the tower is continuous."""
    bottom = outline(api, z, ln0, w0, rf)
    top = outline(api, z, ln1, w1, rf)
    buf.emit(*api['p_prism'](bottom, top, y0, y1, True, False), col=col)
    return bottom, top


def windows(api, buf, plan, y, height=0.55):
    for u, v in zip(plan, plan[1:] + plan[:1]):
        dx, dz = v[0] - u[0], v[1] - u[1]
        length = math.hypot(dx, dz)
        if length < 0.5:
            continue
        nx, nz = -dz / length, dx / length
        count = max(1, int(length / 0.9))
        for i in range(count):
            t = (i + 0.5) / count
            x = u[0] + dx * t + nx * 0.02
            z = u[1] + dz * t + nz * 0.02
            buf.emit(*api['p_box_y'](x, y, z, 0.48, height, 0.03, math.atan2(-dz, dx)), col=DARK)


def rail(api, buf, plan, y, height=0.85, col=DARK):
    for u, v in zip(plan, plan[1:] + plan[:1]):
        if math.dist(u, v) < 0.05:
            continue
        for up in (0.45, height):
            rod(api, buf, (u[0], y + up, u[1]), (v[0], y + up, v[1]), 0.024, col, 3)
        rod(api, buf, (u[0], y, u[1]), (u[0], y + height, u[1]), 0.03, col, 3)


# ---------------------------------------------------------------- structures


def _legacy_bridge(api, buf, deck, layout, dz=0.0):
    """Continuous pagoda tower. dz exists for the translation regression check:
    every child, including windows and platforms, must follow the anchor."""
    a = anchor(layout, 'BRIDGE_BASE')
    z = a['z'] + dz
    base = deck(z)
    levels = [(0, 5, 13.0, 12.0, 12.5, 11.6),
              (5, 9.5, 12.5, 11.6, 11.6, 10.8),
              (9.5, 14, 11.6, 10.8, 10.6, 9.8),
              (14, 18, 10.6, 9.8, 9.4, 8.6),
              (18, 21.5, 9.4, 8.6, 8.2, 7.4),
              (21.5, 25, 8.2, 7.4, 7.0, 6.4),
              (25, 28, 7.0, 6.4, 5.8, 5.2),
              (28, 30.5, 5.8, 5.2, 4.8, 4.4)]
    for i, (y0, y1, ln0, w0, ln1, w1) in enumerate(levels):
        bottom, top = frustum(api, buf, z, base + y0, base + y1, ln0, w0, ln1, w1)
        if i < 3:
            windows(api, buf, bottom, base + y0 + 1.4)
        # thin gallery decks with rails: the pagoda reads as stacked platforms
        # with open structure, not as one solid cone
        gallery = outline(api, z, ln1 + 0.35, w1 + 0.35, 0.35)
        buf.emit(*api['p_prism'](gallery, gallery, base + y1 - 0.10, base + y1 + 0.02, True, False), col=STEEL)
        if i in (1, 3, 5, 6):
            rail(api, buf, gallery, base + y1 + 0.02, 0.75)
        for sx in (-1, 1):
            rod(api, buf, (sx * (w1 / 2 + 0.6), base + y1 - 0.1, z + ln1 / 2 - 0.5),
                (sx * (w0 / 2 + 0.2), base + y0 + 0.6, z + ln0 / 2 - 0.5), 0.12, STEEL, 5)
    # corner posts run the whole height: one continuous tower, not stacked discs
    for sx in (-1, 1):
        for sz in (-1, 1):
            rod(api, buf, (sx * 5.9, base + 0.2, z + sz * 6.4), (sx * 2.3, base + 30.4, z + sz * 2.3),
                0.17, STEEL, 6)
    for sz in (-1, 1):
        rod(api, buf, (0, base + 0.2, z + sz * 6.5), (0, base + 30.4, z + sz * 2.4), 0.14, STEEL, 6)
    # bridge wings: a real deck with girders down into the tower side
    wing = outline(api, z - 0.5, 4.5, 16.5, 0.25, 0.25)
    buf.emit(*api['p_prism'](wing, wing, base + 14.0, base + 14.4, True, True), col=DECKPAINT)
    rail(api, buf, wing, base + 14.4, 0.85)
    for side in (-1, 1):
        for zz in (z - 2.0, z - 0.3, z + 1.4):
            rod(api, buf, (side * 4.6, base + 10.4, zz), (side * 7.6, base + 14.0, zz), 0.15, STEEL, 5)
            rod(api, buf, (side * 7.6, base + 14.0, zz), (side * 5.8, base + 16.2, zz), 0.12, STEEL, 5)
        buf.emit(*api['p_box'](side * 6.6, base + 14.4, z - 0.5, 3.0, 0.85, 0.16), col=STEEL)
        # searchlight platform on the front corners
        buf.emit(*api['p_cyl'](side * 4.2, base + 18.1, z + 4.6, 0.9, 0.9, 0.35, seg=10), col=STEEL)
        buf.emit(*api['p_cyl_z'](side * 4.2, base + 18.45, z + 4.9, 0.7, 0.5, 10), col=(0.85, 0.84, 0.72))
    # director platform and rangefinder
    top_plan = outline(api, z, 5.2, 5.0, 0.4, 0.4)
    buf.emit(*api['p_prism'](top_plan, top_plan, base + 30.5, base + 30.65, True, True), col=DECKPAINT)
    rail(api, buf, top_plan, base + 30.65, 0.7)
    # main director with a long-base rangefinder, then a light topmast
    buf.emit(*api['p_cyl'](0, base + 31.0, z, 0.5, 0.45, 0.75, seg=10), col=STEEL)
    buf.emit(*api['p_cyl_x'](0, base + 31.75, z + 0.2, 0.28, 8.6, 10), col=STEEL)
    for side in (-1, 1):
        buf.emit(*api['p_cyl'](side * 4.1, base + 31.55, z + 0.2, 0.22, 0.22, 0.2, seg=8), col=DARK)
        buf.emit(*api['p_box'](side * 2.4, base + 31.0, z - 1.6, 0.9, 0.55, 0.9), col=STEEL)
    rod(api, buf, (0, base + 32.0, z), (0, base + 36.5, z), 0.10, STEEL, 6)
    rod(api, buf, (-2.2, base + 34.0, z), (2.2, base + 34.0, z), 0.05, DARK, 4)

    # foremast: a real mast inside the tower, not a rod floating beside it
    m = anchor(layout, 'FOREMAST')
    mz = m['z'] + dz
    mast_base = deck(mz) + m['deckOffset']
    rod(api, buf, (0, mast_base, mz), (0, deck(mz) + 34.0, mz), 0.15, STEEL, 8)
    for side in (-1, 1):
        rod(api, buf, (side * 2.0, mast_base, mz - 1.6), (0, deck(mz) + 22.0, mz), 0.12, STEEL, 6)
    for f, w in ((0.35, 12.0), (0.62, 9.0), (0.85, 6.0)):
        rod(api, buf, (-w / 2, deck(mz) + 8 + 26 * f, mz), (w / 2, deck(mz) + 8 + 26 * f, mz), 0.07, DARK, 5)
    top = outline(api, mz, 1.6, 1.7, 0.6, 0.6)
    buf.emit(*api['p_prism'](top, top, deck(mz) + 28.0, deck(mz) + 28.7, True, True), col=STEEL)
    rail(api, buf, top, deck(mz) + 28.7, 0.5)
    return z


def build_funnels(api, buf, deck, layout):
    for ident, squash in (('FUNNEL_01', 0.86), ('FUNNEL_02', 0.92)):
        a = anchor(layout, ident)
        z, f = a['z'], a['footprint']
        y = deck(z)
        rake = math.radians(f['rakeDeg'])
        shift = -math.tan(rake) * f['h']
        buf.emit(*api['p_cyl'](0, y, z, f['r'], f['r'] * 0.94, f['h'], seg=20, squash=squash, rake=rake), col=STEEL)
        buf.emit(*api['p_cyl'](0, y + f['h'] - 0.5, z + shift, f['r'] * 0.97, f['r'] * 0.93, 0.55,
                               seg=20, squash=squash), col=DARK)
        outer = [(math.cos(i * math.tau / 20) * f['r'] * 1.03 * squash, y + f['h'],
                  z + shift + math.sin(i * math.tau / 20) * f['r'] * 1.03) for i in range(20)]
        inner = [(x * 0.84, yy, zz + (z + shift - zz) * 0.16) for x, yy, zz in outer]
        verts = [api['W'](*v) for v in outer + inner]
        faces = []
        for i in range(20):
            j = (i + 1) % 20
            faces.extend(((i, j, 20 + j), (i, 20 + j, 20 + i)))
        buf.emit(verts, faces, col=DARK)
        buf.emit(*api['p_cyl'](0, y + f['h'] - 0.46, z + shift, f['r'] * 0.85, f['r'] * 0.85, 0.02,
                               seg=20, squash=squash, cap=False), col=DARK)
        for side in (-1, 1):
            rod(api, buf, (side * f['r'] * squash * 0.9, y, z - 0.3),
                (side * f['r'] * squash * 0.9, y + f['h'] * 0.9, z + shift - 0.3), 0.06, DARK, 5)


def build_mid(api, buf, deck, layout, spec):
    a = anchor(layout, 'MID_DECKHOUSE')
    z, f = a['z'], a['footprint']
    y = deck(z)
    bottom = outline(api, z, f['len'], f['w'], 0.2, 0.2)
    top = outline(api, z, f['len'] - 1.2, f['w'] - 1.0, 0.2, 0.2)
    buf.emit(*api['p_prism'](bottom, top, y, y + f['h'], True, False), col=STEEL)
    buf.emit(*api['p_prism'](top, top, y + f['h'], y + f['h'] + 0.12, True, False), col=DECKPAINT)
    windows(api, buf, bottom, y + f['h'] * 0.45, 0.5)
    # AA is built once by the supported station schedule, not as disconnected
    # proxies at the former (higher) deckhouse elevations.
    # a few ventilators, plus two lower boxes so the middle is not one long slab
    for i in range(3):
        zz = z - f['len'] * 0.3 + (i / 2) * f['len'] * 0.6
        buf.emit(*api['p_cyl'](0, y + f['h'], zz, 0.42, 0.5, 1.1, seg=8), col=(0.66, 0.68, 0.71))
        buf.emit(*api['p_cyl'](0, y + f['h'] + 1.1, zz, 0.55, 0.42, 0.3, seg=8), col=DARK)
    for zz in (z + f['len'] * 0.42, z - f['len'] * 0.42):
        box = outline(api, zz, 5.0, f['w'] * 0.72, 0.3, 0.3)
        buf.emit(*api['p_prism'](box, box, y, y + f['h'] + 1.2, True, True), col=STEEL)
        windows(api, buf, box, y + 0.9, 0.45)


def _legacy_aft(api, buf, deck, layout):
    a = anchor(layout, 'AFT_CONTROL_BASE')
    z, f = a['z'], a['footprint']
    base = deck(z)
    # The aft structure is a low control position, not a second pagoda: keep it
    # well below the bridge and let the mainmast carry the height.
    levels = [(0, 4, f['len'], f['w'], 13.0, 11.5),
              (4, 8, 13.0, 11.5, 11.5, 10.2),
              (8, 12, 11.5, 10.2, 9.5, 8.4),
              (12, 15.5, 9.5, 8.4, 7.5, 6.8),
              (15.5, 18, 7.5, 6.8, 5.5, 5.0)]
    for i, (y0, y1, ln0, w0, ln1, w1) in enumerate(levels):
        bottom, _ = frustum(api, buf, z, base + y0, base + y1, ln0, w0, ln1, w1, 0.4)
        if i < 2:
            windows(api, buf, bottom, base + y0 + 1.3)
        if i in (1, 3):
            gallery = outline(api, z, ln1 + 0.35, w1 + 0.35, 0.35)
            buf.emit(*api['p_prism'](gallery, gallery, base + y1 - 0.08, base + y1 + 0.02, True, False), col=STEEL)
    top = outline(api, z, 6.0, 5.6, 0.35, 0.35)
    buf.emit(*api['p_prism'](top, top, base + 18, base + 18.2, True, True), col=DECKPAINT)
    rail(api, buf, top, base + 18.2, 0.8)

    m = anchor(layout, 'MAINMAST')
    mz = m['z']
    mast_base = deck(mz) + m['deckOffset']
    rod(api, buf, (0, mast_base, mz), (0, deck(mz) + 30.0, mz), 0.15, STEEL, 8)
    for side in (-1, 1):
        rod(api, buf, (side * 1.8, mast_base, mz - 1.5), (0, deck(mz) + 18.0, mz), 0.11, STEEL, 6)
    for f_, w in ((0.35, 13.0), (0.62, 9.5), (0.85, 6.0)):
        rod(api, buf, (-w / 2, deck(mz) + 6 + 22 * f_, mz), (w / 2, deck(mz) + 6 + 22 * f_, mz), 0.07, DARK, 5)
    topmast = outline(api, mz, 1.5, 1.6, 0.6, 0.6)
    buf.emit(*api['p_prism'](topmast, topmast, deck(mz) + 24.0, deck(mz) + 24.7, True, True), col=STEEL)
    rail(api, buf, topmast, deck(mz) + 24.7, 0.5)


def _legacy_casemates(api, buf, deck, p, spec):
    """Recessed openings around the existing simulation casemate mounts."""
    for t in spec['tur']:
        if not t.get('sec'):
            continue
        z = t['z']
        half = p.sample(z / spec['L'] + 0.5, 'upper', 1)[0]
        y = deck(z) + t['y']
        for sx in (1, -1):
            # A casemate is a recess in the side, not a gun bolted to the plating.
            inner = sx * max(0.0, half - 2.2)
            # a recessed chamber with a hood above, a sill below and side jambs,
            # so the gun reads as sitting inside the ship's side
            buf.emit(*api['p_box'](inner, y - 1.6, z, 2.0, 3.2, 3.6), col=DARK)
            buf.emit(*api['p_box'](sx * (half - 3.2), y - 1.6, z, 0.12, 3.2, 3.6), col=STEEL)
            buf.emit(*api['p_box'](sx * (half - 0.55), y + 1.55, z, 1.1, 0.22, 3.8), col=STEEL)
            buf.emit(*api['p_box'](sx * (half - 0.55), y - 1.75, z, 1.1, 0.22, 3.8), col=STEEL)
            for dz in (-1.75, 1.75):
                buf.emit(*api['p_box'](sx * (half - 0.55), y - 1.6, z + dz, 1.0, 3.2, 0.2), col=STEEL)


def build_deck_fittings(api, buf, deck, layout, p, spec):
    """Visual-only equipment: no simulation weapon is added by any of this."""
    # AA gunhouses and foundations are emitted by build_supported_aa below.
    # boats in chocks on the deckhouse roof, with real davit frames
    for z in (14.0, 4.0):
        for sx in (-1, 1):
            x = sx * 4.9
            y = deck(z) + 2.75
            boat = outline(api, z, 8.0, 2.3, 0.9, 0.7)
            buf.emit(*api['p_prism'](boat, boat, y, y + 1.35, True, True), col=(0.62, 0.60, 0.55))
            for dz in (-2.6, 2.6):
                rod(api, buf, (x, y + 1.3, z + dz), (x, y + 3.6, z + dz), 0.10, DARK, 5)
                rod(api, buf, (x, y + 3.6, z + dz), (x + sx * 0.9, y + 3.9, z + dz), 0.08, DARK, 4)
    # quarterdeck aviation: a catapult and two floatplanes, visual interpretation
    y = deck(-80.0)
    buf.emit(*api['p_box'](0, y + 0.35, -80.0, 2.2, 0.7, 17.0), col=STEEL)
    buf.emit(*api['p_cyl'](0, y, -80.0, 1.0, 1.0, 0.35, seg=10), col=DARK)
    for z, x in ((-88.0, -3.6), (-92.5, 3.6)):
        yy = deck(z)
        buf.emit(*api['p_cyl_z'](x, yy + 0.9, z, 0.75, 5.2, 10), col=(0.66, 0.68, 0.70))
        for sx in (-1, 1):
            buf.emit(*api['p_box'](x + sx * 2.6, yy + 1.25, z - 0.4, 4.6, 0.12, 0.9), col=(0.70, 0.72, 0.74))
            rod(api, buf, (x, yy + 0.5, z), (x + sx * 2.6, yy + 1.25, z - 0.4), 0.09, DARK, 4)
        rod(api, buf, (x, yy + 0.9, z - 2.6), (x, yy + 2.4, z - 2.6), 0.08, DARK, 4)
    # The derrick is part of the refined aft working structure, not a second
    # isolated post on the extreme quarterdeck.


def build_barbettes(api, buf, deck, spec):
    """Fixed structure under the raised turrets so no gun ring floats."""
    for t in spec['tur']:
        if t.get('sec'):
            continue
        shape = api['TS'][t['kind']]
        deck_y = deck(t['z'])
        mount = deck_y + t['y']
        r = shape['w'] * 0.44
        if t['y'] > 0.1:
            # Tapered barbette: wide where it meets the deck, so it reads as
            # structure rising out of the ship instead of a column underneath.
            buf.emit(*api['p_cyl'](t['x'], deck_y - 0.9, t['z'], r * 1.22, r, t['y'] + 0.9, seg=24), col=STEEL)
        buf.emit(*api['p_cyl'](t['x'], deck_y - 0.15, t['z'], r * 1.26, r * 1.18, 0.35, seg=24), col=STEEL)
        buf.emit(*api['p_cyl'](t['x'], mount - 0.45, t['z'], r * 1.03, r * 1.03, 0.22, seg=24),
                 col=(0.54, 0.58, 0.62))


def build_rails(api, buf, p, spec):
    module={};path=ROOT/'game_railings.py'
    exec(compile(path.read_text(encoding='utf-8'),str(path),'exec'),module)
    return module['add_deck_railings'](api,buf,lambda s:p.sample(s,'upper',1),spec['L'])


# ---------------------------------------------------------------- build


def build_bridge(api,buf,deck,layout,dz=0):
    return refined_island('bridge',api,buf,deck,layout,dz)


def build_aft(api,buf,deck,layout):
    return refined_island('aft',api,buf,deck,layout)


def build_casemates(api,buf,deck,p,spec):
    return game_export_module()['build_port_frames'](api,buf,p,spec)


def build_kirishima():
    api = load_api()
    layout = json.loads(LAYOUT_PATH.read_text(encoding='utf-8'))
    spec = api['SHIPS']['jp_bb']
    original = json.dumps(spec, sort_keys=True)
    p = KirishimaProfile()
    deck = lambda z: p.deck(z / spec['L'] + 0.5)

    ship = api['coll_named']('ship_' + KEY)
    ref = api['coll_named']('ref_' + KEY)
    preview = api['coll_named']('preview_' + KEY)
    hull = hull_mesh(api, p, ref)
    game_export_module()['carve_casemates'](api,hull,p,spec)

    groups = {}
    for name in ('bridge', 'funnels', 'mid', 'aft', 'fittings',
                 'central_mast','aa_supports','aa_guns','rails'):
        groups[name] = api['Buf']()

    build_bridge(api, groups['bridge'], deck, layout)
    build_funnels(api, groups['funnels'], deck, layout)
    build_mid(api, groups['mid'], deck, layout, spec)
    build_aft(api, groups['aft'], deck, layout)
    refined_island('central_mast',api,groups['central_mast'],deck,layout)
    island_module()['build_supported_aa'](api,groups['aa_supports'],groups['aa_guns'],deck,layout,spec)
    build_deck_fittings(api, groups['fittings'], deck, layout, p, spec)
    build_casemates(api, groups['fittings'], deck, p, spec)
    build_barbettes(api, groups['fittings'], deck, spec)
    build_rails(api, groups['rails'], p, spec)

    objects = {}
    for name, buf in groups.items():
        ob = api['make_obj']('super_' + KEY + '_' + name, buf, coll=ship)
        ob.data.materials[0] = detail_material('kirishima_detail_' + name)
        ob['PREVIEW_ONLY'] = True
        ob['anchor_source'] = 'kirishima_1942_layout.json'
        if hasattr(buf,'aa_stations'):ob['aa_stations']=json.dumps(buf.aa_stations)
        if hasattr(buf,'mast_anchor'):ob['mast_anchor']=json.dumps(buf.mast_anchor)
        if hasattr(buf,'rail_stats'):ob['railStats']=json.dumps(buf.rail_stats)
        if name=='rails':
            for f in ob.data.polygons:f.use_smooth=True
        if name in ('funnels','aa_supports'):
            # The twenty shared vertices around each casing already support
            # smooth side normals. Leave horizontal caps and plates flat.
            for f in ob.data.polygons:
                if abs(f.normal.z)<.25:f.use_smooth=True
        objects[name] = ob

    api['preview_turrets']('jp_bb', collection_name='preview_' + KEY)
    api['show_ship'](KEY)
    isolate_stage()
    bpy.context.view_layer.update()
    assert json.dumps(spec, sort_keys=True) == original, 'simulation snapshot mutated'
    report = validate_kirishima()
    hull['kirishima_report'] = json.dumps(report)
    for name in ('kirishima_1942_build.py', 'kirishima_1942_profile.py', 'kirishima_1942_profile.json',
                 'kirishima_1942_layout.py', 'kirishima_1942_layout.json', 'KIRISHIMA_1942_PLAN.md',
                 'kirishima_island_refined.py','jp_refined_guns.py',
                 'KIRISHIMA_OPTICS_AND_ISLAND.md','warship_build.py',
                 'kirishima_upperworks_layout.json','KIRISHIMA_ROBUST_UPPERWORKS.md',
                 'kirishima_game_export.py','KIRISHIMA_GAME_INTEGRATION.md'):
        path = ROOT / name
        if path.exists():
            text = bpy.data.texts.get(name) or bpy.data.texts.new(name)
            text.clear()
            text.write(path.read_text(encoding='utf-8'))
    print('Kirishima blockout built')
    return hull, objects, report


def _bow_extent(verts):
    ys = [v[1] for v in verts]
    return min(ys), max(ys)


def validate_kirishima():
    api = load_api()
    layout = json.loads(LAYOUT_PATH.read_text(encoding='utf-8'))
    spec = api['SHIPS']['jp_bb']
    p = KirishimaProfile()
    deck = lambda z: p.deck(z / spec['L'] + 0.5)
    hull = bpy.data.objects['refhull_' + KEY]
    problems, notes = [], []

    bm = bmesh.new()
    bm.from_mesh(hull.data)
    if any(not e.is_manifold for e in bm.edges):
        problems.append('hull is not closed')
    if any(f.calc_area() < 1e-9 for f in bm.faces):
        problems.append('degenerate hull faces')
    if bm.calc_volume(signed=True) <= 0:
        problems.append('hull normals point inward')
    bm.free()
    game_export_module()['validate_port_recesses'](hull)

    verts = [v.co for v in hull.data.vertices]
    if abs(max(v.x for v in verts) - min(v.x for v in verts) - spec['B']) > 1e-4:
        problems.append('hull beam is not %s m' % spec['B'])
    if abs(max(v.y for v in verts) - min(v.y for v in verts) - spec['L']) > 1e-4:
        problems.append('hull length is not %s m' % spec['L'])

    # translation regression: moving the bridge anchor must move every child
    a = api['Buf']()
    b = api['Buf']()
    build_bridge(api, a, deck, layout, 0.0)
    build_bridge(api, b, deck, layout, 10.0)
    ext_a, ext_b = _bow_extent(a.v), _bow_extent(b.v)
    # Blender Y is -bow, so a +10 m bow shift moves the extent by -10
    if abs((ext_b[0] - ext_a[0]) + 10) > 1e-6 or abs((ext_b[1] - ext_a[1]) + 10) > 1e-6:
        problems.append('bridge children do not follow the anchor: %s -> %s' % (ext_a, ext_b))
    if len(a.v)!=len(b.v) or any(abs(vb[0]-va[0])>1e-6 or abs(vb[1]-va[1]+10)>1e-6
                                 or abs(vb[2]-va[2])>1e-6 for va,vb in zip(a.v,b.v)):
        problems.append('some bridge vertices failed the exact parent translation')
    notes.append('bridge anchor +10 m moved all bridge geometry by 10.00 m')
    for ob in bpy.data.collections['ship_'+KEY].objects:
        if ob.type!='MESH':continue
        mat=ob.data.materials[0]
        shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        if not shader.inputs['Base Color'].is_linked:
            problems.append('detail colours disconnected: '+ob.name)
    island_module()['validate_supported_aa'](api,deck,p,KEY)
    import hashlib
    source_guns=list(bpy.data.collections['gun_jp14d'].objects)
    current_gun=hashlib.sha256(json.dumps([(o.get('export_role'),[tuple(v.co) for v in o.data.vertices],
                    [tuple(f.vertices) for f in o.data.polygons]) for o in source_guns],sort_keys=True).encode()).hexdigest()
    expected=bpy.app.driver_namespace.get('accepted_main_gun_digest',
                        bpy.context.scene.get('accepted_main_gun_digest'))
    if expected:
        if current_gun!=expected:problems.append('accepted main gun geometry changed')
        bpy.context.scene['accepted_main_gun_digest']=expected
    gun_path=ROOT.parent.parent/'public/models/guns/jp14d.glb'
    expected_glb=bpy.app.driver_namespace.get('accepted_main_gun_glb',
                        bpy.context.scene.get('accepted_main_gun_glb'))
    if expected_glb:
        if hashlib.sha256(gun_path.read_bytes()).hexdigest()!=expected_glb:
            problems.append('accepted main gun GLB changed')
        bpy.context.scene['accepted_main_gun_glb']=expected_glb
    notes.append('approved main-gun source mesh and GLB hashes unchanged')

    for ident in ('BRIDGE_BASE', 'MID_DECKHOUSE', 'AFT_CONTROL_BASE'):
        anc = anchor(layout, ident)
        half = p.sample(anc['z'] / spec['L'] + 0.5, 'upper', 1)[0]
        margin = half - anc['footprint']['w'] / 2
        if margin < 0:
            problems.append('%s is wider than the hull' % ident)
        notes.append('%s clears the deck edge by %.2f m' % (ident, margin))

    t = api['TS']['jp14d']
    for raised, below in (('MAIN_02', 'MAIN_01'), ('MAIN_03', 'MAIN_04')):
        x = anchor(layout, raised)
        y = anchor(layout, below)
        clearance = (deck(x['z']) + x['deckOffset'] + t['h'] * 0.5) - (deck(y['z']) + y['deckOffset'] + t['h'])
        if clearance < 0.3:
            problems.append('%s does not clear %s' % (raised, below))
        notes.append('%s barrel centreline clears %s roof by %.2f m' % (raised, below, clearance))
    # Traversal limits are handled by gameplay, as requested; not a modelling
    # blocker and not a reason to distort the island silhouette.

    from mathutils import Matrix, Vector
    worst = 0.0
    for i, mount in enumerate(spec['tur']):
        src = api['TS'][mount['kind']]
        expected = (Matrix.Translation(Vector(api['W'](mount['x'], deck(mount['z']) + mount['y'], mount['z'])))
                    @ Matrix.Rotation(mount['face'], 4, 'Z')
                    @ Vector(api['W'](0, src['h'] * 0.5, src['len'] * 0.18)))
        barrel = next(o for o in bpy.data.collections['preview_' + KEY].objects
                      if o.get('mount_index') == i and o.get('export_role') == 'barrel')
        worst = max(worst, (barrel.matrix_world.translation - expected).length)
    if worst > 0.05:
        problems.append('mount trunnions moved from the simulation deck by %.3f m' % worst)
    notes.append('all 12 mount trunnions within %.3f m of the simulation deck' % worst)

    counts = {}
    for prefix in ('ship_', 'ref_', 'preview_'):
        counts[prefix] = sum(len(f.vertices) - 2
                             for o in bpy.data.collections[prefix + KEY].objects if o.type == 'MESH'
                             for f in o.data.polygons)
    if counts['ref_'] > p.data['budgetHullDeck']:
        problems.append('hull over budget: %s' % counts['ref_'])
    if sum(counts.values()) > p.data['budgetWholePreview']:
        problems.append('whole ship over budget: %s' % sum(counts.values()))

    visible = [o.name for o in bpy.context.scene.objects
               if o.name.startswith('refhull_') and not o.hide_get() and not o.hide_render]
    if visible != [hull.name]:
        problems.append('more than one hull visible: %s' % visible)

    if problems:
        raise AssertionError('kirishima problems: %s' % problems)
    print('KIRISHIMA VALID: closed hull, actual %sx%sm, anchors followed, mounts unchanged'
          % (spec['L'], spec['B']))
    for n in notes:
        print('  note:', n)
    print('TRIANGLES', counts, 'TOTAL', sum(counts.values()))
    return {'notes': notes, 'triangles': counts}


def review_kirishima():
    api = load_api()
    api['show_ship'](KEY)
    isolate_stage()
    api['SHOTDIR'] = str(ROOT / 'qa')
    obs = [o for prefix in ('ship_', 'ref_', 'preview_') for o in bpy.data.collections[prefix + KEY].objects]
    hull = bpy.data.objects['refhull_' + KEY]
    shots = [
        ('side', dict(yaw=90, pitch=0, ortho=True, res=(1600, 700))),
        ('top', dict(yaw=0, pitch=90, ortho=True, res=(1500, 700))),
        ('front', dict(yaw=0, pitch=0, ortho=True, res=(900, 1000))),
        ('qbow', dict(yaw=38, pitch=14, res=(1400, 850))),
        ('qstern', dict(yaw=-140, pitch=16, res=(1400, 850))),
        ('bridge', dict(yaw=42, pitch=12, focus=(0, 20, 40), span=60, res=(1200, 900))),
        ('midships', dict(yaw=48, pitch=18, focus=(0, 12, 8), span=60, res=(1200, 900))),
        ('aft', dict(yaw=-48, pitch=18, focus=(0, 14, -22), span=60, res=(1200, 900))),
    ]
    out = [api['render_shot']('kirishima_' + tag, obs, **kw) for tag, kw in shots]
    out.append(api['render_shot']('kirishima_bottom', [hull], yaw=36, pitch=-14,
                                  focus=(0, 0, 70), span=70, res=(1200, 750)))
    return out


def save_kirishima():
    validate_kirishima()
    path = ROOT / 'checkpoint_25_kirishima_game_ready.blend'
    assert not path.exists() or bpy.data.filepath == str(path), 'Refuse to overwrite another checkpoint'
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    print('Saved', path)
