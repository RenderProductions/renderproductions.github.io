# Repaints TODD's texture at 4x: pale blue dress shirt, dark blue dress pants, polished shoes, detailed robot parts.
# Works out each box face from the model itself (positions + UVs), so details land on the right faces.
import json, sys, base64, struct, io, math, random
import numpy as np
from PIL import Image

src, out_gltf, out_png, orig_png = sys.argv[1:5]
d = json.load(open(src))
buf = base64.b64decode(d['buffers'][0]['uri'].split(',', 1)[1])
tex = Image.open(io.BytesIO(base64.b64decode(d['images'][0]['uri'].split(',', 1)[1]))).convert('RGBA')
tex.save(orig_png)
S = 4                                     # 256 -> 1024
T = np.array(tex.resize((256 * S, 256 * S), Image.NEAREST)).astype(np.float32)
OLD = np.array(tex)

def acc(i):
    a = d['accessors'][i]; bv = d['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    fmt = {5126: 'f', 5121: 'B', 5123: 'H', 5125: 'I'}[a['componentType']]
    sz = struct.calcsize(fmt); off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', sz * n)
    return [struct.unpack_from('<' + fmt * n, buf, off + i * st) for i in range(a['count'])]
pr = d['meshes'][0]['primitives'][0]
joints = [d['nodes'][j]['name'] for j in d['skins'][0]['joints']]
P = acc(pr['attributes']['POSITION']); UV = acc(pr['attributes']['TEXCOORD_0']); N = acc(pr['attributes']['NORMAL'])
J = acc(pr['attributes']['JOINTS_0']); W = acc(pr['attributes']['WEIGHTS_0'])

rng = random.Random(4)
nrng = np.random.default_rng(4)
NOISE = nrng.standard_normal((256 * S, 256 * S)).astype(np.float32)

def hexc(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
PAL = {
    'shirt': dict(base=hexc('#b3cfec'), dark=hexc('#7f9cc0'), seam=hexc('#6f8bb0'), light=hexc('#d6e6f7'), white=hexc('#eef3fa')),
    'pants': dict(base=hexc('#243463'), dark=hexc('#141d3c'), seam=hexc('#0f1630'), light=hexc('#3a4d86')),
    'shoe':  dict(base=hexc('#2c1e14'), dark=hexc('#140d08'), light=hexc('#6b4c33'), sole=hexc('#0d0907')),
    'metal': dict(base=hexc('#4f5858'), dark=hexc('#323a3a'), light=hexc('#7d8888'), bolt=hexc('#9aa5a5')),
    'belt':  dict(base=hexc('#1c1511'), light=hexc('#3a2c22'), buckle=hexc('#c7b27a'), bdark=hexc('#7d6a3c')),
}

def classify(c):
    r, g, b = (int(x) for x in c[:3])
    if g > 230 and b > 230 and r < 40: return 'screen'
    if abs(r - 0x2e) < 12 and abs(g - 0x97) < 14: return 'shirt'
    if abs(r - 0x15) < 10 and abs(b - 0x36) < 12: return 'pants'
    if abs(r - 0x2a) < 12 and abs(g - 0x20) < 12 and b < 40: return 'shoe'
    if abs(r - 0x4b) < 14 and abs(g - 0x53) < 14: return 'metal'
    return None

# ---- the faces ----
faces = []
for q in range(0, len(P), 4):
    vs = list(range(q, q + 4))
    n = N[q]; ax = max(range(3), key=lambda k: abs(n[k])); sign = 1 if n[ax] > 0 else -1
    bone = joints[J[q][max(range(4), key=lambda k: W[q][k])]]
    pos = np.array([P[v] for v in vs]); uv = np.array([[UV[v][0] * 256, UV[v][1] * 256] for v in vs])
    # face axes: h (horizontal across the face), v (up the face)
    if ax == 2: hk, vk = 0, 1
    elif ax == 0: hk, vk = 2, 1
    else: hk, vk = 0, 2
    lo, hi = pos.min(0), pos.max(0)
    u0, u1 = uv[:, 0].min(), uv[:, 0].max(); w0, w1 = uv[:, 1].min(), uv[:, 1].max()
    if u1 - u0 < 0.5 or w1 - w0 < 0.5: continue
    # which texture direction runs along h, and which way
    i_min_h = np.argmin(pos[:, hk] + 1e-3 * pos[:, vk]); i_max_h = np.argmax(pos[:, hk] - 1e-3 * pos[:, vk])
    du = uv[i_max_h] - uv[i_min_h]
    h_on_u = abs(du[0]) >= abs(du[1])
    reg = OLD[int(w0):max(int(w0) + 1, int(math.ceil(w1))), int(u0):max(int(u0) + 1, int(math.ceil(u1)))]
    cols = [tuple(c) for c in reg.reshape(-1, 4)]
    kind = classify(max(set(cols), key=cols.count))
    faces.append(dict(bone=bone, ax='xyz'[ax], sign=sign, pos=pos, uv=uv, lo=lo, hi=hi, hk=hk, vk=vk,
                      u0=u0, u1=u1, w0=w0, w1=w1, kind=kind, h_on_u=h_on_u, du=du,
                      size=hi - lo, uvmin=uv.min(0)))

def coords(f):
    """pixel grid of the face (in 4x space) with s (0..1 across, left to right as seen from outside),
    t (0 top .. 1 bottom), and world height y"""
    x0, x1 = int(round(f['u0'] * S)), int(round(f['u1'] * S)); y0, y1 = int(round(f['w0'] * S)), int(round(f['w1'] * S))
    xs = (np.arange(x0, x1) + 0.5) / S; ys = (np.arange(y0, y1) + 0.5) / S
    X, Y = np.meshgrid(xs, ys)
    uu = (X - f['u0']) / max(1e-6, f['u1'] - f['u0']); vv = (Y - f['w0']) / max(1e-6, f['w1'] - f['w0'])
    # map texture u/v to face s/t using the corner orientation
    if f['h_on_u']:
        s = uu if f['du'][0] > 0 else 1 - uu
        # v: find whether texture v grows downward with world height decreasing
        top = np.argmax(f['pos'][:, f['vk']]); bot = np.argmin(f['pos'][:, f['vk']])
        t = vv if f['uv'][top][1] <= f['uv'][bot][1] else 1 - vv
    else:
        s = vv if f['du'][1] > 0 else 1 - vv
        top = np.argmax(f['pos'][:, f['vk']]); bot = np.argmin(f['pos'][:, f['vk']])
        t = uu if f['uv'][top][0] <= f['uv'][bot][0] else 1 - uu
    wh = f['lo'][f['hk']] + s * (f['hi'][f['hk']] - f['lo'][f['hk']])   # world position across the face
    if f['sign'] < 0 and f['ax'] != 'y': s = 1 - s       # seen from outside
    wy = f['hi'][1] - t * (f['hi'][1] - f['lo'][1])      # world height of each pixel
    pxw = (x1 - x0) if f['h_on_u'] else (y1 - y0)        # face width in pixels
    pxh = (y1 - y0) if f['h_on_u'] else (x1 - x0)
    wx = wh if f['hk'] == 0 else np.zeros_like(s) + (f['lo'][0] + f['hi'][0]) / 2
    return (slice(y0, y1), slice(x0, x1)), s, t, wy, wx, pxw, pxh

def blend(region, mask, col, a=1.0):
    m = (np.clip(mask, 0, 1) * a)[..., None]
    region[..., :3] = region[..., :3] * (1 - m) + col * m

HEIGHTS = {'shirt': (2.9, 0.75), 'pants': (1.1, 1.2), 'shoe': (-0.15, 0.25), 'metal': (3.0, 1.8)}
def shade(f, s, t, wy, pxw, pxh, base, dark, light):
    """base colour with soft form shading: lighter higher up the body (one smooth gradient across all the
    boxes of a garment, so no seams at the joints), darker underneath and at the edges"""
    g = np.zeros(s.shape + (3,), np.float32) + base
    mid, span = HEIGHTS.get(f['kind'], (2, 2))
    k = np.clip((wy - mid) / span, -1, 1)[..., None]
    g = g + (light - base) * np.clip(k, 0, 1) * 0.35 + (dark - base) * np.clip(-k, 0, 1) * 0.32
    if f['ax'] == 'y':
        g = g + (light - base) * 0.08 if f['sign'] > 0 else g + (dark - g) * 0.3
    # edges: a soft darker rim, a pixel or so in
    ex = np.minimum(s, 1 - s) * pxw; ey = np.minimum(t, 1 - t) * pxh
    rim = np.clip(1.6 - np.minimum(ex, ey), 0, 1)
    g = g + (dark - g) * (rim * 0.45)[..., None]
    return g

def disc(s, t, cs, ct, r_px, pxw, pxh):
    dx = (s - cs) * pxw; dy = (t - ct) * pxh
    return np.clip(r_px + 0.5 - np.sqrt(dx * dx + dy * dy), 0, 1)

def line_v(s, cs, w_px, pxw): return np.clip(w_px / 2 + 0.5 - np.abs(s - cs) * pxw, 0, 1)
def line_h(t, ct, w_px, pxh): return np.clip(w_px / 2 + 0.5 - np.abs(t - ct) * pxh, 0, 1)

for f in faces:
    kind = f['kind']
    if kind in (None, 'screen'): continue
    sl, s, t, wy, wx, pxw, pxh = coords(f)
    if s.size == 0: continue
    R = T[sl]
    nz = NOISE[sl]
    front = f['ax'] == 'z' and f['sign'] > 0
    back = f['ax'] == 'z' and f['sign'] < 0
    side = f['ax'] == 'x'
    sz = f['size']
    if kind == 'shirt':
        p = PAL['shirt']
        collar = f['bone'] == 'chest' and sz[1] < 0.2 and sz[2] < 0.2
        cuff = f['bone'].startswith('forearm')
        base = p['white'] if (collar or cuff) else p['base']
        R[..., :3] = shade(f, s, t, wy, pxw, pxh, base, p['dark'], p['light'])
        # fabric: a fine weave
        weave = ((np.indices(s.shape)[0] + np.indices(s.shape)[1]) % 2) * 2 - 1
        R[..., :3] += (weave * 2.2 + nz * 2.5)[..., None]
        if collar:
            blend(R, line_h(t, 0.95, 1.2, pxh), p['seam'], 0.8)          # its lower edge
            if front:
                # the two collar points, folding down either side of the top button
                for side_s in (0.43, 0.57):
                    tri = np.clip(1 - np.abs(s - side_s) * pxw / (1.2 + t * 3.5), 0, 1) * (t > 0.15)
                    blend(R, tri, p['light'], 0.6)
                blend(R, line_v(s, 0.5, 1.2, pxw), p['seam'], 0.8)
        elif cuff:
            blend(R, line_h(t, 0.08, 1.2, pxh), p['seam'], 0.7)
            if side: blend(R, disc(s, t, 0.5, 0.55, 1.5, pxw, pxh), p['seam'], 0.9); blend(R, disc(s, t, 0.5, 0.55, 0.9, pxw, pxh), p['white'], 1)
        else:
            if front and f['bone'] in ('chest', 'upper_body', 'hips'):
                # the button placket down the middle, buttons on it
                pl = np.clip(1 - np.abs(s - 0.5) * pxw / 3.0, 0, 1)
                blend(R, (pl > 0) * 1.0, p['light'], 0.35)
                blend(R, line_v(s, 0.5 - 3.0 / pxw, 0.9, pxw), p['seam'], 0.55)
                blend(R, line_v(s, 0.5 + 3.0 / pxw, 0.9, pxw), p['seam'], 0.55)
                spacing = 0.30
                ph = (wy % spacing) / spacing
                near = np.minimum(ph, 1 - ph) * spacing * (pxh / max(1e-6, sz[1]))
                bt = np.clip(2.2 - np.sqrt(((s - 0.5) * pxw) ** 2 + near ** 2), 0, 1)
                blend(R, bt, p['seam'], 0.9)
                bt2 = np.clip(1.4 - np.sqrt(((s - 0.5) * pxw) ** 2 + near ** 2), 0, 1)
                blend(R, bt2, p['white'], 1.0)
                # chest pocket on the main chest panel
                if f['bone'] == 'chest' and sz[1] > 0.5:
                    pk = ((s > 0.64) & (s < 0.86) & (t > 0.28) & (t < 0.68)).astype(np.float32)
                    edge = pk - ((s > 0.64 + 1.2 / pxw) & (s < 0.86 - 1.2 / pxw) & (t > 0.28 + 1.2 / pxh) & (t < 0.68 - 1.2 / pxh))
                    blend(R, edge, p['seam'], 0.6)
                    blend(R, line_h(t, 0.36, 0.9, pxh) * pk, p['seam'], 0.4)
            if back and f['bone'] == 'chest' and sz[1] > 0.5:
                blend(R, line_h(t, 0.22, 1.0, pxh), p['seam'], 0.45)          # the yoke seam across the back
            if side and f['bone'] in ('chest', 'upper_body', 'hips'):
                blend(R, line_v(s, 0.5, 0.9, pxw), p['seam'], 0.35)           # side seams
            if f['bone'] in ('Right_Arm', 'Left_Arm', 'no_elbow', 'no_elbow2') and f['ax'] != 'y':
                # a couple of soft creases where the sleeve bunches
                for c in (0.35, 0.7):
                    blend(R, line_h(t, c + 0.04 * math.sin(c * 9), 1.4, pxh) * (0.5 + 0.5 * np.sin(s * 6.0)), p['dark'], 0.18)
    elif kind == 'pants':
        p = PAL['pants']
        R[..., :3] = shade(f, s, t, wy, pxw, pxh, p['base'], p['dark'], p['light'])
        twill = (((np.indices(s.shape)[0] + 2 * np.indices(s.shape)[1]) % 4) < 2) * 2 - 1
        R[..., :3] += (twill * 1.6 + nz * 1.8)[..., None]
        belt = f['bone'] == 'pelvis' and sz[1] > 0.25 and f['ax'] != 'y'
        if belt:
            b = PAL['belt']
            bm = (t < 0.42).astype(np.float32)
            blend(R, bm, b['base'], 1.0)
            blend(R, line_h(t, 0.06, 0.8, pxh) + line_h(t, 0.36, 0.8, pxh), b['light'], 0.5)
            ppu = pxw / max(1e-6, sz[0]) if f['ax'] == 'z' else 1   # pixels per unit across
            cx = np.abs(wx) * ppu                                    # pixels from his centre line
            if front:
                buckle = ((cx < 4.5) & (t < 0.44)).astype(np.float32)
                inner = ((cx < 2.8) & (t < 0.34) & (t > 0.1)).astype(np.float32)
                blend(R, buckle, b['buckle'], 1.0); blend(R, inner, b['bdark'], 1.0)
                blend(R, ((cx < 0.8) & (t < 0.34) & (t > 0.1)).astype(np.float32), b['buckle'], 1.0)
                blend(R, np.clip(1.4 - cx, 0, 1) * (t > 0.45), p['seam'], 0.6)   # the fly
            if f['ax'] == 'z':
                for lx in (-0.34, 0.34):
                    blend(R, np.clip(1.2 - np.abs(wx - lx) * ppu, 0, 1) * (t < 0.46), p['dark'], 0.8)   # belt loops
        if f['bone'] in ('Right_Leg', 'Left_Leg', 'lowerleg_R', 'lowerleg_L') and f['ax'] == 'z':
            blend(R, line_v(s, 0.5, 1.1, pxw), p['light'], 0.55)          # the pressed crease
        if f['bone'] in ('Right_Leg', 'Left_Leg') and side and sz[1] > 0.6:
            # pocket slit, slanting down from the waistband
            slit = np.clip(1.2 - np.abs((s - 0.25) - (t - 0.05) * 0.9) * pxw, 0, 1) * (t < 0.32) * (t > 0.02)
            blend(R, slit, p['seam'], 0.85)
        if f['bone'] in ('Right_Leg', 'Left_Leg', 'lowerleg_R', 'lowerleg_L') and side:
            blend(R, line_v(s, 0.5, 0.8, pxw), p['seam'], 0.4)            # outer seam
        if f['bone'] in ('lowerleg_R', 'lowerleg_L') and f['ax'] != 'y':
            blend(R, (t > 0.9).astype(np.float32), p['dark'], 0.5)        # the hem
    elif kind == 'shoe':
        p = PAL['shoe']
        R[..., :3] = shade(f, s, t, wy, pxw, pxh, p['base'], p['dark'], p['light'])
        R[..., :3] += (nz * 1.5)[..., None]
        if f['ax'] != 'y':
            blend(R, (t > 0.78).astype(np.float32), p['sole'], 0.9)        # the sole
            blend(R, line_h(t, 0.72, 0.8, pxh), p['light'], 0.35)          # the welt stitching
        if f['ax'] == 'y' and f['sign'] > 0:
            gloss = np.exp(-((s - 0.4) * 2.2) ** 2) * np.exp(-((t - 0.45) * 2.0) ** 2)   # a soft polish, not a spot
            blend(R, gloss, p['light'], 0.35)
            if f['bone'].startswith('foot') and sz[0] > 0.4 and sz[2] > 0.35:
                for k in range(3):                                         # laces
                    blend(R, line_h(t, 0.25 + k * 0.2, 0.9, pxh) * (np.abs(s - 0.5) < 0.22), hexc('#8a7360'), 0.85)
        if front and f['bone'].startswith('toe'):
            blend(R, np.exp(-((t - 0.2) * 5) ** 2) * (t < 0.7), p['light'], 0.28)          # light catching the toe cap
    elif kind == 'metal':
        p = PAL['metal']
        R[..., :3] = shade(f, s, t, wy, pxw, pxh, p['base'], p['dark'], p['light'])
        R[..., :3] += (nz * 1.2)[..., None]
        bone = f['bone']
        if bone == 'fat_fucking_dome':
            if front:
                continue
            if back and pxw > 40:
                for k in range(6):                                          # vents
                    blend(R, line_h(t, 0.18 + k * 0.07, 1.4, pxh) * (np.abs(s - 0.5) < 0.32), p['dark'], 0.9)
                badge = ((np.abs(s - 0.5) < 0.16) & (t > 0.7) & (t < 0.84)).astype(np.float32)
                blend(R, badge, hexc('#c9d2d2'), 0.95)
                blend(R, ((np.abs(s - 0.5) < 0.12) & (np.abs(t - 0.77) < 0.02)).astype(np.float32), p['dark'], 0.9)
            if f['ax'] == 'y' and f['sign'] > 0 and pxw > 40:
                for k in range(5):
                    blend(R, line_v(s, 0.3 + k * 0.1, 1.4, pxw) * (np.abs(t - 0.6) < 0.18), p['dark'], 0.85)
            if side and pxw > 40:
                blend(R, line_h(t, 0.5, 1.0, pxh), p['dark'], 0.4)          # panel seam
                for cs in (0.15, 0.85):
                    blend(R, disc(s, t, cs, 0.15, 1.3, pxw, pxh) + disc(s, t, cs, 0.85, 1.3, pxw, pxh), p['bolt'], 0.9)
        elif bone == 'neck':
            for k in range(4):
                blend(R, line_h(t, 0.15 + k * 0.23, 1.2, pxh), p['dark'], 0.7)   # ribbed segments
                blend(R, line_h(t, 0.2 + k * 0.23, 0.8, pxh), p['light'], 0.4)
        elif bone.startswith('hand'):
            if pxw > 12 and pxh > 8:
                blend(R, line_v(s, 0.5, 0.9, pxw), p['dark'], 0.55)
                blend(R, disc(s, t, 0.2, 0.25, 1.0, pxw, pxh) + disc(s, t, 0.8, 0.25, 1.0, pxw, pxh), p['bolt'], 0.9)
            elif pxh > 4:
                for k in range(1, 4):
                    blend(R, line_v(s, k / 4, 0.8, pxw), p['dark'], 0.6)     # finger joints

T = np.clip(T, 0, 255).astype(np.uint8)
img = Image.fromarray(T, 'RGBA')
img.save(out_png)
# write it back into the model
bio = io.BytesIO(); img.save(bio, 'PNG', optimize=True)
d['images'][0]['uri'] = 'data:image/png;base64,' + base64.b64encode(bio.getvalue()).decode()
json.dump(d, open(out_gltf, 'w'), separators=(',', ':'))
print('faces painted', sum(1 for f in faces if f['kind'] not in (None, 'screen')), 'png bytes', len(bio.getvalue()))
