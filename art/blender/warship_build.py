# Warship model builder for the Blender MCP session.
#
# Everything is generated in HULL coordinates (x = beam, +x starboard/port as in sim/ships.ts,
# y = up from the waterline, z = toward the bow) and mapped to Blender with  W(x,y,z) = (x, -z, y),
# so the glTF exporter's Y-up conversion turns it back into the game's frame.
#
# Run in Blender:
#   exec(open(r"D:\warship-game\art\blender\warship_build.py").read())
#   build_ship('us_bb')

import bpy, bmesh, json, math, random, os

TAU = math.pi * 2
clamp = lambda v, a, b: a if v < a else (b if v > b else v)


def lerp(a, b, t):
    return a + (b - a) * t


def sstep(x):
    t = clamp(x, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def W(x, y, z):
    """hull (x beam, y up, z bow) -> blender (X, -Z_bow, Y_up)."""
    return (x, -z, y)


# ---------------------------------------------------------------- data

JSON_PATH = r"D:\warship-game\art\blender\ship_input.json"
D = json.load(open(JSON_PATH))
SHIPS = D['ships']
TS = D['turrets']


def deck_y(spec, z):
    s = clamp(z / spec['L'] + 0.5, 0.0, 1.0)
    sh = spec['sheer']
    for i in range(1, len(sh)):
        if s <= sh[i][0]:
            a, b = sh[i - 1], sh[i]
            t = (s - a[0]) / max(1e-6, b[0] - a[0])
            return spec['F'] * lerp(a[1], b[1], clamp(t, 0, 1))
    return spec['F'] * sh[-1][1]


def half_w(s):
    if s >= 0.58:
        u = clamp((s - 0.58) / 0.42, 0, 1)
        return max(0.018, math.pow(math.cos((u * math.pi) / 2), 0.8))
    if s < 0.16:
        u = clamp((0.16 - s) / 0.16, 0, 1)
        return max(0.42, math.pow(math.cos((u * math.pi) / 2), 0.55))
    return 1.0


def keel_d(spec, s):
    d = spec['D']
    if s > 0.86:
        return d * lerp(1, 0.15, sstep((s - 0.86) / 0.14))
    if s < 0.1:
        return d * lerp(0.3, 1, sstep(s / 0.1))
    return d


RING = 12


def hull_section(spec, s, top):
    p = lerp(lerp(3.4, 1.15, sstep((s - 0.7) / 0.27)), 2.2, sstep((0.14 - s) / 0.14))
    bottom = -keel_d(spec, s)
    hw = (spec['B'] / 2) * half_w(s)
    pts = []
    for i in range(RING):
        a = i / (RING - 1)
        y = lerp(bottom, top, a)
        w = hw * math.pow(a, 1 / p)
        w *= 1 - 0.05 * sstep((a - 0.88) / 0.12)
        if i == 0:
            w *= 0.35
        pts.append((max(0.05, w), y))
    return pts


def bow_rake(spec, s):
    if spec.get('stem') == 'clipper' and s > 0.9:
        return ((s - 0.9) / 0.1) * spec['B'] * 0.14
    return 0.0


# ---------------------------------------------------------------- colour

STEEL = (0.74, 0.78, 0.82)
DARK = (0.17, 0.19, 0.22)
WOOD = (0.44, 0.33, 0.23)
BARREL = (0.30, 0.32, 0.36)
BOAT = (0.78, 0.78, 0.75)
CAP = (0.13, 0.14, 0.16)
LIGHT = (0.86, 0.84, 0.72)


def s2l(c):
    out = []
    for v in c:
        v = clamp(v, 0.0, 1.0)
        out.append(v / 12.92 if v < 0.04045 else math.pow((v + 0.055) / 1.055, 2.4))
    return tuple(out)


def get_mat():
    name = 'ws_super'
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    colors = next((n for n in m.node_tree.nodes if n.type == 'VERTEX_COLOR'), None)
    if colors is None:
        colors = m.node_tree.nodes.new('ShaderNodeVertexColor')
    colors.layer_name = 'Col'
    m.node_tree.links.new(colors.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.72
    bsdf.inputs['Metallic'].default_value = 0.12
    return m


def get_mat_ref():
    name = 'ws_ref'
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (0.26, 0.30, 0.34, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.8
    bsdf.inputs['Metallic'].default_value = 0.05
    return m


# ---------------------------------------------------------------- mesh buffer


class Buf:
    """Vertex/face/colour accumulator. Colours are sRGB triples."""

    def __init__(self):
        self.v = []
        self.f = []
        self.c = []

    def emit(self, verts, faces, col, y0=None, span=4.0, lo=0.60):
        base = len(self.v)
        self.v.extend(verts)
        for f in faces:
            self.f.append(tuple(base + i for i in f))
        for p in verts:
            k = 1.0 if y0 is None else (lo + (1 - lo) * clamp((p[2] - y0) / span, 0, 1))
            self.c.append((col[0] * k, col[1] * k, col[2] * k))
        return self

    def tri(self, a, b, c, col):
        """a,b,c are hull triples."""
        base = len(self.v)
        self.v.append(W(*a))
        self.v.append(W(*b))
        self.v.append(W(*c))
        self.f.append((base, base + 1, base + 2))
        for _ in range(3):
            self.c.append(col)
        return self


# ---------------------------------------------------------------- primitives (hull coords)


def p_box(x, y0, z, w, h, d):
    x0, x1 = x - w / 2, x + w / 2
    z0, z1 = z - d / 2, z + d / 2
    y1 = y0 + h
    V = [W(x0, y0, z0), W(x1, y0, z0), W(x1, y0, z1), W(x0, y0, z1),
         W(x0, y1, z0), W(x1, y1, z0), W(x1, y1, z1), W(x0, y1, z1)]
    F = [(0, 1, 2), (0, 2, 3),
         (4, 6, 5), (4, 7, 6),
         (0, 4, 5), (0, 5, 1),
         (1, 5, 6), (1, 6, 2),
         (2, 6, 7), (2, 7, 3),
         (3, 7, 4), (3, 4, 0)]
    return V, F


def plan_poly(length, width, rf=0.0, rr=0.0, seg=4):
    """Rounded rectangle in hull (x, z), bow = +z. Same shape as the game's planPoly."""
    hw, hl = width / 2, length / 2
    f = min(hl, abs(rf) * hw)
    r = min(hl, abs(rr) * hw)
    pts = []

    def arc(cx, cz, rad, a0, a1):
        if rad < 0.02:
            return
        for i in range(seg + 1):
            a = a0 + (a1 - a0) * (i / seg)
            pts.append((cx + math.cos(a) * rad, cz + math.sin(a) * rad))

    pts.append((-(hw - f), hl))
    pts.append((hw - f, hl))
    arc(hw - f, hl - f, f, math.pi / 2, 0)
    pts.append((hw, hl - f))
    pts.append((hw, -(hl - r)))
    arc(hw - r, -(hl - r), r, 0, -math.pi / 2)
    pts.append((hw - r, -hl))
    pts.append((-(hw - r), -hl))
    arc(-(hw - r), -(hl - r), r, -math.pi / 2, -math.pi)
    pts.append((-hw, -(hl - r)))
    pts.append((-hw, hl - f))
    arc(-(hw - f), hl - f, f, math.pi, math.pi / 2)
    return pts


def scale_plan(plan, fx, fz, dz=0.0):
    return [(x * fx, z * fz + dz) for (x, z) in plan]


def outset(plan, d):
    """Offset a closed plan outline outward by d metres."""
    n = len(plan)
    cx = sum(p[0] for p in plan) / n
    cz = sum(p[1] for p in plan) / n
    out = []
    for (x, z) in plan:
        vx, vz = x - cx, z - cz
        L = math.hypot(vx, vz) or 1.0
        out.append((x + vx / L * d, z + vz / L * d))
    return out


def p_prism(pb, pt, y0, y1, cap_top=True, cap_bot=False):
    n = min(len(pb), len(pt))
    V = []
    F = []
    for (x, z) in pb[:n]:
        V.append(W(x, y0, z))
    for (x, z) in pt[:n]:
        V.append(W(x, y1, z))
    for i in range(n):
        j = (i + 1) % n
        F.append((i, j, n + j))
        F.append((i, n + j, n + i))
    if cap_top:
        cx = sum(p[0] for p in pt[:n]) / n
        cz = sum(p[1] for p in pt[:n]) / n
        V.append(W(cx, y1, cz))
        c = len(V) - 1
        for i in range(n):
            j = (i + 1) % n
            F.append((n + i, n + j, c))
    if cap_bot:
        cx = sum(p[0] for p in pb[:n]) / n
        cz = sum(p[1] for p in pb[:n]) / n
        V.append(W(cx, y0, cz))
        c = len(V) - 1
        for i in range(n):
            j = (i + 1) % n
            F.append((i, c, j))
    return V, F


def p_cyl(x, y0, z, rb, rt, h, seg=12, cap=True, squash=1.0, rake=0.0, cap_bot=True):
    """Vertical cylinder (hull y axis). rake tilts the top toward the stern."""
    tz = -math.tan(rake) * h
    V = []
    F = []
    for i in range(seg):
        a = TAU * i / seg
        V.append(W(x + math.cos(a) * rb * squash, y0, z + math.sin(a) * rb))
    for i in range(seg):
        a = TAU * i / seg
        V.append(W(x + math.cos(a) * rt * squash + 0, y0 + h, z + math.sin(a) * rt + tz))
    for i in range(seg):
        j = (i + 1) % seg
        F.append((i, seg + j, j))
        F.append((i, seg + i, seg + j))
    if cap:
        V.append(W(x, y0 + h, z + tz))
        c = len(V) - 1
        for i in range(seg):
            j = (i + 1) % seg
            F.append((seg + i, c, seg + j))
    if cap_bot:
        V.append(W(x, y0, z))
        c = len(V) - 1
        for i in range(seg):
            j = (i + 1) % seg
            F.append((i, j, c))
    return V, F


def p_rod(a, b, r, seg=6, rb=None):
    """Rod between two hull points."""
    rb = r if rb is None else rb
    A = tuple(a)
    B = tuple(b)
    d = (B[0] - A[0], B[1] - A[1], B[2] - A[2])
    L = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
    if L < 1e-6:
        return [], []
    u = (d[0] / L, d[1] / L, d[2] / L)
    up = (0.0, 1.0, 0.0) if abs(u[1]) < 0.95 else (1.0, 0.0, 0.0)
    # e1 = u x up
    e1 = (u[1] * up[2] - u[2] * up[1], u[2] * up[0] - u[0] * up[2], u[0] * up[1] - u[1] * up[0])
    n1 = math.sqrt(sum(c * c for c in e1)) or 1.0
    e1 = (e1[0] / n1, e1[1] / n1, e1[2] / n1)
    e2 = (u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0])
    V = []
    F = []
    for i in range(seg):
        a = TAU * i / seg
        ca, sa = math.cos(a), math.sin(a)
        V.append(W(A[0] + (e1[0] * ca + e2[0] * sa) * r, A[1] + (e1[1] * ca + e2[1] * sa) * r,
                   A[2] + (e1[2] * ca + e2[2] * sa) * r))
    for i in range(seg):
        a = TAU * i / seg
        ca, sa = math.cos(a), math.sin(a)
        V.append(W(B[0] + (e1[0] * ca + e2[0] * sa) * rb, B[1] + (e1[1] * ca + e2[1] * sa) * rb,
                   B[2] + (e1[2] * ca + e2[2] * sa) * rb))
    for i in range(seg):
        j = (i + 1) % seg
        F.append((i, j, seg + j))
        F.append((i, seg + j, seg + i))
    V.append(W(B[0], B[1], B[2]))
    c = len(V) - 1
    for i in range(seg):
        j = (i + 1) % seg
        F.append((seg + i, seg + j, c))
    V.append(W(A[0], A[1], A[2]))
    c = len(V) - 1
    for i in range(seg):
        j = (i + 1) % seg
        F.append((i, c, j))
    return V, F


def p_lathe_z(cx, cy, cz, prof, seg=10, cap_bot=True):
    """Lathe about the hull z axis (bow direction). prof = [(radius, dist), ...]."""
    V = []
    F = []
    n = len(prof)
    for (r, s) in prof:
        for i in range(seg):
            a = TAU * i / seg
            V.append(W(cx + math.cos(a) * r, cy + math.sin(a) * r, cz + s))
    for k in range(n - 1):
        for i in range(seg):
            j = (i + 1) % seg
            a = k * seg + i
            b = k * seg + j
            c = (k + 1) * seg + j
            d = (k + 1) * seg + i
            F.append((a, b, c))
            F.append((a, c, d))
    if cap_bot and prof[0][0] > 0.02:
        V.append(W(cx, cy, cz + prof[0][1]))
        c = len(V) - 1
        for i in range(seg):
            j = (i + 1) % seg
            F.append((i, c, j))
    if prof[-1][0] > 0.02:
        V.append(W(cx, cy, cz + prof[-1][1]))
        c = len(V) - 1
        base = (n - 1) * seg
        for i in range(seg):
            j = (i + 1) % seg
            F.append((base + i, base + j, c))
    return V, F


def p_box_y(x, y0, z, w, h, d, ry=0.0):
    """Box rotated about the hull vertical axis (ry radians, +ve = bow toward +x)."""
    ca, sa = math.cos(ry), math.sin(ry)

    def rot(px, pz):
        return (x + px * ca + pz * sa, z - px * sa + pz * ca)

    pts = [rot(-w / 2, -d / 2), rot(w / 2, -d / 2), rot(w / 2, d / 2), rot(-w / 2, d / 2)]
    V = [W(px, y0, pz) for (px, pz) in pts] + [W(px, y0 + h, pz) for (px, pz) in pts]
    F = [(0, 1, 2), (0, 2, 3),
         (4, 6, 5), (4, 7, 6),
         (0, 4, 5), (0, 5, 1),
         (1, 5, 6), (1, 6, 2),
         (2, 6, 7), (2, 7, 3),
         (3, 7, 4), (3, 4, 0)]
    return V, F


def p_cyl_x(x, y, z, r, ln, seg=8):
    """Cylinder along the beam (hull x)."""
    a = (x - ln / 2, y, z)
    b = (x + ln / 2, y, z)
    return p_rod(a, b, r, seg)


def p_cyl_z(x, y, z, r, ln, seg=8):
    """Cylinder along the bow axis."""
    a = (x, y, z - ln / 2)
    b = (x, y, z + ln / 2)
    return p_rod(a, b, r, seg)


# ---------------------------------------------------------------- object creation


def coll_named(name, parent=None, clear=True):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    if clear:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    return c


def make_obj(name, buf, origin=(0.0, 0.0, 0.0), mat=None, coll=None):
    """origin is a hull triple; geometry is stored relative to it."""
    if not buf.v:
        return None
    ox, oy, oz = origin
    verts = [(v[0] - ox, v[1] + oz, v[2] - oy) for v in buf.v]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], buf.f)
    me.update()
    me.validate(verbose=False)
    attr = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    cols = [s2l(c) for c in buf.c]
    for i, loop in enumerate(me.loops):
        c = cols[loop.vertex_index]
        attr.data[i].color = (c[0], c[1], c[2], 1.0)
    ob = bpy.data.objects.new(name, me)
    ob.location = (ox, -oz, oy)
    me.materials.append(mat or get_mat())
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def shade(lo=0.62, span=4.0):
    return (lo, span)


