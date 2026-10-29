"""Production export of both accepted destroyers; run in Blender background.

blender -b checkpoint_30_fletcher_guns_and_bridge.blend --python destroyer_game_export.py
Keeps approved checkpoints intact; saves integration as checkpoint 31.
"""
import bpy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parents[1] / 'public' / 'models'


def load(name):
    p = ROOT / name
    ns = {'__file__': str(p)}
    exec(compile(p.read_text(encoding='utf-8'), str(p), 'exec'), ns)
    return ns


def export_ship(ns, profile, game_key, material):
    a = ns['load_api']()
    key = ns['KEY']
    temp = a['coll_named']('export_destroyer_' + game_key)
    copies = []
    try:
        for source in bpy.data.collections['ship_' + key].objects:
            if source.type != 'MESH' or source.name.endswith('_rails'):
                continue
            obj = bpy.data.objects.new('island_' + game_key, source.data.copy())
            obj.matrix_world = source.matrix_world.copy()
            obj.data.materials.clear()
            obj.data.materials.append(material(game_key + '_production_colours'))
            if game_key == 'jp_dd':
                obj['embeddedPerimeterRails'] = True
                obj['railHeight'] = .82
            temp.objects.link(obj)
            copies.append(obj)
        a['export_collection'](temp, str(OUT / 'ships' / (game_key + '_super.glb')), extras=True)
        for obj in copies:
            temp.objects.unlink(obj)
        hull_source = bpy.data.objects['refhull_' + key]
        hull = bpy.data.objects.new('visual_hull', hull_source.data.copy())
        temp.objects.link(hull)
        copies.append(hull)
        rows = []
        for s in sorted(set(profile.stations() + [.55])):
            if s >= .55:
                half, y, z = profile.sample(s, 'lower', 1)
                rows.append([s, half, z])
        hull['waterlineStations'] = json.dumps(rows)
        hull['deckStations'] = json.dumps(profile.data['deck'])
        hull['visualShipKey'] = game_key
        hull['casemateCount'] = 0
        hull['approvedSource'] = 'checkpoint_30' if game_key == 'us_dd' else 'checkpoint_17'
        source = bpy.data.objects.get('super_' + key + '_rails')
        if source:
            rails = bpy.data.objects.new('visual_rails', source.data.copy())
            rails['physicalRailings'] = True
            rails['railStats'] = source.get('railStats', '{}')
            temp.objects.link(rails)
            copies.append(rails)
        a['export_collection'](temp, str(OUT / 'ships' / (game_key + '_hull.glb')), extras=True)
    finally:
        for obj in copies:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(temp)


def export_fletcher_gun(ns):
    a = ns['load_api']()
    temp = a['coll_named']('export_fletcher_single')
    originals = []
    copies = []
    try:
        t = a['TS']['us5s']
        for role in ('base', 'barrel'):
            occupied = bpy.data.objects.get(role)
            if occupied:
                originals.append((occupied, occupied.name))
                occupied.name = 'temporary_held_' + role
            source = next(o for o in bpy.data.collections['preview_' + ns['KEY']].objects
                          if o.get('mount_index') == 0 and o.get('export_role') == role)
            obj = bpy.data.objects.new(role, source.data.copy())
            obj.location = a['W'](0, t['h'] * .5, t['len'] * .18) if role == 'barrel' else (0, 0, 0)
            obj['export_role'] = role
            temp.objects.link(obj)
            copies.append(obj)
        a['export_collection'](temp, str(OUT / 'guns' / 'us5s.glb'), extras=True)
    finally:
        for obj in copies:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if not mesh.users:
                bpy.data.meshes.remove(mesh)
        for obj, name in originals:
            obj.name = name
        bpy.data.collections.remove(temp)


def main():
    fletcher = load('fletcher_refined.py')
    fletcher['build_fletcher']()
    export_ship(fletcher, fletcher['FletcherProfile'](), 'us_dd', fletcher['detail_material'])
    export_fletcher_gun(fletcher)
    fubuki = load('fubuki_refined.py')
    fubuki['build_fubuki']()
    export_ship(fubuki, fubuki['FubukiProfile'](), 'jp_dd', fletcher['detail_material'])
    fletcher['load_api']()['show_ship'](fletcher['KEY'])
    for c in bpy.data.collections:
        if c.name.startswith('labels_'):
            c.hide_render = True
            for o in c.objects:
                o.hide_set(True)
    target = ROOT / 'checkpoint_31_destroyers_game_integrated.blend'
    bpy.context.scene['destroyers_game_integrated'] = True
    if not target.exists():
        bpy.ops.wm.save_as_mainfile(filepath=str(target))
    else:
        print('Existing checkpoint preserved; production exports refreshed:', target)
    print('DESTROYERS EXPORTED: us_dd + jp_dd hull/super; us5s articulated gun;', target)


if __name__ == '__main__':
    main()
