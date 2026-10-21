"""Review-only battery arrangement. Never writes sim data or exports a registered ship."""
import copy
import json


def make_battery_preview(api):
    path=r'D:\warship-game\art\blender\washington_battery_draft.json'
    data=json.load(open(path))
    assert data['status']=='BLENDER_PREVIEW_ONLY_PENDING_USER_REVIEW'
    assert len(data['portMounts'])==5
    assert [e['tier'] for e in data['portMounts']]==['low','high','low','high','low']
    assert [e['simIndex'] for e in data['portMounts']]==[3,4,5,6,7]
    original=json.dumps(api['SHIPS']['us_bb']['tur'],sort_keys=True)
    spec=copy.deepcopy(api['SHIPS']['us_bb'])
    for entry in data['portMounts']:
        for side,extra in ((1,0),(-1,5)):
            index=entry['simIndex']+extra
            assert spec['tur'][index]['kind']=='us5d' and spec['tur'][index]['sec']
            spec['tur'][index].update(x=entry['x']*side,y=entry['y'],z=entry['z'],
                                      draft_id=entry['id'] if side==1 else entry['id'].replace('P','S'))
    for name in ('ship_us_bb_draft','ref_us_bb_draft'):
        api['coll_named'](name)
    buf=api['Buf']()
    namespace={}
    source=r'D:\warship-game\art\blender\washington_super.py'
    exec(compile(open(source).read(),source,'exec'),namespace)
    kit=dict(api,BATTERY_PREVIEW_DATA=data)
    audit=namespace['build_washington'](buf,spec,kit)
    steel=(.63,.68,.73);deckpaint=(.34,.39,.44)

    def emit(shape,col=steel,y0=None):
        buf.emit(*shape,col=col,y0=y0,span=4,lo=.78)

    for entry in data['portMounts']:
        for side in (-1,1):
            x,z=side*entry['x'],entry['z']
            deck=api['deck_y'](spec,z)
            mount=deck+entry['y']
            if entry['tier']=='low':
                # Stepped sponson intersects the central deckhouse inboard, never a floating disc.
                center=side*11.6
                plan=[(a+center,b+z) for a,b in api['plan_poly'](7.4,8.4,.30,.30,3)]
                emit(api['p_prism'](plan,plan,deck-.3,mount,True,True),y0=deck)
                emit(api['p_prism'](plan,plan,mount,mount+.04,True,False),deckpaint)
            else:
                # Upper bearing support overlaps the inboard house; visible underside has knees.
                emit(api['p_cyl'](x,deck+2.9,z,2.42,2.52,entry['y']-2.9,16),y0=deck+2.9)
                for dz in (-1.8,1.8):
                    emit(api['p_rod']((side*7.5,deck+2.7,z+dz),
                                      (side*10.8,mount-.20,z+dz),.14,5))
                emit(api['p_cyl'](x,mount-.16,z,2.65,2.65,.16,16),deckpaint)
            # The shared gun ring sits inside this fixed seat; it is not the foundation itself.
            emit(api['p_cyl'](x,mount-.40,z,1.8,1.8,.38,12),y0=mount-.4)
    # Keep the retained AA proxy mounts supported after narrowing the central casing.
    for z in (33,-26):
        deck=api['deck_y'](spec,z)
        for side in (-1,1):
            emit(api['p_cyl'](side*9.5,14.20,z,1.65,1.65,max(.2,deck+6-14.2),12),y0=14.2)
    c=api['bpy'].data.collections['ship_us_bb_draft']
    ob=api['make_obj']('super_us_bb_draft',buf,coll=c)
    ob['PREVIEW_ONLY']=True
    ob['review_status']=data['status']
    ob['draft_source']=path
    ob['source_profile']='Low-high-low-high-low; game-scale positions pending user review'
    triangles=sum(len(p.vertices)-2 for p in ob.data.polygons)
    assert triangles<=18000,('draft island exceeds iGPU budget',triangles)
    ob['triangle_budget']=18000
    ob['triangle_count']=triangles
    api['build_hull_ref']('us_bb',api['bpy'].data.collections['ref_us_bb_draft'])
    api['preview_turrets']('us_bb',spec['tur'],'preview_us_bb_draft')
    api['show_ship']('us_bb_draft')
    api['bpy'].context.view_layer.update()
    from mathutils import Vector,Matrix
    preview=api['bpy'].data.collections['preview_us_bb_draft']
    for index,t in enumerate(spec['tur']):
        source=api['TS'][t['kind']]
        expected=(Matrix.Translation(Vector(api['W'](t['x'],api['deck_y'](spec,t['z'])+t['y'],t['z'])))
                  @ Matrix.Rotation(t['face'],4,'Z')
                  @ Vector(api['W'](0,source['h']*.5,source['len']*.18)))
        barrel=next(o for o in preview.objects if o.get('mount_index')==index and o.get('export_role')=='barrel')
        assert (barrel.matrix_world.translation-expected).length<.001
    for entry in data['portMounts']:
        hull_half=spec['B']/2*api['half_w'](entry['z']/spec['L']+.5)
        assert entry['x']+api['TS']['us5d']['len']/2<hull_half,entry
    assert json.dumps(api['SHIPS']['us_bb']['tur'],sort_keys=True)==original
    print('PREVIEW ONLY: ten staggered mounts; no simulation or live layout exported')
    for entry in data['portMounts']:
        print(entry['id'],entry['tier'],'x=',entry['x'],'z=',entry['z'],
              'above deck=',entry['y'],'absolute height=',round(api['deck_y'](spec,entry['z'])+entry['y'],2))
    return spec,audit