# ---------------------------------------------------------------- fittings


RAIL = (0.38, 0.41, 0.45)


def add_rail(buf, x, y, z, w, d, h=1.0, col=RAIL, thick=0.06):
    """Railing: two horizontal rails plus stanchions, round a rectangular platform."""
    t = thick
    for (yy, tt) in ((y + h, t), (y + h * 0.55, t * 0.8)):
        buf.emit(*p_box(x, yy, z + d / 2 - t / 2, w, tt, t), col=col, y0=None)
        buf.emit(*p_box(x, yy, z - d / 2 + t / 2, w, tt, t), col=col, y0=None)
        buf.emit(*p_box(x + w / 2 - t / 2, yy, z, t, tt, d), col=col, y0=None)
        buf.emit(*p_box(x - w / 2 + t / 2, yy, z, t, tt, d), col=col, y0=None)
    n = max(2, min(14, int(d / 2.6)))
    for i in range(n + 1):
        pz = z - d / 2 + (i / n) * d
        for sx in (-1, 1):
            buf.emit(*p_box(x + sx * (w / 2 - t / 2), y, pz, t, h, t), col=col, y0=None)
    m = max(2, min(10, int(w / 2.6)))
    for i in range(m + 1):
        px = x - w / 2 + (i / m) * w
        for sz in (-1, 1):
            buf.emit(*p_box(px, y, z + sz * (d / 2 - t / 2), t, h, t), col=col, y0=None)


