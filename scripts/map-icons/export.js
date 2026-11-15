const out = '/tmp/map-icons/svg';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync('/tmp/map-icons/png', { recursive: true });
for (const shape of ICON_SHAPES) for (const by of ['status', 'type']) for (const k of ICON_KINDS) for (const st of ICON_STATES) fs.writeFileSync(`${out}/${shape}-${by}-${k}-${st}.svg`, mapIcon(shape, k, st, by));
for (const k of ['truck', 'trailer']) for (const st of ICON_STATES) fs.writeFileSync(`${out}/top-${k}-${st}.svg`, topIcon(k, st));
