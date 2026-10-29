import cv2, numpy as np, os, sys
S = sys.argv[1]; SRC = sys.argv[2]; OUTDIR = sys.argv[3]
X0, Y0, X1, Y1 = 505, 100, 5290, 4400
im = cv2.imread(SRC); mask = np.load(SRC + '.mask.npy')
im = im[Y0:Y1, X0:X1]; mask = mask[Y0:Y1, X0:X1]
unc = (mask == 0)
print('crop', im.shape, 'uncovered', unc.sum(), f'({100*unc.mean():.1f}%)')
# fill uncovered areas with the dark shelf colour (+ mild noise), feathered at the border
rng = np.random.default_rng(1)
board = im[2055:2095, 2245:4745].reshape(-1, 3); fc = np.median(board, axis=0).astype(np.float32); print('fill colour BGR', fc)
fill = fc[None, None, :] + rng.normal(0, 2.5, im.shape).astype(np.float32)
w = cv2.GaussianBlur(unc.astype(np.float32), (0, 0), 2.0)[:, :, None]
out = im.astype(np.float32) * (1 - w) + np.clip(fill, 0, 255) * w
# unsharp mask with soft threshold (does not amplify flat noise)
blur = cv2.GaussianBlur(out, (0, 0), 1.2)
detail = out - blur
luma = np.abs(detail).mean(axis=2, keepdims=True)
wgt = np.clip((luma - 1.5) / 4.0, 0, 1)
sharp = np.clip(out + 0.9 * detail * wgt, 0, 255).astype(np.uint8)
cv2.imwrite(os.path.join(OUTDIR, 'buecherregal_panorama.jpg'), sharp, [cv2.IMWRITE_JPEG_QUALITY, 95, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
cv2.imwrite(os.path.join(OUTDIR, 'buecherregal_panorama.png'), sharp, [cv2.IMWRITE_PNG_COMPRESSION, 6])
small = cv2.resize(sharp, None, fx=0.33, fy=0.33, interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(S, 'work', 'final_preview.jpg'), small, [cv2.IMWRITE_JPEG_QUALITY, 88])
# detail crops at 100 %
for name, (x, y) in {'det1': (1200, 1800), 'det2': (3300, 600), 'det3': (4300, 2700)}.items():
    cv2.imwrite(os.path.join(S, 'work', f'{name}.jpg'), sharp[y:y + 700, x:x + 1000], [cv2.IMWRITE_JPEG_QUALITY, 92])
print('done', sharp.shape)