def add_platform(buf, x, y, z, ln, wd, col=STEEL, rail=True, deck=False, base=None):
    buf.emit(*p_box(x, y - 0.22, z, wd, 0.45, ln), col=col, y0=y, span=3)
    # edge upstand, so a platform reads as a solid deck and not a sheet of paper
    buf.emit(*p_box(x, y + 0.23, z, wd + 0.18, 0.35, 0.18), col=DARK, y0=y, span=3)
    buf.emit(*p_box(x, y + 0.23, z - ln / 2, wd + 0.18, 0.35, 0.18), col=DARK, y0=y, span=3)
    if base is not None and y - base > 1.6:
        # stanchions down to whatever is underneath - no floating platforms
        for sx in (-1, 1):
            for dz in (-1, 1):
                px = x + sx * max(0.5, wd / 2 - 0.7)
                pz = z + dz * max(0.5, ln / 2 - 0.7)
                buf.emit(*p_rod((px, base, pz), (px, y - 0.25, pz), 0.24, 5),
                         col=DARK, y0=base, span=max(3.0, y - base))
        if y - base > 4.0:
            my = (y + base) / 2
            for sx in (-1, 1):
                px = x + sx * max(0.5, wd / 2 - 0.7)
                buf.emit(*p_rod((px, my, z - ln / 2 + 0.7), (px, my, z + ln / 2 - 0.7), 0.14, 4),
                         col=DARK, y0=base, span=max(3.0, y - base))
            for dz in (-1, 1):
                pz = z + dz * max(0.5, ln / 2 - 0.7)
                buf.emit(*p_rod((x - wd / 2 + 0.7, my, pz), (x + wd / 2 - 0.7, my, pz), 0.14, 4),
                         col=DARK, y0=base, span=max(3.0, y - base))
    else:
        for sx in (-1, 1):
            for dz in (-0.35, 0.35):
                buf.emit(*p_box(x + sx * wd * 0.4, y - 1.4, z + ln * dz, 0.35, 1.4, 0.35), col=DARK, y0=y, span=3)
    if deck:
        buf.emit(*p_box(x, y + 0.23, z, wd - 0.3, 0.06, ln - 0.3), col=WOOD, y0=y, span=3)
    if rail:
        add_rail(buf, x, y + 0.35, z, wd, ln, 1.0)


def add_windows(buf, plan, y0, h, f0, f1, col=DARK, out=0.05, y_off=0.0):
    """A dark band around a block: window rows / scuttles."""
    rad = max(abs(x) + abs(z) for (x, z) in plan) / 2.0
    k = 1.0 + out / max(1.0, rad)
    pb = [(x * k, z * k) for (x, z) in plan]
    ya = y0 + h * f0 + y_off
    yb = y0 + h * f1 + y_off
    buf.emit(*p_prism(pb, pb, ya, yb, cap_top=False, cap_bot=False), col=col, y0=None)
    # a lip above the windows
    buf.emit(*p_prism(pb, pb, yb, yb + 0.22, cap_top=False, cap_bot=False), col=STEEL, y0=None)


# ---------------------------------------------------------------- parts


