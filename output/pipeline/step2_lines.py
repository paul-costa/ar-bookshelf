import cv2, numpy as np, glob, os, sys, pickle
S = sys.argv[1]
files = sorted(glob.glob(os.path.join(S, 'in', '*.jpg')))
names = [os.path.basename(f) for f in files]
out = {}
for f, n in zip(files, names):
    im = cv2.imread(f); h, w = im.shape[:2]
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    fld = cv2.ximgproc.createFastLineDetector(length_threshold=60, distance_threshold=1.414, canny_th1=40, canny_th2=120, canny_aperture_size=3, do_merge=True)
    segs = fld.detect(g)
    segs = segs.reshape(-1, 4) if segs is not None else np.zeros((0, 4))
    d = segs[:, 2:] - segs[:, :2]; L = np.hypot(d[:, 0], d[:, 1])
    ang = np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 180  # 0=horizontal, 90=vertical
    vert = segs[(np.abs(ang - 90) < 25) & (L >= 80)]
    horz = segs[((ang < 25) | (ang > 155)) & (L >= 80)]
    print(n, 'segments', len(segs), 'vert', len(vert), 'horz', len(horz), 'longest', L.max())
    out[n] = dict(vert=vert, horz=horz, size=(w, h))
    vis = im.copy()
    for x1, y1, x2, y2 in vert: cv2.line(vis, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
    for x1, y1, x2, y2 in horz: cv2.line(vis, (int(x1), int(y1)), (int(x2), int(y2)), (0, 0, 255), 2)
    cv2.imwrite(os.path.join(S, 'work', 'lines_' + n), cv2.resize(vis, None, fx=0.5, fy=0.5))
pickle.dump(out, open(os.path.join(S, 'work', 'lines.pkl'), 'wb'))
