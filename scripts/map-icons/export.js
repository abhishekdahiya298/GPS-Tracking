const out = '/tmp/map-icons/svg';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync('/tmp/map-icons/png', { recursive: true });
for (const shape of ICON_SHAPES) for (const by of ['status', 'type']) for (const k of ICON_KINDS) for (const st of ICON_STATES) fs.writeFileSync(`${out}/${shape}-${by}-${k}-${st}.svg`, mapIcon(shape, k, st, by));
// "Live 3D": the vehicle from above in its status colour; the map turns it with the heading.
for (const k of ['truck', 'trailer', 'car', 'tractor']) for (const st of ICON_STATES) fs.writeFileSync(`${out}/top-${k}-${st}.svg`, liveIcon(k, st));