def build_part(buf, spec, p):
    y0 = deck_y(spec, p['z']) + p['y']
    k = p['k']
    x, z = p.get('x', 0.0), p['z']
    col = STEEL

    if k == 'b':
        part_start = len(buf.v)
        ln, wd, h = p.get('len', 8), p.get('w', 6), p.get('h', 3)
        plan = plan_poly(ln, wd, p.get('rf', 0), p.get('rr', 0))
        ta = p.get('ta', 0.25)
        fs = p.get('fs', 0)
        top = []
        for (px, pz) in plan:
            nx = px * (1 - (2 * ta) / wd)
            nz = pz * (1 - (2 * ta) / ln)
            if pz > 0 and fs:
                nz -= (fs * pz / (ln / 2)) * h * 0.25
            top.append((nx, nz))
        buf.emit(*p_prism(plan, top, y0, y0 + h, cap_top=True, cap_bot=False), col=col, y0=y0, span=max(2.5, h + 1.5))
        # ---- the thing that makes one level read as one level:
        # a dark shadow gap, then an overhanging gallery deck, then a rail.
        tp = top
        span = max(2.5, h + 1.5)
        # dark shadow gap under the deck above: this is what separates two levels
        gap = outset(tp, 0.30)
        buf.emit(*p_prism(gap, gap, y0 + h - 0.55, y0 + h - 0.04), col=DARK, y0=y0, span=span, lo=0.96)
        over = 1.25 if wd >= 6 else 0.6
        plate = outset(tp, over)
        buf.emit(*p_prism(plate, plate, y0 + h - 0.06, y0 + h + 0.30, cap_top=True, cap_bot=True),
                 col=(0.64, 0.68, 0.72), y0=y0, span=span, lo=0.92)
        if wd >= 6:
            # bulwark round the gallery deck
            rim = outset(plate, 0.26)
            buf.emit(*p_prism(plate, rim, y0 + h + 0.30, y0 + h + 0.70, cap_top=True, cap_bot=False),
                     col=(0.58, 0.62, 0.66), y0=y0, span=span, lo=0.95)
            rail_y = y0 + h + 0.70
        else:
            rail_y = y0 + h + 0.30
        # planking on the wide tops
        if wd >= 9:
            buf.emit(*p_prism(outset(tp, over - 0.55), outset(tp, over - 0.55), y0 + h + 0.30, y0 + h + 0.36,
                              cap_top=True, cap_bot=False), col=WOOD, y0=y0, span=span, lo=0.95)
        if p.get('win'):
            add_windows(buf, plan, y0, h, 0.46, 0.82)
        # All outline surfaces are local, unlike boxes and railings.
        for vi in range(part_start, len(buf.v)):
            vx, vy, vz = buf.v[vi]
            buf.v[vi] = (vx + x, vy - z, vz)
        # railing round the gallery deck
        if wd >= 4.5 and h <= 6:
            rr = max(plate, key=lambda q: abs(q[0]))
            rl = max(plate, key=lambda q: abs(q[1]))
            add_rail(buf, x, rail_y, z, abs(rr[0]) * 2 - 0.6, abs(rl[1]) * 2 - 0.6, 0.9)

    elif k == 'c':
        r, h = p.get('r', 2), p.get('h', 8)
        rake = math.radians(p.get('rake', 0) or 0) if abs(p.get('rake', 0) or 0) > 1.5 else (p.get('rake', 0) or 0)
        ov = p.get('ov', 1.0)
        buf.emit(*p_cyl(x, y0, z, r, r * 0.9, h, seg=14, squash=ov, rake=rake),
                 col=col, y0=y0, span=h + 2, lo=0.70)
        # cap
        tz = -math.tan(rake) * h
        buf.emit(*p_cyl(x, y0 + h - 0.55, z + tz, r * 0.97, r * 0.93, 0.6, seg=14, squash=ov, rake=0),
                 col=CAP, y0=y0, span=h + 2, lo=0.85)
        # collar band + platform
        cy = y0 + h * 0.66
        cz = z - math.tan(rake) * h * 0.66
        buf.emit(*p_cyl(x, cy, cz, r * 1.06 * ov + 0.1, r * 1.06 * ov + 0.1, 0.35, seg=14, squash=1.0),
                 col=DARK, y0=y0, span=h + 2, lo=0.8)
        # steam pipes
        for i in range(int(p.get('pipe', 0) or 0)):
            px = x + (i - (int(p.get('pipe', 1)) - 1) / 2) * r * 0.8
            buf.emit(*p_cyl(px, y0 + h + tz, z + tz, 0.26, 0.24, 1.7, seg=8), col=DARK, y0=y0, span=h + 2, lo=0.85)
        # a couple of vertical strakes
        for a in (0.35, math.pi - 0.35):
            px = x + math.cos(a) * r * ov * 1.0
            pz = z + math.sin(a) * r * 1.0
            buf.emit(*p_cyl(px, y0, pz, 0.1, 0.1, h * 0.95, seg=6), col=DARK, y0=y0, span=h + 2, lo=0.85)

    elif k == 'm':
        h, r = p.get('h', 14), p.get('r', 0.4)
        buf.emit(*p_cyl(x, y0, z, r, r * 0.65, h, seg=8), col=(0.84, 0.86, 0.89), y0=y0, span=h + 2, lo=0.75)
        if p.get('tri'):
            legs = p['tri']
            for i in range(int(round(legs))):
                a = (i / legs) * TAU + 0.3
                foot = (x + math.cos(a) * r * 2.6, y0, z + math.sin(a) * r * 2.6)
                head = (x + math.cos(a) * r * 0.6, y0 + h * 0.42, z + math.sin(a) * r * 0.6)
                buf.emit(*p_rod(foot, head, r * 0.34, 5), col=(0.80, 0.82, 0.85), y0=y0, span=h + 2, lo=0.7)
        for (f, w) in p.get('yards', []) or []:
            yy = y0 + h * f
            buf.emit(*p_cyl_x(x, yy, z, 0.15, w, 6), col=(0.78, 0.80, 0.83), y0=y0, span=h + 2, lo=0.75)
            # small flag halyard
        if p.get('top'):
            f, w = p['top']
            yy = y0 + h * f
            buf.emit(*p_box(x, yy, z, w, 0.45, w * 0.8), col=col, y0=y0, span=h + 2, lo=0.72)
            add_rail(buf, x, yy + 0.45, z, w * 0.95, w * 0.75, 0.85)
        if p.get('radar'):
            yy = y0 + h * 0.82
            buf.emit(*p_box(x, yy, z + 0.6, 2.6, 0.14, 1.05), col=(0.70, 0.72, 0.76), y0=y0, span=h + 2, lo=0.85)
            buf.emit(*p_box(x, yy - 0.5, z + 0.6, 0.18, 0.55, 0.18), col=DARK, y0=y0, span=h + 2, lo=0.85)
            # mattress frame
            for sx in (-1.2, 1.2):
                buf.emit(*p_box(x + sx, yy + 0.14, z + 0.6, 0.1, 0.9, 0.1), col=DARK, y0=y0, span=h + 2, lo=0.85)

    elif k == 'pl':
        ln, wd = p.get('len', 4), p.get('w', 6)
        add_platform(buf, x, y0, z, ln, wd, rail=True, deck=(wd >= 8), base=deck_y(spec, z))

    elif k == 'tt':
        n, ln = int(p.get('n', 3)), p.get('len', 7.5)
        sh = p.get('sh', 0)
        # rotating mount
        buf.emit(*p_cyl(x, y0, z, 1.5, 1.35, 0.5, seg=12), col=col, y0=y0, span=3, lo=0.7)
        body_z = z + (ln * 0.1 if not sh else -ln * 0.1)
        buf.emit(*p_box(x, y0 + 0.5, body_z, 1.7, 1.5, ln * 0.55), col=col, y0=y0, span=3, lo=0.68)
        buf.emit(*p_box(x, y0 + 0.5, z + (-ln * 0.2 if sh else ln * 0.2), 2.0, 1.35, ln * 0.3),
                 col=col, y0=y0, span=3, lo=0.66)
        for i in range(n):
            off = (i - (n - 1) / 2) * 0.62
            buf.emit(*p_cyl_z(x + off, y0 + 1.9, z, 0.32, ln * 0.85, 8), col=BARREL, y0=y0, span=3, lo=0.85)
            # muzzle ring
            buf.emit(*p_cyl_z(x + off, y0 + 1.9, z + ln * 0.42, 0.38, 0.25, 8), col=DARK, y0=y0, span=3, lo=0.9)

    elif k == 'aa':
        kind = p.get('kind', 'o')
        tab = {'o': (1, 0.16, 2.2, 0.7), 'b2': (2, 0.18, 2.6, 1.0), 'b4': (4, 0.18, 2.6, 1.3),
               'j2': (2, 0.16, 2.4, 0.9), 'j3': (3, 0.16, 2.4, 1.1), 'ha': (1, 0.22, 3.2, 1.1),
               'ha2': (2, 0.22, 3.2, 1.4)}
        n, br, bl, R = tab.get(kind, tab['o'])
        buf.emit(*p_cyl(x, y0, z, R * 0.62, R * 0.72, 0.85, seg=10), col=col, y0=y0, span=2.5, lo=0.7)
        # shield
        buf.emit(*p_box(x, y0 + 0.55, z - 0.55, R * 1.5, 0.9, 0.12), col=col, y0=y0, span=2.5, lo=0.72)
        for i in range(n):
            ox = ((i % 2) * 2 - 1) * R * 0.35
            oz = 0.1 if i < 2 else -0.5
            a = (x + ox, y0 + 0.95 + (0 if i < 2 else 0.2), z + oz)
            b = (x + ox, y0 + 1.0 + (0 if i < 2 else 0.2) + bl * 0.30, z + oz + bl * 0.95)
            buf.emit(*p_rod(a, b, br, 6), col=BARREL, y0=y0, span=2.5, lo=0.85)

    elif k == 'sl':
        buf.emit(*p_cyl(x, y0, z, 0.35, 0.35, 0.5, seg=10), col=DARK, y0=y0, span=2, lo=0.8)
        a = (x, y0 + 0.5, z)
        b = (x, y0 + 1.05, z + 0.55)
        buf.emit(*p_rod(a, b, 0.62, 12), col=LIGHT, y0=y0, span=2, lo=0.9)

    elif k == 'rf':
        ln = p.get('len', 4)
        buf.emit(*p_cyl_x(x, y0 + 0.55, z, 0.42, ln, 10), col=col, y0=y0, span=2.5, lo=0.78)
        for sx in (-ln * 0.36, ln * 0.36):
            buf.emit(*p_box(x + sx, y0, z, 0.3, 0.6, 0.3), col=col, y0=y0, span=2.5, lo=0.7)
        for sx in (-ln * 0.5, ln * 0.5):
            buf.emit(*p_cyl(x + sx, y0 + 0.55, z, 0.30, 0.30, 0.2, seg=8), col=DARK, y0=y0, span=2.5, lo=0.9)

    elif k == 'dr':
        buf.emit(*p_box(x, y0, z, 2.1, 1.5, 2.5), col=col, y0=y0, span=2.5, lo=0.72)
        buf.emit(*p_cyl(x, y0 + 1.5, z, 1.0, 0.9, 0.55, seg=12), col=col, y0=y0, span=2.5, lo=0.8)
        # binocular ears
        for sx in (-0.75, 0.75):
            buf.emit(*p_cyl(x + sx, y0 + 1.75, z + 0.35, 0.28, 0.28, 0.5, seg=8), col=DARK, y0=y0, span=2.5, lo=0.9)
        buf.emit(*p_box(x, y0 + 2.05, z, 1.6, 0.16, 0.5), col=DARK, y0=y0, span=2.5, lo=0.9)

    elif k == 'bt':
        ln = p.get('len', 7)
        # boat hull: rounded plan, tapering downward
        bot = [(a + x, b + z) for a,b in plan_poly(ln * 0.72, 1.5, 1.0, 1.0, 3)]
        top = [(a + x, b + z) for a,b in plan_poly(ln, 2.0, 0.6, 0.4, 3)]
        buf.emit(*p_prism(bot, top, y0, y0 + 0.75, cap_top=True, cap_bot=True), col=BOAT, y0=y0, span=2, lo=0.75)
        buf.emit(*p_box(x, y0 + 0.75, z - ln * 0.08, 1.5, 0.5, ln * 0.42), col=(0.72, 0.72, 0.70), y0=y0, span=2, lo=0.85)
        # thwarts / cover
        buf.emit(*p_box(x, y0 + 0.78, z + ln * 0.15, 1.7, 0.1, ln * 0.5), col=(0.62, 0.63, 0.62), y0=y0, span=2, lo=0.9)
        # davits
        for dz in (-ln * 0.36, ln * 0.36):
            buf.emit(*p_rod((x, y0 + 0.4, z + dz), (x, y0 + 2.6, z + dz), 0.13, 5), col=DARK, y0=y0, span=2, lo=0.85)

    elif k == 'cp':
        ln = p.get('len', 14)
        face = p.get('face', 0)
        ca, sa = math.cos(face), math.sin(face)
        # a solid girder reads at distance; rods only when you are right on top of it
        buf.emit(*p_box_y(x, y0 + 1.5, z, 2.0, 0.85, ln, face), col=col, y0=y0, span=3, lo=0.78)
        buf.emit(*p_box_y(x, y0 + 2.35, z, 1.1, 0.35, ln * 0.96, face), col=DARK, y0=y0, span=3, lo=0.88)
        # legs down to the deck
        for t in (-0.38, -0.13, 0.13, 0.38):
            px = x + sa * ln * t
            pz = z + ca * ln * t
            buf.emit(*p_rod((px, y0, pz), (px, y0 + 1.6, pz), 0.22, 5), col=col, y0=y0, span=3, lo=0.8)
        if p.get('plane'):
            px = x + sa * ln * 0.18
            pz = z + ca * ln * 0.18
            buf.emit(*p_cyl_z(px, y0 + 2.6, pz, 0.75, 4.2, 8), col=(0.70, 0.72, 0.74), y0=y0, span=3, lo=0.85)
            buf.emit(*p_box(px, y0 + 2.35, pz + 0.4, 9.0, 0.18, 1.4), col=(0.68, 0.70, 0.72), y0=y0, span=3, lo=0.85)
            buf.emit(*p_box(px, y0 + 2.9, pz - 0.2, 0.35, 1.0, 0.35), col=DARK, y0=y0, span=3, lo=0.85)
            for sx in (-1.6, 1.6):
                buf.emit(*p_cyl(px + sx, y0 + 1.9, pz + 0.2, 0.35, 0.35, 1.2, seg=8), col=DARK, y0=y0, span=3, lo=0.85)

    elif k == 'cr':
        h = p.get('h', 7)
        buf.emit(*p_cyl(x, y0, z, 0.62, 0.5, h, seg=10), col=col, y0=y0, span=h, lo=0.72)
        face = p.get('face', 0)
        boom = p.get('boom', 10)
        a = (x, y0 + h * 0.9, z)
        b = (x + math.sin(face) * boom, y0 + h + 0.4, z + math.cos(face) * boom)
        buf.emit(*p_rod(a, b, 0.26, 5), col=(0.78, 0.80, 0.83), y0=y0, span=h, lo=0.8)
        # jib stay
        buf.emit(*p_rod((x, y0 + h, z), b, 0.1, 4), col=DARK, y0=y0, span=h, lo=0.85)

    elif k == 'gm':
        t = TS.get(p.get('kind', 'us5d'), TS['us5d'])
        face = p.get('face', 0)
        buf.emit(*p_box(x, y0, z, t['w'] * 0.9, t['h'] * 0.9, t['len']), col=col, y0=y0, span=3, lo=0.7)
        a = (x, y0 + t['h'] * 0.5, z)
        b = (x + math.sin(face) * t['bl'] * 0.95, y0 + t['h'] * 0.5 + t['bl'] * 0.26, z + math.cos(face) * t['bl'] * 0.95)
        buf.emit(*p_rod(a, b, t['br'], 6), col=BARREL, y0=y0, span=3, lo=0.85)

    elif k == 'dc':
        yy = deck_y(spec, z) + 0.2
        buf.emit(*p_box(x, yy, z, 1.4, 0.7, 3.0), col=col, y0=yy, span=2, lo=0.7)
        for i in range(3):
            buf.emit(*p_cyl(x, yy + 0.7, z - 1.0 + i * 1.0, 0.45, 0.45, 0.5, seg=8), col=DARK, y0=yy, span=2, lo=0.85)


