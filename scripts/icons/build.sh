#!/bin/sh
# Renders the app icons in public/icons from two SVGs. Run with `npm run icons` after changing
# either SVG, and commit the PNGs: the build uses them as they are, so only this script needs
# rsvg-convert (`brew install librsvg`).
#   scripts/icons/icon.svg  full bleed: the iPhone home-screen icon and Android's maskable icon
#   public/favicon.svg      rounded tile: the browser tab and the "any" icons a laptop install uses
set -e
cd "$(dirname "$0")/../.."
out=public/icons
mkdir -p "$out"
rsvg-convert -w 180 -h 180 scripts/icons/icon.svg -o "$out/apple-touch-icon.png"
rsvg-convert -w 512 -h 512 scripts/icons/icon.svg -o "$out/icon-maskable-512.png"
rsvg-convert -w 192 -h 192 public/favicon.svg -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 public/favicon.svg -o "$out/icon-512.png"
