# Map icon library

`icons.js` draws every map icon as SVG (the same code the design canvas uses).
To rebuild the PNGs used by the phone app (`apps/mobile/assets/map/icons`) and the website
(`apps/web/public/fleet-art/map/icons`):

```sh
node -e "const fs=require('fs');eval(fs.readFileSync('scripts/map-icons/icons.js','utf8')+';'+fs.readFileSync('scripts/map-icons/export.js','utf8'))"
for f in /tmp/map-icons/svg/*.svg; do rsvg-convert "$f" -o "/tmp/map-icons/png/$(basename "$f" .svg).png"; done
```

Then copy the PNGs to both folders. Names: `{pin|circle|square}-{status|type}-{kind}-{state}.png` and `top-{truck|trailer|car}-{state}.png` (the "Live 3D" style), drawn at 3×.