# ---------------------------------------------------------------- hull reference


def build_hull_ref(key, coll):
    spec = SHIPS[key]
    N = int(clamp(spec['L'] / 2.0, 48, 96))
    sts = [i / N for i in range(N + 1)]
    for pt in spec['sheer']:
        if 0.01 < pt[0] < 0.99:
            sts += [pt[0] - 0.0012, pt[0] + 0.0012]
    sts.sort()
    rings = []
    for s in sts:
        z = (s - 0.5) * spec['L'] + bow_rake(spec, s)
        top = deck_y(spec, (s - 0.5) * spec['L'])
        rings.append((s, z, top, hull_section(spec, s, top)))
    V = []
    F = []
    for (s, z, top, pts) in rings:
        row = []
        for (hw, y) in pts:
            row.append(W(hw, y, z))
        for (hw, y) in reversed(pts):
            row.append(W(-hw, y, z))
        V.append(row)
    flat = []
    for row in V:
        flat.extend(row)
    for r in range(len(rings) - 1):
        for i in range(2 * RING):
            j = (i + 1) % (2 * RING)
            a = r * 2 * RING + i
            b = r * 2 * RING + j
            c = (r + 1) * 2 * RING + j
            d = (r + 1) * 2 * RING + i
            F.append((a, b, c))
            F.append((a, c, d))
    me = bpy.data.meshes.new('refhull_' + key)
    me.from_pydata(flat, [], F)
    me.update()
    ob = bpy.data.objects.new('refhull_' + key, me)
    me.materials.append(get_mat_ref())
    ob.display_type = 'WIRE'
    coll.objects.link(ob)
    return ob


# ---------------------------------------------------------------- ships


def build_ship(key, ref=True, extras=True):
    spec = SHIPS[key]
    c = coll_named('ship_' + key)
    rc = coll_named('ref_' + key)
    if ref:
        build_hull_ref(key, rc)
    buf = Buf()
    if key == 'us_bb':
        # Art-only layout: historical Washington photographs, not stacked sim proxy blocks.
        namespace = {}
        source = r'D:\warship-game\art\blender\washington_super.py'
        exec(compile(open(source).read(), source, 'exec'), namespace)
        global WASHINGTON_AUDIT
        WASHINGTON_AUDIT = namespace['build_washington'](buf, spec, globals())
    else:
        for p in spec['parts']:
            try:
                build_part(buf, spec, p)
            except Exception as e:
                raise RuntimeError('part failed: %s %s z=%s' % (key,p.get('k'),p.get('z'))) from e
        if extras:
            add_extras(buf, spec)
    ob = make_obj('super_' + key, buf, coll=c)
    if key == 'us_bb':
        ob['visual_profile'] = 'USS Washington BB-56, August 1942 photo-based interpretation'
        ob['component_bounds'] = json.dumps(WASHINGTON_AUDIT)
    print(key, 'verts', len(buf.v), 'faces', len(buf.f))
    return ob


def add_extras(buf, spec):
    """Scale-giving detail that is not in the part list: vents, hatches, flagstaff."""
    rnd = random.Random(spec['key'])
    key = spec['key']
    B = spec['B']
    add_fixed_barbettes(buf, spec)
    # ventilator cowls along the biggest deckhouse
    for p in spec['parts']:
        if p['k'] == 'b' and p.get('len', 0) >= 30 and p.get('w', 0) >= B * 0.6:
            y0 = deck_y(spec, p['z']) + p['y'] + p.get('h', 3)
            ln = p['len']
            for i in range(6):
                zz = p['z'] - ln * 0.4 + (i / 5) * ln * 0.8
                xx = (p.get('x', 0) or 0) + (rnd.uniform(-1, 1)) * p['w'] * 0.3
                buf.emit(*p_cyl(xx, y0, zz, 0.42, 0.5, 1.1, seg=8), col=(0.66, 0.68, 0.71), y0=y0, span=3, lo=0.8)
                buf.emit(*p_cyl(xx, y0 + 1.1, zz, 0.55, 0.42, 0.3, seg=8), col=DARK, y0=y0, span=3, lo=0.9)
            break
    # hatches on the forecastle / quarterdeck
    zz = spec['L'] * 0.34
    buf.emit(*p_box(0, deck_y(spec, zz), zz, 1.4, 0.25, 2.0), col=DARK, y0=deck_y(spec, zz), span=2, lo=0.85)
    zz2 = -spec['L'] * 0.36
    buf.emit(*p_box(0, deck_y(spec, zz2), zz2, 1.4, 0.25, 2.0), col=DARK, y0=deck_y(spec, zz2), span=2, lo=0.85)
    # anchor pockets near the bow, kept inside the hull plan
    for sx in (-1, 1):
        zz = spec['L'] * 0.42
        yy = deck_y(spec, zz) - 1.6
        hw = (spec['B'] / 2) * half_w(zz / spec['L'] + 0.5)
        buf.emit(*p_box(sx * (hw - 0.5), yy, zz, 0.5, 0.5, 1.6), col=DARK, y0=yy, span=2, lo=0.8)


