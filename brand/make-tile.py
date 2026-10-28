# The small logo (brand/logo-tile.png) from the operator's emblem (brand/logo-emblem.png, 28 Oct 2026: the pills on a dark
# app-icon tile with a green glow, on flat #161614). Favicons and the header mark are too small for the glow, so the
# tile alone is cut out (measured box 87..412 x 69..408, cut 3px inside it so no glow shows at the rim) with rounded corners made transparent. Needs Pillow.
#   python3 brand/make-tile.py
from PIL import Image, ImageDraw

BOX, RADIUS, SCALE = (90, 72, 410, 406), 0.30, 4
src = Image.open('brand/logo-emblem.png').convert('RGBA').crop(BOX)
w, h = src.size
mask = Image.new('L', (w * SCALE, h * SCALE), 0)  # drawn 4x and scaled down: smooth corners
ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * SCALE - 1, h * SCALE - 1), radius=int(min(w, h) * RADIUS * SCALE), fill=255)
src.putalpha(mask.resize((w, h), Image.LANCZOS))
side = max(w, h)
out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
out.paste(src, ((side - w) // 2, (side - h) // 2), src)
out.save('brand/logo-tile.png')
print('brand/logo-tile.png written')
