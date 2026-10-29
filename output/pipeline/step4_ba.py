import cv2, numpy as np, os, sys, pickle, time
from scipy.optimize import least_squares
S = sys.argv[1]
F0 = 1450.0
P = pickle.load(open(os.path.join(S, 'work', 'pairs.pkl'), 'rb'))
V = pickle.load(open(os.path.join(S, 'work', 'vps.pkl'), 'rb'))
LN = pickle.load(open(os.path.join(S, 'work', 'lines.pkl'), 'rb'))
names = P['names']; N = len(names); sizes = [(s[1], s[0]) for s in P['shapes']]
REF = 0

def Kmat(f, w, h): return np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1.0]])

def H_of(params_i, f, i):
    rv, s, tx, ty = params_i[:3], params_i[3], params_i[4], params_i[5]
    w, h = sizes[i]; K = Kmat(f, w, h)
    R, _ = cv2.Rodrigues(rv)
    Sm = np.array([[s, 0, tx], [0, s, ty], [0, 0, 1.0]])
    return Sm @ K @ R.T @ np.linalg.inv(K)

def proj(H, pts):
    q = pts @ H[:, :2].T + H[:, 2]
    return q[:, :2] / q[:, 2:3]

# ---- init rotations from VPs (computed at F0) and similarities by chaining
rvs = [cv2.Rodrigues(V[n]['Rc'])[0].ravel() for n in names]
Hrect = [H_of(np.r_[rvs[i], 1, 0, 0], F0, i) for i in range(N)]
# pairwise similarity in rectified coords: P_j = s*P_i + t
pair_sim = {}
for (i, j), d in P['pairs'].items():
    Pi = proj(Hrect[i], d['p1']); Pj = proj(Hrect[j], d['p2'])
    A = np.zeros((2 * len(Pi), 3)); b = np.zeros(2 * len(Pi))
    A[0::2, 0] = Pi[:, 0]; A[0::2, 1] = 1; b[0::2] = Pj[:, 0]
    A[1::2, 0] = Pi[:, 1]; A[1::2, 2] = 1; b[1::2] = Pj[:, 1]
    x, *_ = np.linalg.lstsq(A, b, rcond=None)
    r = A @ x - b; rms = np.sqrt((r ** 2).mean())
    pair_sim[(i, j)] = x; pair_sim[(j, i)] = np.array([1 / x[0], -x[1] / x[0], -x[2] / x[0]])
    print(f'pair {i+1}-{j+1}: n={len(Pi)} scale={x[0]:.4f} t=({x[1]:.0f},{x[2]:.0f}) rms={rms:.2f}')
# spanning tree from REF by inlier count (greedy BFS on max weight)
sim = [None] * N; sim[REF] = np.array([1.0, 0, 0]); done = {REF}
while len(done) < N:
    best = None
    for (i, j), x in pair_sim.items():
        if i in done and j not in done:
            w = P['inl'][i, j]
            if best is None or w > best[0]: best = (w, i, j)
    w, i, j = best
    si = sim[i]; x = pair_sim[(i, j)]  # P_j = x0*P_i + t ; plane = si0*P_i + si_t  => P_i = (plane - si_t)/si0
    # plane coords from j: plane = si0 * ((P_j - t)/x0) + si_t = (si0/x0) P_j + (si_t - si0*t/x0)
    sim[j] = np.array([si[0] / x[0], si[1] - si[0] * x[1] / x[0], si[2] - si[0] * x[2] / x[0]]); done.add(j)
    print(f'chain {i+1}->{j+1} (inl {w})')
params0 = np.concatenate([np.r_[rvs[i], sim[i]] for i in range(N)] + [[F0]])

# ---- residuals
match_list = [(i, j, d['p1'], d['p2']) for (i, j), d in P['pairs'].items()]
line_list = []
for i, n in enumerate(names):
    for kind, segs in (('v', LN[n]['vert']), ('h', LN[n]['horz'])):
        L = np.linalg.norm(segs[:, 2:] - segs[:, :2], axis=1)
        segs = segs[L >= 150]; L = L[L >= 150]
        line_list.append((i, kind, segs[:, :2].copy(), segs[:, 2:].copy(), np.sqrt(300.0 / L)))
nm = sum(len(m[2]) for m in match_list); nl = sum(len(l[2]) for l in line_list)
print('match pts', nm, 'line segs', nl)
WL = 1.0

def unpack(x):
    f = x[-1]; ps = x[:-1].reshape(N, 6).copy()
    ps[REF, 3:] = [1, 0, 0]
    return ps, f

def residuals(x):
    ps, f = unpack(x)
    Hs = [H_of(ps[i], f, i) for i in range(N)]
    out = []
    for i, j, p1, p2 in match_list:
        out.append((proj(Hs[i], p1) - proj(Hs[j], p2)).ravel())
    for i, kind, a, b, wgt in line_list:
        A = proj(Hs[i], a); B = proj(Hs[i], b)
        d = (A[:, 0] - B[:, 0]) if kind == 'v' else (A[:, 1] - B[:, 1])
        out.append(WL * wgt * d)
    return np.concatenate(out)

def report(x, tag):
    r = residuals(x); rm = r[:2 * nm].reshape(-1, 2); rl = r[2 * nm:]
    em = np.linalg.norm(rm, axis=1)
    print(f'{tag}: match err median {np.median(em):.2f} mean {em.mean():.2f} p90 {np.percentile(em, 90):.2f} | line |res| median {np.median(np.abs(rl)):.2f} p90 {np.percentile(np.abs(rl), 90):.2f} | f={x[-1]:.0f}')
    k = 0
    for i, j, p1, p2 in match_list:
        e = em[k:k + len(p1)]; k += len(p1)
        print(f'   pair {i+1}-{j+1}: median {np.median(e):.2f} p90 {np.percentile(e, 90):.2f}')

report(params0, 'init')
mask_fixed = np.ones_like(params0, bool); mask_fixed[REF * 6 + 3: REF * 6 + 6] = False
lb = np.full_like(params0, -np.inf); ub = np.full_like(params0, np.inf); lb[-1] = 900; ub[-1] = 3000
t = time.time()
res = least_squares(residuals, params0, loss='cauchy', f_scale=4.0, x_scale='jac', bounds=(lb, ub), max_nfev=300, verbose=0)
print('BA time', time.time() - t, res.status, res.message)
report(res.x, 'final')
ps, f = unpack(res.x)
Hs = [H_of(ps[i], f, i) for i in range(N)]
pickle.dump(dict(names=names, sizes=sizes, Hs=Hs, f=f, params=ps), open(os.path.join(S, 'work', 'solution.pkl'), 'wb'))