def add_fixed_barbettes(buf, spec):
    """Raised mounts need non-rotating structure down to the real deck.

    Shared gun GLBs cannot know the height of a particular mounting station. Their short
    ring is only the turret interface, not a magically suspended full-height foundation.
    """
    for t in spec['tur']:
        if t.get('sec') or t['y'] <= 0.1:
            continue
        shape = TS[t['kind']]
        deck = deck_y(spec, t['z'])
        mount = deck + t['y']
        r = shape['w'] * 0.44
        buf.emit(*p_cyl(t['x'], deck - 0.35, t['z'], r, r, t['y'] + 0.35,
                       seg=24), col=STEEL, y0=deck, span=max(2, t['y']), lo=0.72)
        # Upper fixed bearing shoulder; the gun's ring overlaps this rather than floating.
        buf.emit(*p_cyl(t['x'], mount - 0.45, t['z'], r * 1.025, r * 1.025, 0.22,
                       seg=24), col=(0.54,0.58,0.62), y0=None)
    if spec['key'] == 'us_bb':
        # No.2's raised working deck extends from the forward deckhouse into the barbette.
        t = spec['tur'][1]
        rear = 34.0  # overlap existing deckhouse's forward end at z=35
        front = t['z']
        center = (rear + front) / 2
        width = TS[t['kind']]['w'] * 0.96
        plan = [(x, z + center) for x,z in plan_poly(front-rear, width, 0.18, 0.12)]
        y0 = min(deck_y(spec,rear), deck_y(spec,front)) - 0.3
        y1 = deck_y(spec,front) + t['y'] - 0.50
        buf.emit(*p_prism(plan,plan,y0,y1,cap_top=True,cap_bot=True),
                 col=STEEL,y0=y0,span=y1-y0,lo=0.72)
        buf.emit(*p_prism(plan,plan,y1,y1+0.10,cap_top=True,cap_bot=False),
                 col=(0.48,0.51,0.54),y0=None)


# ---------------------------------------------------------------- turrets


def build_turret(kind, coll=None):
    t = TS[kind]
    hw, hl = t['w'] / 2, t['len'] / 2
    c = coll or coll_named('gun_' + kind)
    if kind in ('us16t','us5d','jp14d','jp6c'):
        japanese = kind in ('jp14d','jp6c')
        source = (r'D:\warship-game\art\blender\jp_refined_guns.py' if japanese
                  else r'D:\warship-game\art\blender\us_refined_guns.py')
        namespace = {}
        exec(compile(open(source,encoding='utf-8').read(),source,'exec'),namespace)
        b,g,origin = namespace['build_jp_gun' if japanese else 'build_us_gun'](kind,globals())
        base = make_obj('base_' + kind,b,coll=c)
        barrel = make_obj('barrel_' + kind,g,origin=origin,coll=c)
        for i in getattr(g,'smooth_faces',()):
            face=barrel.data.polygons[i]
            if abs(face.normal.y)<.9:face.use_smooth=True
        base['export_role']='base';barrel['export_role']='barrel'
        if hasattr(b,'optics_style'):base['optics_style']=b.optics_style
        print(kind,'refined base',len(b.f),'barrel',len(g.f))
        return base,barrel

    # ---- base (ring centre at the deck)
    b = Buf()
    # armour house plan, same recipe as the game
    cf = (t.get('cf') or 0) * hw
    rc = (t.get('rr') or 0) * hw
    pts = []
    pts.append((-(hw - cf), hl))
    pts.append((hw - cf, hl))
    if cf > 0.02:
        for i in range(5):
            a = math.pi / 2 - (math.pi / 2) * (i / 4)
            pts.append((hw - cf + math.cos(a) * cf, hl - cf + math.sin(a) * cf))
    pts.append((hw, hl - cf))
    pts.append((hw, -(hl - rc)))
    if rc > 0.02:
        for i in range(5):
            a = 0 - (math.pi / 2) * (i / 4)
            pts.append((hw - rc + math.cos(a) * rc, -(hl - rc) + math.sin(a) * rc))
    pts.append((hw - rc, -hl))
    pts.append((-(hw - rc), -hl))
    if rc > 0.02:
        for i in range(5):
            a = -math.pi / 2 - (math.pi / 2) * (i / 4)
            pts.append((-(hw - rc) + math.cos(a) * rc, -(hl - rc) + math.sin(a) * rc))
    pts.append((-hw, -(hl - rc)))
    pts.append((-hw, hl - cf))
    if cf > 0.02:
        for i in range(5):
            a = math.pi - (math.pi / 2) * (i / 4)
            pts.append((-(hw - cf) + math.cos(a) * cf, hl - cf + math.sin(a) * cf))
    ss = t.get('ss') or 0.1
    fs = t.get('fs') if t.get('fs') is not None else 0.24
    rs = t.get('rs') or 0.04
    top = []
    for (x, z) in pts:
        nx = x * (1 - ss)
        nz = (z - (fs * z / hl)) if z > 0 else (z + rs * (-z) / hl)
        top.append((nx, nz))
    h = t['h']
    b.emit(*p_prism(pts, top, 0, h, cap_top=True, cap_bot=True), col=STEEL, y0=0, span=h + 1.5)
    # barbette below the deck
    b.emit(*p_cyl(0, -1.3, 0, t['w'] * 0.44, t['w'] * 0.42, 1.3, seg=18), col=STEEL, y0=-1.3, span=2, lo=0.6)
    # roof plate lip
    b.emit(*p_prism(top, [(x * 1.03, z * 1.03) for (x, z) in top], h - 0.15, h + 0.08), col=STEEL, y0=h, span=2, lo=0.9)
    if t.get('ears'):
        re = h * 0.085
        a = (-hw * 1.05, h * 0.78, hl * 0.35)
        bb = (hw * 1.05, h * 0.78, hl * 0.35)
        b.emit(*p_rod(a, bb, re, 8), col=STEEL, y0=h * 0.78, span=2, lo=0.9)
    if t.get('hood'):
        for sx in (-1, 1):
            b.emit(*p_box(sx * t['w'] * 0.3, h * 0.62, hl * 0.6, t['w'] * 0.28, h * 0.3, 1.2),
                   col=STEEL, y0=h, span=2, lo=0.9)
    # commander's cupola + vents
    b.emit(*p_cyl(0, h, -hl * 0.45, 0.55, 0.5, 0.5, seg=10), col=STEEL, y0=h, span=2, lo=0.92)
    for sx in (-0.6, 0.6):
        b.emit(*p_cyl(sx * hw * 0.8, h, -hl * 0.15, 0.22, 0.2, 0.35, seg=8), col=DARK, y0=h, span=2, lo=0.92)
    base = make_obj('base_' + kind, b, origin=(0, 0, 0), coll=c)
    base['export_role'] = 'base'

    # ---- barrel group, origin at the trunnion.
    # Gun centreline and pitch origin coincide, matching game muzzle maths.
    ty0 = h * 0.5
    ty = ty0
    tz = t['len'] * 0.18
    g = Buf()
    n = t['n']
    br, bl = t['br'], t['bl']
    for i in range(n):
        ox = (i - (n - 1) / 2) * t['w'] * 0.28
        exit_z = hl * 0.6
        prof = [(0.05, -br * 1.6),
                (br * 1.75, -br * 1.6),
                (br * 1.75, exit_z + br * 2.0),
                (br * 1.15, exit_z + br * 3.2),
                (br * 1.02, exit_z + br * 5),
                (br * 0.95, bl * 0.75),
                (br * 1.06, bl * 0.97),
                (br * 1.02, bl),
                (br * 0.86, bl)]
        g.emit(*p_lathe_z(ox, ty, tz, prof, seg=10), col=BARREL, y0=ty, span=3, lo=0.9)
        # breech
        g.emit(*p_box(ox, ty - br * 1.3, tz - br * 1.4, br * 3.0, br * 2.6, br * 3.6), col=DARK, y0=ty, span=3, lo=0.9)
        # sleeve / slide
        g.emit(*p_cyl_z(ox, ty, tz + br * 2.5, br * 1.9, br * 2.6, 8), col=(0.34, 0.36, 0.40), y0=ty, span=3, lo=0.9)
        # muzzle face
        g.emit(*p_cyl_z(ox, ty, tz + bl - 0.05, br * 0.9, 0.12, 8), col=DARK, y0=ty, span=3, lo=0.95)
    # movable shield across the gun ports
    if n > 1:
        sw = t['w'] * 0.28 * (n - 1) + br * 7
        g.emit(*p_box(0, ty - br * 2.6, tz + br * 2.2, sw, br * 5.2, 0.35), col=STEEL, y0=ty, span=3, lo=0.88)
        for i in range(n):
            ox = (i - (n - 1) / 2) * t['w'] * 0.28
            g.emit(*p_cyl_z(ox, ty, tz + br * 2.0, br * 2.1, 0.22, 8), col=DARK, y0=ty, span=3, lo=0.9)
    barrel = make_obj('barrel_' + kind, g, origin=(0, ty0, tz), coll=c)
    barrel['export_role'] = 'barrel'
    print(kind, 'base', len(b.f), 'barrel', len(g.f))
    return base, barrel


