import cv2, numpy as np, glob, os, sys, pickle
S = sys.argv[1]
F_GUESS = 1450.0
lines = pickle.load(open(os.path.join(S, 'work', 'lines.pkl'), 'rb'))
rng = np.random.default_rng(0)

def seg_lines(segs):
    a = np.c_[segs[:, :2], np.ones(len(segs))]; b = np.c_[segs[:, 2:], np.ones(len(segs))]
    l = np.cross(a, b); l /= np.linalg.norm(l[:, :2], axis=1, keepdims=True)
    mid = (segs[:, :2] + segs[:, 2:]) / 2; d = segs[:, 2:] - segs[:, :2]; L = np.linalg.norm(d, axis=1); d /= L[:, None]
    return l, mid, d, L

def vp_err(v, mid, d):
    if abs(v[2]) * 1e5 > np.linalg.norm(v[:2]):
        dirs = v[:2] / v[2] - mid
    else:
        dirs = np.tile(v[:2], (len(mid), 1))
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    cr = np.abs(dirs[:, 0] * d[:, 1] - dirs[:, 1] * d[:, 0]); dt = np.abs((dirs * d).sum(1))
    return np.degrees(np.arctan2(cr, dt))

def ransac_vp(segs, thr=2.0, iters=6000, minlen=150):
    segs = segs[np.linalg.norm(segs[:, 2:] - segs[:, :2], axis=1) >= minlen]
    l, mid, d, L = seg_lines(segs); n = len(segs)
    p = L ** 2 / (L ** 2).sum()
    best, bests = None, -1
    for _ in range(iters):
        i, j = rng.choice(n, 2, replace=False, p=p)
        v = np.cross(l[i], l[j])
        if np.linalg.norm(v) < 1e-9: continue
        e = vp_err(v, mid, d); s = (L ** 2 * np.clip(1 - (e / thr) ** 2, 0, None)).sum()
        if s > bests: bests, best = s, v
    e = vp_err(best, mid, d)
    return best, (e < thr).sum(), n

def rect_H(vv, vh, w, h, f):
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1.0]]); Ki = np.linalg.inv(K)
    d1 = Ki @ vh; d2 = Ki @ vv
    d1 /= np.linalg.norm(d1); d2 /= np.linalg.norm(d2)
    if d1[0] < 0: d1 = -d1
    if d2[1] < 0: d2 = -d2
    m = d1 + d2; m /= np.linalg.norm(m); q = d1 - d2; q /= np.linalg.norm(q)
    d1 = (m + q) / np.sqrt(2); d2 = (m - q) / np.sqrt(2); d3 = np.cross(d1, d2)
    Rc = np.c_[d1, d2, d3]
    return K @ Rc.T @ Ki, Rc

res = {}
tiles = []
for n, D in lines.items():
    w, h = D['size']
    vv, kv, nv = ransac_vp(D['vert']); vh, kh, nh = ransac_vp(D['horz'])
    def inhom(v): return np.round(v[:2] / v[2]) if abs(v[2]) * 1e5 > np.linalg.norm(v[:2]) else ('inf', np.round(v[:2] / np.linalg.norm(v[:2]), 3))
    print(n, 'vertVP', inhom(vv), f'({kv}/{nv})', 'horzVP', inhom(vh), f'({kh}/{nh})')
    H, Rc = rect_H(vv, vh, w, h, F_GUESS)
    res[n] = dict(vv=vv, vh=vh, H=H, Rc=Rc)
    # preview: warp into a canvas keeping the image center fixed
    im = cv2.imread(os.path.join(S, 'in', n))
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    pc = cv2.perspectiveTransform(corners, H).reshape(-1, 2)
    x0, y0 = pc.min(0); x1, y1 = pc.max(0)
    sc = 0.35
    T = np.array([[sc, 0, -x0 * sc], [0, sc, -y0 * sc], [0, 0, 1]])
    out = cv2.warpPerspective(im, T @ H, (int((x1 - x0) * sc) + 1, int((y1 - y0) * sc) + 1))
    # draw grid
    for x in range(0, out.shape[1], 100): cv2.line(out, (x, 0), (x, out.shape[0]), (0, 255, 255), 1)
    for y in range(0, out.shape[0], 100): cv2.line(out, (0, y), (out.shape[1], y), (0, 255, 255), 1)
    cv2.imwrite(os.path.join(S, 'work', 'rect_' + n), out)
    tiles.append(out)
pickle.dump(res, open(os.path.join(S, 'work', 'vps.pkl'), 'wb'))
