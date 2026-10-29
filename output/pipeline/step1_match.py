import cv2, numpy as np, glob, os, sys, itertools, pickle, time
S = sys.argv[1]
files = sorted(glob.glob(os.path.join(S, 'in', '*.jpg')))
names = [os.path.basename(f) for f in files]
imgs = [cv2.imread(f) for f in files]
for n, im in zip(names, imgs): print(n, im.shape)
sift = cv2.SIFT_create(nfeatures=12000, contrastThreshold=0.03)
kps, descs = [], []
t = time.time()
for im in imgs:
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)
    kp, de = sift.detectAndCompute(g, None)
    kps.append(np.float32([k.pt for k in kp])); descs.append(de)
    print('features', len(kp))
print('sift time', time.time() - t)
bf = cv2.BFMatcher(cv2.NORM_L2)
N = len(imgs)
pairs = {}
inl = np.zeros((N, N), int)
for i, j in itertools.combinations(range(N), 2):
    m = bf.knnMatch(descs[i], descs[j], k=2)
    good = [a for a, b in m if a.distance < 0.75 * b.distance]
    # mutual check
    m2 = bf.knnMatch(descs[j], descs[i], k=2)
    good2 = {(a.trainIdx, a.queryIdx) for a, b in m2 if a.distance < 0.75 * b.distance}
    good = [a for a in good if (a.queryIdx, a.trainIdx) in good2]
    if len(good) < 20:
        print(i + 1, j + 1, 'few matches', len(good)); continue
    p1 = kps[i][[a.queryIdx for a in good]]; p2 = kps[j][[a.trainIdx for a in good]]
    H, mask = cv2.findHomography(p1, p2, cv2.USAC_MAGSAC, 4.0, maxIters=20000, confidence=0.9999)
    if H is None: continue
    k = int(mask.sum()); inl[i, j] = inl[j, i] = k
    print(i + 1, j + 1, 'matches', len(good), 'inliers', k)
    if k >= 40:
        pairs[(i, j)] = dict(H=H, p1=p1[mask.ravel() == 1], p2=p2[mask.ravel() == 1])
print(inl)
pickle.dump(dict(names=names, shapes=[im.shape for im in imgs], pairs=pairs, inl=inl), open(os.path.join(S, 'work', 'pairs.pkl'), 'wb'))