def build_turrets(kinds=None, force=True):
    out = []
    for k in (kinds or list(TS.keys())):
        c = bpy.data.collections.get('gun_' + k)
        if force or not c or len(c.objects) < 2:
            c = coll_named('gun_' + k)
            out.append(build_turret(k, c))
        else:
            out.append((c.objects.get('base'), c.objects.get('barrel')))
    return out


def preview_turrets(key, mounts=None, collection_name=None):
    """Linked copies of the gun models at their mounts, for eyeballing in the viewport."""
    spec = SHIPS[key]
    c = coll_named(collection_name or ('preview_' + key))
    bpy.context.view_layer.update()
    for index,t in enumerate(mounts if mounts is not None else spec['tur']):
        kind = t['kind']
        gc = bpy.data.collections.get('gun_' + kind)
        if not gc:
            build_turret(kind)
            gc = bpy.data.collections.get('gun_' + kind)
            bpy.context.view_layer.update()
        for src in gc.objects:
            o = src.copy()
            o.data = src.data
            # Preserve the source node's trunnion translation under a yaw-only mount parent.
            from mathutils import Matrix, Vector
            mount = Matrix.Translation(Vector(W(t['x'], deck_y(spec,t['z']) + t['y'], t['z'])))
            yaw = Matrix.Rotation(t['face'], 4, 'Z')
            o.matrix_world = mount @ yaw @ src.matrix_world
            o['mount_index']=index
            o['kind']=kind
            c.objects.link(o)


# ---------------------------------------------------------------- export

OUT = r"D:\warship-game\public\models"


def export_collection(c, path, extras=False):
    """Export works even when the single-ship workbench has hidden this collection."""
    states = [(o, o.hide_get(), o.hide_render) for o in c.objects]
    bpy.ops.object.select_all(action='DESELECT')
    try:
        for o, _, _ in states:
            o.hide_set(False)
            o.hide_render = False
            o.select_set(True)
        bpy.context.view_layer.objects.active = c.objects[0]
        bpy.context.view_layer.update()
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                                  export_yup=True, export_materials='EXPORT',
                                  export_vertex_color='ACTIVE', export_apply=True, export_extras=extras)
    finally:
        for o, hidden, hidden_render in states:
            o.hide_set(hidden)
            o.hide_render = hidden_render


def export_ship(key):
    if key not in SHIPS:
        raise ValueError('Preview-only layout must not be registered or exported as a game ship')
    c = bpy.data.collections.get('ship_' + key)
    path = os.path.join(OUT, 'ships', key + '_super.glb')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    export_collection(c, path)
    print('exported', path, os.path.getsize(path))


def export_gun(kind):
    c = bpy.data.collections.get('gun_' + kind)
    # the game looks for two nodes called exactly "base" and "barrel", and Blender will happily
    # rename ours to "base.007" if another gun already owns the name - so take the names back.
    mine = list(c.objects)
    for n in ('base', 'barrel'):
        o = bpy.data.objects.get(n)
        if o is not None and o not in mine:
            o.name = 'spare_' + n
    for o in mine:
        role = o.get('export_role')
        if role in ('base', 'barrel'):
            o.name = role
    path = os.path.join(OUT, 'guns', kind + '.glb')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    export_collection(c, path)
    print('exported', path, os.path.getsize(path))


SHOTDIR = r"C:\Users\ADMINI~1\AppData\Local\Temp\opencode\shots"


