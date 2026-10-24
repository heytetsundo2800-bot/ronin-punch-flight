# アイコンの案を1枚の表にする：python3 tools/assets/icons17_sheet.py 撮ったフォルダ 出力.png
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1]; out = sys.argv[2]
meta = json.load(open(os.path.join(D, 'meta.json')))
T = 230; small = 60; cols = 4
font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 22)
fb = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc', 30)
def rounded(im, size, r):
    im = im.resize((size, size), Image.LANCZOS).convert('RGBA')
    m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), r * 4, fill=255)
    im.putalpha(m.resize((size, size), Image.LANCZOS))
    return im
rows = (len(meta) + cols - 1) // cols
cw, ch = T + 40, T + 132
W = cols * cw + 40; H = 90 + rows * ch + 20
sheet = Image.new('RGB', (W, H), (238, 241, 247))
d = ImageDraw.Draw(sheet)
d.text((24, 22), 'アプリのアイコンの案（番号で教えてください）　右下の小さい絵＝ホーム画面での大きさ', fill=(20, 33, 61), font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc', 24))
for i, m in enumerate(meta):
    im = Image.open(m['file'])
    x = 20 + (i % cols) * cw + 20; y = 90 + (i // cols) * ch
    big = rounded(im, T, int(T * 0.225))
    sheet.paste(big, (x, y), big)
    sm = rounded(im, small, int(small * 0.225))
    sheet.paste(sm, (x + T - small, y + T + 12), sm)
    d.text((x, y + T + 8), f"{m['n']}", fill=(20, 33, 61), font=fb)
    d.text((x, y + T + 80), m["title"], fill=(60, 70, 90), font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 17))
sheet.save(out, quality=92)
print(out, sheet.size)
