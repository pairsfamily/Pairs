#!/usr/bin/env bash
# The X / link-preview card (web/public/og.png, 1200x630): the operator's banner (brand/og-banner.png, 1200x400: the logo
# tile and the pairs.family wordmark on paper) centred on a canvas of the banner's own paper colour. Run from the repo root.
set -euo pipefail
SRC=brand/og-banner.png; OUT=web/public/og.png
BG="$(magick "$SRC" -format '%[pixel:p{0,0}]' info:)"
magick -size 1200x630 "xc:$BG" "$SRC" -gravity center -composite -strip "$OUT"
echo "card written to $OUT"
