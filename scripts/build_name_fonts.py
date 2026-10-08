"""Package local name fonts as small WOFF2 subsets; preserve source/notice metadata."""
from pathlib import Path
import hashlib
import json
import shutil
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets' / 'fonts'
SOURCES = [
    ('eb-garamond', 'TM Garamond', '/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Regular.ttf', 'fonts-ebgaramond', 400),
    *[(name, 'TM ' + name.capitalize(), f'/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyre{name}-{style}.otf', 'fonts-texgyre', weight)
      for name in ('pagella', 'termes', 'schola', 'bonum') for style, weight in (('regular', 400), ('bold', 700))],
    *[('noto-serif', 'TM Noto Serif', f'/usr/share/fonts/truetype/noto/NotoSerif-{style}.ttf', 'fonts-noto-core', weight)
      for style, weight in (('Regular', 400), ('Bold', 700))],
    *[('liberation-serif', 'TM Classic Serif', f'/usr/share/fonts/truetype/liberation2/LiberationSerif-{style}.ttf', 'fonts-liberation2', weight)
      for style, weight in (('Regular', 400), ('Bold', 700))],
    *[('dejavu-serif', 'TM DejaVu Serif', f'/usr/share/fonts/truetype/dejavu/DejaVuSerif{suffix}.ttf', 'fonts-dejavu-core', weight)
      for suffix, weight in (('', 400), ('-Bold', 700))],
    ('stzhongsong', 'TM STZhongsong', '/home/maoting/.local/share/fonts/STZHONGS.TTF', None, 400),
]


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'licenses').mkdir(exist_ok=True)
    css, manifest = [], []
    latin = list(range(0x20, 0x250)) + list(range(0x2000, 0x2070))
    for identifier, family, source, package, weight in SOURCES:
        path = Path(source)
        font = TTFont(path)
        fs_type = font['OS/2'].fsType
        if fs_type & (2 | 256 | 512):
            raise ValueError(f'Font does not permit this subset embedding: {path}')
        notices = sorted({record.toUnicode() for record in font['name'].names if record.nameID in (0, 13, 14)})
        style = 'Bold' if weight == 700 else 'Regular'
        postscript = family.replace(' ', '') + '-' + style
        for record in list(font['name'].names):
            names = {1: family, 2: style, 3: postscript, 4: family + ' ' + style, 6: postscript, 16: family, 17: style}
            if record.nameID in names:
                font['name'].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
        if 'CFF ' in font:
            cff = font['CFF '].cff
            cff.fontNames = [postscript]
            cff.topDictIndex[0].FamilyName = family
            cff.topDictIndex[0].FullName = family + ' ' + style
        options = subset.Options()
        options.name_IDs = ['*']
        options.name_legacy = True
        options.name_languages = ['*']
        cutter = subset.Subsetter(options=options)
        cutter.populate(unicodes=[ord(char) for char in '毛挺'] if identifier == 'stzhongsong' else latin)
        cutter.subset(font)
        font.flavor = 'woff2'
        target = OUTPUT / f'{identifier}-{weight}.woff2'
        font.save(target)
        unicode_range = '\n  unicode-range: U+6BDB, U+633A;' if identifier == 'stzhongsong' else ''
        css.append(f'@font-face {{\n  font-family: "{family}";\n  src: url("{target.name}") format("woff2");\n  font-style: normal;\n  font-weight: {weight};\n  font-display: swap;{unicode_range}\n}}\n')
        if package:
            shutil.copyfile(f'/usr/share/doc/{package}/copyright', OUTPUT / 'licenses' / f'{package}.txt')
        else:
            (OUTPUT / 'licenses' / 'stzhongsong-source-notice.txt').write_text('\n\n'.join(notices) + '\n')
        manifest.append({'id': identifier, 'family': family, 'weight': weight, 'source': str(path), 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'fsType': fs_type, 'file': target.name,
                         'coverage': '毛挺' if identifier == 'stzhongsong' else 'Latin, extended Latin and general punctuation',
                         'notice': f'licenses/{package}.txt' if package else 'licenses/stzhongsong-source-notice.txt'})
    (OUTPUT / 'fonts.css').write_text('\n'.join(css))
    (OUTPUT / 'sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Built {len(manifest)} name font subsets ({sum(file.stat().st_size for file in OUTPUT.glob("*.woff2")):,} bytes)')


if __name__ == '__main__':
    main()
