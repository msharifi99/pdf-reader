"""Turn the rendered mockups into what the panel can show: 8-bit grayscale, snapped to 16 levels (multiples of 17).
Run from the repo root after render.mjs:  python -I android-eink/docs/mockups/src/quantize.py"""
import glob
from PIL import Image

for p in glob.glob('android-eink/docs/mockups/*.png'):
    im = Image.open(p).convert('L').point(lambda v: round(v / 17) * 17)
    assert im.size == (758, 1024), (p, im.size)
    im.save(p, optimize=True)
    print(p, im.size)

# Launcher icons: grayscale + alpha, also snapped to 16 levels.
for p in glob.glob('android-eink/docs/icon/ic_launcher-*.png'):
    im = Image.open(p).convert('LA')
    l, a = im.split()
    Image.merge('LA', (l.point(lambda v: round(v / 17) * 17), a)).save(p, optimize=True)
    print(p, im.size)
