import cv2, numpy as np, os, sys, pickle, time
S = sys.argv[1]; ZOOM = float(sys.argv[2]); OUT = sys.argv[3]
SEAM_SCALE = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2
MARGIN = 0.03
CUTS = {3: 2150, 5: 2198, 7: 2200}  # drop rows below (canvas y at zoom 1.1)
COND_CUTS = {1: (1705, 0)}  # drop rows below y only where image j already covers
CUTS_TOP = {0: 1705}  # drop rows above
LAMBDA = float(sys.argv[5]) if len(sys.argv) > 5 else 2.0
sol = pickle.load(open(os.path.join(S, 'work', 'solution.pkl'), 'rb'))
names, sizes, Hs = sol['names'], sol['sizes'], sol['Hs']; N = len(names)
# canvas
allc = []
for i in range(N):
    w, h = sizes[i]
    c = cv2.perspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2), Hs[i]).reshape(-1, 2)
    allc.append(c)
allc = np.vstack(allc); x0, y0 = allc.min(0); x1, y1 = allc.max(0)
Z = np.array([[ZOOM, 0, -x0 * ZOOM], [0, ZOOM, -y0 * ZOOM], [0, 0, 1]])
CW, CH = int(np.ceil((x1 - x0) * ZOOM)), int(np.ceil((y1 - y0) * ZOOM))
print('canvas', CW, CH)
imgs, masks, corners, szs = [], [], [], []
t = time.time()
for i in range(N):
    im = cv2.imread(os.path.join(S, 'in', names[i])); w, h = sizes[i]
    Ht = Z @ Hs[i]
    c = cv2.perspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2), Ht).reshape(-1, 2)
    rx0, ry0 = np.floor(c.min(0)).astype(int); rx1, ry1 = np.ceil(c.max(0)).astype(int)
    rx0, ry0 = max(rx0, 0), max(ry0, 0); rx1, ry1 = min(rx1, CW), min(ry1, CH)
    T = np.array([[1, 0, -rx0], [0, 1, -ry0], [0, 0, 1.0]])
    rw, rh = rx1 - rx0, ry1 - ry0
    # local scale of this image on the canvas (at center)
    J = cv2.perspectiveTransform(np.float32([[w / 2, h / 2], [w / 2 + 1, h / 2], [w / 2, h / 2 + 1]]).reshape(-1, 1, 2), Ht).reshape(-1, 2)
    sc = np.sqrt(abs(np.linalg.det(np.c_[J[1] - J[0], J[2] - J[0]])))
    interp = cv2.INTER_LANCZOS4 if sc >= 1 else cv2.INTER_AREA
    wi = cv2.warpPerspective(im, T @ Ht, (rw, rh), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
    src_mask = np.full((h, w), 255, np.uint8)
    mx = int(round(MARGIN * w)); src_mask[:, :mx] = 0; src_mask[:, w - mx:] = 0
    m = cv2.warpPerspective(src_mask, T @ Ht, (rw, rh), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)
    m = cv2.erode(m, np.ones((5, 5), np.uint8))
    if i in CUTS:
        yc = int(round(CUTS[i] * ZOOM / 1.1)) - ry0
        if yc < rh: m[max(yc, 0):, :] = 0
    if i in COND_CUTS:
        yc_c, j = COND_CUTS[i]; yc = int(round(yc_c * ZOOM / 1.1)) - ry0
        if yc < rh:
            other = np.zeros((rh, rw), np.uint8)
            jx, jy = corners[j]; jm = masks[j]
            ox0, oy0 = max(rx0, jx), max(ry0, jy); ox1, oy1 = min(rx1, jx + jm.shape[1]), min(ry1, jy + jm.shape[0])
            if ox1 > ox0 and oy1 > oy0:
                other[oy0 - ry0:oy1 - ry0, ox0 - rx0:ox1 - rx0] = jm[oy0 - jy:oy1 - jy, ox0 - jx:ox1 - jx]
            sub = m[max(yc, 0):]; sub[other[max(yc, 0):] > 0] = 0
    if i in CUTS_TOP:
        yc = int(round(CUTS_TOP[i] * ZOOM / 1.1)) - ry0
        if yc > 0: m[:min(yc, rh), :] = 0
    imgs.append(wi); masks.append(m); corners.append((rx0, ry0)); szs.append((rw, rh))
    print(f'{names[i]}: roi {rw}x{rh} at ({rx0},{ry0}) scale {sc:.3f}')
print('warp time', time.time() - t)

# exposure compensation (feed at low res, apply at full res)
t = time.time()
comp = cv2.detail.ExposureCompensator_createDefault(cv2.detail.ExposureCompensator_CHANNELS_BLOCKS)
ES = 0.25
e_imgs = [cv2.resize(im, None, fx=ES, fy=ES, interpolation=cv2.INTER_AREA) for im in imgs]
e_masks = [cv2.resize(m, (ei.shape[1], ei.shape[0]), interpolation=cv2.INTER_NEAREST) for m, ei in zip(masks, e_imgs)]
e_corners = [(int(c[0] * ES), int(c[1] * ES)) for c in corners]
comp.feed(e_corners, e_imgs, e_masks)
for i in range(N):
    imgs[i] = comp.apply(i, corners[i], imgs[i], masks[i])
print('exposure time', time.time() - t)

# seam finding at low res
t = time.time()
s_imgs = [cv2.resize(im, None, fx=SEAM_SCALE, fy=SEAM_SCALE, interpolation=cv2.INTER_AREA).astype(np.float32) for im in imgs]
s_masks = [cv2.resize(m, (si.shape[1], si.shape[0]), interpolation=cv2.INTER_NEAREST) for m, si in zip(masks, s_imgs)]
s_corners = [(int(round(c[0] * SEAM_SCALE)), int(round(c[1] * SEAM_SCALE))) for c in corners]
FRAMES = [1828, 2697, 4429]   # canvas x of the frames between the shelves (zoom 1.1)
HOME = {0: (-1e9, FRAMES[0]), 1: (-1e9, FRAMES[0]), 2: (FRAMES[0], FRAMES[1]), 3: (FRAMES[0], FRAMES[1]),
        4: (FRAMES[1], FRAMES[2]), 5: (FRAMES[1], FRAMES[2]), 6: (FRAMES[2], 1e9), 7: (FRAMES[2], 1e9)}
for k in range(N):
    mk = (s_masks[k] > 0)
    hh, ww = mk.shape
    xs = (np.arange(ww) + s_corners[k][0]) / SEAM_SCALE * 1.1 / ZOOM   # canvas-1.1 coordinates
    xa, xb = HOME[k]
    outside = np.maximum(0, np.maximum(xa - xs, xs - xb))               # px outside the home range
    pen_x = np.minimum(outside / 300.0, 1.0) * 255.0 * LAMBDA
    # vertical centrality: distance to the top/bottom border of the mask (per column)
    top = np.cumsum(mk, axis=0) - 1; bot = np.cumsum(mk[::-1], axis=0)[::-1] - 1
    dy = np.minimum(top, bot).astype(np.float32); dy[~mk] = 0
    pen_y = (1.0 - dy / max(dy.max(), 1e-6)) * 255.0 * LAMBDA * 0.5
    s_imgs[k] = s_imgs[k] + (pen_x[None, :] + pen_y)[:, :, None].astype(np.float32)
finder = cv2.detail_GraphCutSeamFinder('COST_COLOR')
s_masks = finder.find(s_imgs, s_corners, s_masks)
s_masks = [np.asarray(m.get() if hasattr(m, 'get') else m) for m in s_masks]
print('seam time', time.time() - t)

# blend
t = time.time()
blender = cv2.detail_MultiBandBlender()
blender.setNumBands(6)
blender.prepare((0, 0, CW, CH))
for i in range(N):
    sm = cv2.dilate(s_masks[i], np.ones((3, 3), np.uint8))
    sm = cv2.resize(sm, (masks[i].shape[1], masks[i].shape[0]), interpolation=cv2.INTER_LINEAR)
    m = cv2.bitwise_and(masks[i], sm)
    blender.feed(cv2.UMat(imgs[i].astype(np.int16)), cv2.UMat(m), corners[i])
    imgs[i] = None
result, result_mask = blender.blend(None, None)
result = np.asarray(result.get() if hasattr(result, 'get') else result)
result_mask = np.asarray(result_mask.get() if hasattr(result_mask, 'get') else result_mask)
result = np.clip(result, 0, 255).astype(np.uint8)
print('blend time', time.time() - t, result.shape)
cv2.imwrite(OUT, result, [cv2.IMWRITE_PNG_COMPRESSION, 1])
np.save(OUT + '.mask.npy', result_mask)
pickle.dump(dict(Z=Z, canvas=(CW, CH), corners=corners, szs=szs), open(OUT + '.meta.pkl', 'wb'))
