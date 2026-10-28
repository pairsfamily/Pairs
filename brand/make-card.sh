#!/usr/bin/env bash
# The X / link-preview card (web/public/og.png, 1200x630), dark: the operator's emblem (brand/logo-emblem.png, 28 Oct 2026:
# tile + glow on flat #161614, so the card uses that same background) over the wordmark lifted from the operator's banner (brand/og-banner.png, black
# lettering on paper) and inked light. Run from the repo root.
set -euo pipefail
OUT=web/public/og.png
T="$(mktemp -d)"
BG='#161614'; INK='#f2f3f0'
# wordmark: banner rows 262..392, paper → transparent, lettering → light ink (the glow and the tile shadow fall below 25%)
magick brand/og-banner.png -crop 1200x130+0+262 +repage -colorspace gray -negate -level 25%,80% -trim +repage "$T/wm-mask.png"
magick "$T/wm-mask.png" -fill "$INK" -colorize 100 "$T/wm-mask.png" -alpha off -compose CopyOpacity -composite "$T/wm.png"
magick -size 1200x630 "xc:$BG" \
  \( brand/logo-emblem.png -resize 300x300 \) -gravity north -geometry +0+92 -composite \
  "$T/wm.png" -gravity north -geometry +0+392 -composite -strip "$OUT"
rm -rf "$T"
echo "card written to $OUT"
