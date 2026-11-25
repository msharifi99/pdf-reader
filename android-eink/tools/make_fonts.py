"""Build the static TTFs the e-ink app bundles, from the OFL fonts already in the repo's node_modules.

Android 4.2 cannot load variable fonts or WOFF2, so we pin each variable font to static instances
(fontTools.varLib.instancer), merge the latin + latin-ext subsets into one file, and save plain TTF.
Run from the repo root:  python -I android-eink/tools/make_fonts.py
Needs: pip install fonttools brotli
"""
import io, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.merge import Merger

NM = 'node_modules'
OUT = 'android-eink/app/src/main/assets/fonts'
SUBSETS = ['latin', 'latin-ext']


def load(path, axes=None):
    f = TTFont(path)
    if axes:
        f = instancer.instantiateVariableFont(f, axes, updateFontNames=False)
    f.flavor = None
    buf = io.BytesIO(); f.save(buf); buf.seek(0)  # round-trip so Merger sees a plain TTF
    return buf


def build(out, paths, axes, family, style):
    merged = Merger().merge([load(p, axes) for p in paths])
    name = merged['name']
    for rec in list(name.names):
        if rec.nameID in (1, 2, 4, 6, 16, 17):
            name.removeNames(nameID=rec.nameID)
    full = f'{family} {style}'
    name.setName(family, 1, 3, 1, 0x409); name.setName(style, 2, 3, 1, 0x409)
    name.setName(full, 4, 3, 1, 0x409); name.setName(full.replace(' ', '-'), 6, 3, 1, 0x409)
    merged.flavor = None
    merged.save(os.path.join(OUT, out))
    print(out, os.path.getsize(os.path.join(OUT, out)))


os.makedirs(OUT, exist_ok=True)
lit = f'{NM}/@fontsource-variable/literata/files/literata-%s-standard-%s.woff2'
inter = f'{NM}/@fontsource-variable/inter/files/inter-%s-opsz-normal.woff2'
atk = f'{NM}/@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-%s-%s-%s.woff'

# Literata: text optical size (opsz 12) for reading and UI display titles.
for out, w, st, style in [('Literata-Regular.ttf', 400, 'normal', 'Regular'),
                          ('Literata-Italic.ttf', 400, 'italic', 'Italic'),
                          ('Literata-SemiBold.ttf', 600, 'normal', 'SemiBold'),
                          ('Literata-Bold.ttf', 700, 'normal', 'Bold'),
                          ('Literata-BoldItalic.ttf', 700, 'italic', 'Bold Italic')]:
    build(out, [lit % (s, st) for s in SUBSETS], {'opsz': 12, 'wght': w}, 'Literata', style)

# Inter: UI. opsz 14 (text size), 400 and 500 only (DESIGN.md: never bold 700 in UI; 600 drawn as 500 on e-ink).
for out, w, style in [('Inter-Regular.ttf', 400, 'Regular'), ('Inter-Medium.ttf', 500, 'Medium')]:
    build(out, [inter % s for s in SUBSETS], {'opsz': 14, 'wght': w}, 'Inter', style)

# Atkinson Hyperlegible Next: the legibility reading option. Already static in fontsource.
for out, w, st, style in [('AtkinsonHyperlegibleNext-Regular.ttf', 400, 'normal', 'Regular'),
                          ('AtkinsonHyperlegibleNext-Italic.ttf', 400, 'italic', 'Italic'),
                          ('AtkinsonHyperlegibleNext-Bold.ttf', 700, 'normal', 'Bold')]:
    build(out, [atk % (s, w, st) for s in SUBSETS], None, 'Atkinson Hyperlegible Next', style)

total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith('.ttf'))
print('total', total)
assert total < 1_500_000, 'font budget exceeded'
