# The dark-theme logo (brand/logo-dark.png) from the operator's logo (brand/logo-source.png): on a dark page the pills'
# dark outline disappears, so the outline turns light, the white top halves turn charcoal, the green halves stay.
# Colours are mapped by lightness so the anti-aliased edges blend. Needs Pillow. Run from the repo root:
#   python3 brand/make-dark-logo.py
import colorsys
from PIL import Image

OUTLINE, SHADE, TOP = (235, 244, 239), (48, 56, 60), (30, 34, 38)

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

img = Image.open('brand/logo-source.png').convert('RGBA')
px = img.load()
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        _, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s > 0.25 and g > r + 40 and l > 0.3:  # the green halves
            continue
        if l > 0.6 and y > img.height * 0.52:  # the white highlight strokes on the green halves (below the divider)
            continue
        # dark outline (l ~0.22) .. grey shade (l ~0.77) .. white (l ~0.97)
        c = OUTLINE if l <= 0.22 else lerp(OUTLINE, SHADE, (l - 0.22) / 0.55) if l <= 0.77 else lerp(SHADE, TOP, min(1, (l - 0.77) / 0.2))
        px[x, y] = (*c, a)
img.save('brand/logo-dark.png')
print('brand/logo-dark.png written')
