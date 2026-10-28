#!/usr/bin/env bash
# Regenerate the 1080x1920 scene artwork in src/obs-assets with ImageMagick.
# Overlays are the background with rounded windows cut out and a neon edge,
# so webcam/screen sources placed underneath get rounded corners for free.
set -euo pipefail
cd "$(dirname "$0")/../src/obs-assets"
W=1080 H=1920

magick -size ${W}x${H} gradient:'#11131a-#0a0b10' \
  \( -size ${W}x${H} xc:none -fill '#25f4ee' -draw 'circle 160,260 160,820' -blur 0x220 -channel A -evaluate multiply 0.20 +channel \) -composite \
  \( -size ${W}x${H} xc:none -fill '#fe2c55' -draw 'circle 940,1660 940,2240' -blur 0x240 -channel A -evaluate multiply 0.28 +channel \) -composite \
  \( -size ${W}x${H} xc:none -fill '#8a5cff' -draw 'circle 980,420 980,760' -blur 0x200 -channel A -evaluate multiply 0.14 +channel \) -composite \
  -depth 8 bg.png

# overlay NAME "x y w h r" ["x y w h r" ...]
overlay() {
  local name=$1; shift
  local holes=() strokes=()
  for spec in "$@"; do
    read -r x y w h r <<<"$spec"
    holes+=(-draw "roundrectangle $x,$y $((x + w - 1)),$((y + h - 1)) $r,$r")
    strokes+=(-draw "roundrectangle $((x - 3)),$((y - 3)) $((x + w + 2)),$((y + h + 2)) $((r + 3)),$((r + 3))")
  done
  magick -size ${W}x${H} xc:white -fill black "${holes[@]}" holes.tmp.png
  magick -size ${W}x${H} xc:none -fill none -stroke white -strokewidth 8 "${strokes[@]}" ring.tmp.png
  magick -size ${W}x${H} -define gradient:angle=135 gradient:'#25f4ee-#fe2c55' grad.tmp.png
  magick grad.tmp.png ring.tmp.png -compose CopyOpacity -composite edge.tmp.png
  magick edge.tmp.png \( +clone -blur 0x14 \) -compose Screen -composite edge.tmp.png
  magick bg.png holes.tmp.png -compose CopyOpacity -composite edge.tmp.png -compose Over -composite -depth 8 "$name"
  rm -f holes.tmp.png ring.tmp.png grad.tmp.png edge.tmp.png
}

overlay overlay-camera.png        "60 210 960 1280 52"
overlay overlay-screen-camera.png "150 170 780 439 40" "30 650 1020 574 36"
overlay overlay-screen.png        "20 560 1040 585 36"
overlay overlay-screen-robot.png  "20 170 1040 585 36"
ls -la
