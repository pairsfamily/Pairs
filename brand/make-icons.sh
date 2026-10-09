#!/usr/bin/env bash
# Every icon the site uses, from the operator's logo (brand/logo-source.png: two green-and-white pills, transparent,
# 9 Oct 2026). The padding around the pills is trimmed so small favicons stay legible, then each size is made square.
# The 1200x630 social card is brand/make-card.sh (called at the end). Run from the repo root.
set -euo pipefail
P=web/public
SRC=brand/logo-source.png
TRIM="$(mktemp -d)/trim.png"
magick "$SRC" -trim +repage -background none -gravity center -extent "%[fx:max(w,h)]x%[fx:max(w,h)]" "$TRIM" 2>/dev/null \
  || magick "$SRC" -trim +repage -background none -gravity center -extent 320x320 "$TRIM"
sq() { # size margin% out
  local inner=$(( $1 * (100 - 2 * $2) / 100 ))
  magick "$TRIM" -resize "${inner}x${inner}" -background none -gravity center -extent "$1x$1" "$3"
}
sq 512 6 $P/logo.png
sq 192 6 $P/icon-192.png
sq 64 2 $P/mark-64.png
sq 32 0 $P/favicon.png
magick "$TRIM" -resize 16x16 -background none -gravity center -extent 16x16 /tmp/pairs-f16.png
magick "$TRIM" -resize 48x48 -background none -gravity center -extent 48x48 /tmp/pairs-f48.png
magick /tmp/pairs-f16.png $P/favicon.png /tmp/pairs-f48.png $P/favicon.ico
magick -size 180x180 xc:'#f4f3ee' \( "$TRIM" -resize 140x140 \) -gravity center -composite $P/apple-touch-icon.png
rm -f $P/favicon.svg /tmp/pairs-f16.png /tmp/pairs-f48.png
bash "$(dirname "$0")/make-card.sh"   # the X / link-preview card (og.png)
echo "icons written to $P"