def studio():
    """Lights + a camera we can aim at anything. Safe to call repeatedly."""
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new('ws_world')
    sc.world.use_nodes = True
    bg = next((n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND'), None)
    if bg:
        # dark slate: the model is light grey, a bright background washes the silhouette out
        bg.inputs['Color'].default_value = (0.115, 0.140, 0.175, 1)
        bg.inputs['Strength'].default_value = 1.0
    sc.render.film_transparent = False
    sc.render.resolution_x = 1400
    sc.render.resolution_y = 800
    for (nm, e, loc) in (('ws_key', 2.6, (60, -70, 70)), ('ws_fill', 0.7, (-90, 40, 30)),
                         ('ws_rim', 1.1, (20, 90, 25))):
        l = bpy.data.objects.get(nm)
        if l is None:
            ld = bpy.data.lights.new(nm, type='SUN')
            ld.energy = e
            l = bpy.data.objects.new(nm, ld)
            bpy.context.scene.collection.objects.link(l)
        l.location = loc
        from mathutils import Vector
        l.data.energy = e
        l.rotation_euler = (-Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.get('ws_cam')
    if cam is None:
        cd = bpy.data.cameras.new('ws_cam')
        cam = bpy.data.objects.new('ws_cam', cd)
        bpy.context.scene.collection.objects.link(cam)
    sc.camera = cam
    return cam


def render_shot(name, objs, yaw=-38, pitch=16, pad=1.10, res=(1400, 800), hide=(),
                ortho=False, focus=None, span=None):
    """Aim the studio camera at `objs` (or at `focus`, a hull triple) and render to SHOTDIR."""
    from mathutils import Vector
    objs = [o for o in objs if o]
    sc = bpy.context.scene
    cam = studio()
    bpy.context.view_layer.update()
    sc.render.resolution_x, sc.render.resolution_y = res
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    ctr = Vector([(mn[i] + mx[i]) / 2 for i in range(3)])
    if focus is not None:
        ctr = Vector(W(*focus))
    size = span if span else max(mx[i] - mn[i] for i in range(3))

    ya, pi = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(ya) * math.cos(pi), -math.cos(ya) * math.cos(pi), math.sin(pi))).normalized()
    up_w = Vector((0.0, 0.0, 1.0))
    right = up_w.cross(d)
    if right.length < 1e-5:
        right = Vector((1.0, 0.0, 0.0))
    right.normalize()
    up_c = d.cross(right).normalized()

    # projected extents of the (focus) box about the centre
    ex = ey = ez = 0.0
    for o in objs:
        for c in o.bound_box:
            rel = (o.matrix_world @ Vector(c)) - ctr
            ex = max(ex, abs(rel.dot(right)))
            ey = max(ey, abs(rel.dot(up_c)))
            ez = max(ez, abs(rel.dot(d)))
    if span:
        ex = span / 2
        ey = ex * res[1] / res[0]
        ez = span / 2

    aspect = res[0] / res[1]
    cam.data.sensor_fit = 'HORIZONTAL'
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = max(2 * ey * pad * aspect, 2 * ex * pad, 1.0)
        dist = ez + size * 1.5 + 40
    else:
        cam.data.type = 'PERSP'
        tanh = cam.data.sensor_width / (2 * cam.data.lens)
        tanv = tanh / aspect
        dist = max(ex / tanh + ez, ey / tanv + ez) * pad + size * 0.06
    cam.data.clip_end = max(2000.0, dist + size * 4)
    cam.location = ctr + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()

    states = [(o, o.hide_render) for o in sc.objects]
    allowed = set(objs) - set(hide)
    for o in sc.objects:
        if o.type == 'MESH':
            o.hide_render = o not in allowed
    os.makedirs(SHOTDIR, exist_ok=True)
    path = os.path.join(SHOTDIR, name + '.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o, previous in states:
        o.hide_render = previous
    print('shot', path)
    return path


def show_ship(key):
    """Single-ship workbench; source guns and other classes remain stored, not overlaid."""
    allowed = {'ship_' + key, 'preview_' + key, 'ref_' + key}
    for c in bpy.data.collections:
        if c.name.startswith(('ship_', 'preview_', 'ref_', 'gun_', 'marks_')):
            visible = c.name in allowed
            # Per-object flags keep future exports selectable without excluded view layers.
            c.hide_viewport = False
            c.hide_render = False
            for o in c.objects:
                o.hide_set(not visible)
                o.hide_render = not visible
    for o in bpy.data.objects:
        if o.name.startswith('refhull_'):
            o.display_type = 'TEXTURED'
    bpy.context.view_layer.update()


def review(key, tag=''):
    """The standard review set: ortho front/side/top plus two three-quarter views."""
    c = bpy.data.collections.get('ship_' + key)
    rc = bpy.data.collections.get('ref_' + key)
    pc = bpy.data.collections.get('preview_' + key)
    if not c:
        build_ship(key)
        c = bpy.data.collections.get('ship_' + key)
        rc = bpy.data.collections.get('ref_' + key)
    if not pc:
        preview_turrets(key)
        pc = bpy.data.collections.get('preview_' + key)
    tag = tag or key
    objs = list(c.objects) + list(pc.objects) + (list(rc.objects) if rc else [])
    out = []
    out.append(render_shot(tag + '_side', objs, yaw=90, pitch=0, ortho=True, res=(1800, 620)))
    out.append(render_shot(tag + '_top', objs, yaw=0, pitch=87, ortho=True, res=(1800, 620)))
    out.append(render_shot(tag + '_front', objs, yaw=0, pitch=0, ortho=True, res=(900, 700)))
    out.append(render_shot(tag + '_qbow', objs, yaw=40, pitch=15, res=(1400, 800)))
    out.append(render_shot(tag + '_qstern', objs, yaw=140, pitch=13, res=(1400, 800)))
    out.append(render_shot(tag + '_qport', objs, yaw=-55, pitch=22, res=(1400, 800)))
    return out


MARKS = [
    ('bow', (1.0, 0.05, 0.05)),
    ('turret1', (0.05, 1.0, 1.0)),
    ('bridge', (0.05, 1.0, 0.1)),
    ('funnel1', (1.0, 1.0, 0.05)),
    ('funnel2', (1.0, 0.05, 1.0)),
    ('stern', (0.1, 0.25, 1.0)),
]


def markers(key, z_bridge=31.5, z_f1=12.0, z_f2=-5.0, z_t1=72.0, y=52.0):
    """Coloured balls floating above the ship in fore/aft order - an orientation sanity check."""
    spec = SHIPS[key]
    c = coll_named('marks_' + key)
    pts = {
        'bow': (0, y, spec['L'] * 0.46),
        'stern': (0, y, -spec['L'] * 0.46),
        'bridge': (0, y, z_bridge),
        'funnel1': (0, y, z_f1),
        'funnel2': (0, y, z_f2),
        'turret1': (0, y, z_t1),
    }
    out = []
    for (nm, rgb) in MARKS:
        p = pts[nm]
        me = bpy.data.meshes.new('mk_' + nm)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=6.0)
        bm.to_mesh(me)
        bm.free()
        m = bpy.data.materials.get('mk_' + nm)
        if m is None:
            m = bpy.data.materials.new('mk_' + nm)
            m.use_nodes = True
            b2 = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            b2.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1)
            b2.inputs['Roughness'].default_value = 0.4
            b2.inputs['Emission Strength'].default_value = 1.2
            b2.inputs['Emission Color'].default_value = (rgb[0], rgb[1], rgb[2], 1)
        me.materials.append(m)
        ob = bpy.data.objects.new('mk_' + nm, me)
        ob.location = W(*p)
        c.objects.link(ob)
        out.append(ob)
    return out


def closeup(key, name, fx, fy, fz, span=40, yaw=35, pitch=12, res=(1200, 800)):
    c = bpy.data.collections.get('ship_' + key)
    pc = bpy.data.collections.get('preview_' + key)
    rc = bpy.data.collections.get('ref_' + key)
    objs = list(c.objects) + (list(pc.objects) if pc else []) + (list(rc.objects) if rc else [])
    return render_shot(name, objs, yaw=yaw, pitch=pitch, focus=(fx, fy, fz), span=span, res=res)


def ship_shots(key, tag=''):
    c = bpy.data.collections.get('ship_' + key)
    rc = bpy.data.collections.get('ref_' + key)
    pc = bpy.data.collections.get('preview_' + key)
    if not c:
        build_ship(key)
        c = bpy.data.collections.get('ship_' + key)
    tag = tag or key
    objs = list(c.objects) + (list(pc.objects) if pc else [])
    out = []
    out.append(render_shot(tag + '_a', objs, yaw=-38, pitch=14, hide=list(rc.objects if rc else [])))
    out.append(render_shot(tag + '_b', objs, yaw=48, pitch=10, hide=list(rc.objects if rc else [])))
    out.append(render_shot(tag + '_side', objs, yaw=-90, pitch=2, hide=list(rc.objects if rc else [])))
    if rc:
        out.append(render_shot(tag + '_ctx', objs + list(rc.objects), yaw=-38, pitch=14))
    return out


def gun_shot(kind, tag=''):
    c = bpy.data.collections.get('gun_' + kind)
    if not c:
        build_turret(kind)
        c = bpy.data.collections.get('gun_' + kind)
    return render_shot(tag or ('gun_' + kind), list(c.objects), yaw=-40, pitch=12, res=(900, 700))


def frame_all():
    for a in bpy.context.screen.areas:
        if a.type == 'VIEW_3D':
            for r in a.regions:
                if r.type == 'WINDOW':
                    with bpy.context.temp_override(area=a, region=r):
                        bpy.ops.view3d.view_all()
                    return


def validate_geometry():
    """Check generated positions and preview matrices, not merely input parameters."""
    from mathutils import Vector, Matrix
    count = 0
    washington = bpy.data.objects.get('super_us_bb')
    stored_audit = json.loads(washington.get('component_bounds','{}')) if washington else {}
    if stored_audit:
        tower = stored_audit['continuous_tower']
        assert 24 < tower['bow'][0] < 27, tower
        assert 33 < tower['bow'][1] < 36, tower
        assert abs((tower['x'][0]+tower['x'][1])/2) < .01, tower
        assert tower['height'][1] > 34, tower
        assert stored_audit['upper_platform_and_director']['height'][1] < 45
        print('WASHINGTON: actual continuous tower and director bounds passed')
    for key, spec in SHIPS.items():
        for p in spec['parts']:
            if p['k'] != 'b':
                continue
            b = Buf()
            build_part(b, spec, p)
            xs, zs = [v[0] for v in b.v], [-v[1] for v in b.v]
            assert abs((min(xs)+max(xs))/2-p['x']) < 0.6, (key,p,'X')
            assert abs((min(zs)+max(zs))/2-p['z']) < 0.6, (key,p,'Z')
            count += 1
        preview = bpy.data.collections.get('preview_' + key)
        if preview:
            assert len(preview.objects) == 2*len(spec['tur']), key
            for i, t in enumerate(spec['tur']):
                ts = TS[t['kind']]
                mount = Matrix.Translation(Vector(W(t['x'], deck_y(spec,t['z'])+t['y'], t['z'])))
                yaw = Matrix.Rotation(t['face'],4,'Z')
                expected = mount @ yaw @ Vector(W(0,ts['h']/2,ts['len']*0.18))
                candidates = [o for o in preview.objects if o.get('export_role') == 'barrel'
                              and (o.matrix_world.translation-expected).length < 0.001]
                assert candidates, (key,t,'missing trunnion')
    print('GEOMETRY VALIDATED:',count,'positioned blocks; preview trunnions matched')


print('warship_build loaded')
