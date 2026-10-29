"""Unmasked underbody inspection: identical cameras, plus unlit normal diagnostic."""
from pathlib import Path
import bpy

ROOT = Path(r'D:\warship-game\art\blender')


def review_bottom(tag='bottom_after', hull_name='refhull_us_bb_bow'):
    path = ROOT/'washington_bow_preview.py'
    ns = {'__file__':str(path)}
    exec(compile(path.read_text(encoding='utf-8'),str(path),'exec'),ns)
    a = ns['api']()
    a['SHOTDIR'] = str(ROOT/'qa')
    hull = bpy.data.objects[hull_name]
    cameras = [
        ('side',dict(yaw=90,pitch=0,ortho=True,focus=(0,0,84),span=75,res=(1280,750))),
        ('low',dict(yaw=36,pitch=-10,focus=(0,-2,85),span=68,res=(1280,800))),
        ('front',dict(yaw=0,pitch=-2,ortho=True,focus=(0,0,70),span=43,res=(1000,850))),
        ('underside',dict(yaw=25,pitch=-65,focus=(0,-3,75),span=90,res=(1100,900))),
    ]
    for label, kwargs in cameras:
        a['render_shot'](tag+'_'+label,[hull],**kwargs)
    # N -> 0.5 + 0.5*N, rendered with emission. No lighting or cast-shadow
    # contribution can be mistaken for a dent in these diagnostic images.
    mat = bpy.data.materials.get('bottom_normal_diagnostic') or bpy.data.materials.new('bottom_normal_diagnostic')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    geometry = nodes.new('ShaderNodeNewGeometry')
    mix = nodes.new('ShaderNodeMixRGB')
    mix.inputs[0].default_value = .5
    mix.inputs[1].default_value = (1,1,1,1)
    emission = nodes.new('ShaderNodeEmission')
    output = nodes.new('ShaderNodeOutputMaterial')
    links = mat.node_tree.links
    links.new(geometry.outputs['Normal'],mix.inputs[2])
    links.new(mix.outputs[0],emission.inputs['Color'])
    links.new(emission.outputs[0],output.inputs['Surface'])
    layer = bpy.context.view_layer
    old = layer.material_override
    try:
        layer.material_override = mat
        for label,kwargs in (cameras[1],cameras[2]):
            a['render_shot'](tag+'_normals_'+label,[hull],**kwargs)
    finally:
        layer.material_override = old
