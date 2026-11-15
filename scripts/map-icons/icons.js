// ───────── RIO GPS 3D map icon library (shared by the design canvas and the app/web export) ─────────
// Our own artwork. Three shapes (pin, circle, square) + a top-down directional style.
// Colour: by status (default) or by vehicle type; the status badge always shows the status.
const ICON_STATUS = { moving: ['#15803d', '#136c35'], idle: ['#ea7a0c', '#a3470a'], stopped: ['#dc2626', '#ad1f1f'], parked: ['#7c3aed', '#6526d1'], offline: ['#6b7280', '#4b5563'] };
const ICON_TYPE = { truck: '#1d4ed8', trailer: '#0369a1', van: '#6526d1', pickup: '#0f766e', car: '#be185d', bus: '#c2770c', equipment: '#a16207', asset: '#334155' };
const ICON_KINDS = ['truck', 'trailer', 'van', 'pickup', 'car', 'bus', 'equipment', 'asset'];
const ICON_STATES = ['moving', 'idle', 'stopped', 'parked', 'offline'];
const ICON_SHAPES = ['pin', 'circle', 'square'];
/** Map a backend vehicle type to an icon kind. */
const iconKind = (t) => ({ truck: 'truck', semi: 'truck', trailer: 'trailer', van: 'van', pickup: 'pickup', car: 'car', bus: 'bus', equipment: 'equipment' })[t] || 'asset';

const hx = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixc = (h, t, f) => { const a = hx(h), b = hx(t); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, '0')).join(''); };
let ICON_UID = 0;

// White 3D vehicle, drawn in a 32 × 20 box (side view, facing right).
const vehGlyph = (kind, id) => {
  const W = `url(#w${id})`, S = '#c5cfdc', D = '#1e293b', G = '#334155';
  const wheel = (x, y = 16.6, r = 2.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${D}"/><circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="#94a3b8"/>`;
  const win = (x, y, w, h, r = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${G}"/><rect x="${x + 0.5}" y="${y + 0.4}" width="${w * 0.45}" height="${h * 0.35}" rx="0.5" fill="#ffffff" opacity="0.35"/>`;
  switch (kind) {
    case 'truck': return `<rect x="0.5" y="2" width="20" height="12.5" rx="1.2" fill="${W}" stroke="${S}" stroke-width="0.6"/><rect x="0.5" y="12.2" width="20" height="2.3" fill="${S}"/>
      <path d="M21.5 5.5h5.2c1 0 1.8.5 2.3 1.3l2.2 3.7c.3.5.3 1 .3 1.5v2.5h-10z" fill="${W}" stroke="${S}" stroke-width="0.6"/>${win(23, 6.6, 4.4, 3.6)}<rect x="21.5" y="12.4" width="10" height="2.1" fill="${S}"/>${wheel(5)}${wheel(10.5)}${wheel(26.5)}`;
    case 'trailer': return `<rect x="0.5" y="2" width="27" height="12.5" rx="1.2" fill="${W}" stroke="${S}" stroke-width="0.6"/><rect x="0.5" y="12.2" width="27" height="2.3" fill="${S}"/><path d="M4 3v9M8 3v9" stroke="${S}" stroke-width="0.5"/>
      <path d="M27.5 13h3.5v2.2" stroke="${G}" stroke-width="1.1" fill="none"/>${wheel(5)}${wheel(10.5)}`;
    case 'van': return `<path d="M1 4.5c0-1.4 1.1-2.5 2.5-2.5h15.5c1.5 0 2.8.7 3.6 1.9l3.6 5 3.3 1.1c.9.3 1.5 1.2 1.5 2.1v2.4H1z" fill="${W}" stroke="${S}" stroke-width="0.6"/><rect x="1" y="12.4" width="30" height="2.1" fill="${S}"/>
      ${win(4, 4.2, 5, 3.4)}${win(10.5, 4.2, 5, 3.4)}<path d="M17.5 4.2h2c.7 0 1.3.3 1.7.9l2.6 3.5h-6.3z" fill="${G}"/>${wheel(6.5)}${wheel(24.5)}`;
    case 'pickup': return `<path d="M1 9h13V5.8c0-1 .8-1.8 1.8-1.8h5.4c.8 0 1.5.4 1.9 1.1l2.3 3.9 3.3.8c1 .3 1.8 1.2 1.8 2.2v2.6H1z" fill="${W}" stroke="${S}" stroke-width="0.6"/><rect x="1" y="12.4" width="29.5" height="2.1" fill="${S}"/>
      <path d="M16 5.6h4.8c.5 0 .9.2 1.2.6l1.8 2.8H16z" fill="${G}"/><path d="M1.5 9h12" stroke="${S}" stroke-width="0.8"/>${wheel(6.5)}${wheel(24)}`;
    case 'car': return `<path d="M1.5 11.2c0-1.2.8-2.2 2-2.5l4.2-1 3.4-3.4c.8-.8 1.8-1.2 2.9-1.2h6.2c1.1 0 2.1.5 2.8 1.3l3 3.4 3 .7c1.1.3 1.9 1.2 1.9 2.4v2.6H1.5z" fill="${W}" stroke="${S}" stroke-width="0.6"/><rect x="1.5" y="12.4" width="29" height="2.1" fill="${S}"/>
      <path d="M10 8.2l2.4-2.5c.4-.4 1-.6 1.5-.6h2.6v3.1zM18 5.1h2.3c.6 0 1.2.3 1.6.7l2.2 2.4H18z" fill="${G}"/>${wheel(7.5)}${wheel(24.5)}`;
    case 'bus': return `<rect x="0.5" y="1.5" width="30.5" height="13" rx="2.2" fill="${W}" stroke="${S}" stroke-width="0.6"/><rect x="0.5" y="12.2" width="30.5" height="2.3" fill="${S}"/>
      ${[2.5, 7.5, 12.5, 17.5, 22.5].map((x) => win(x, 3.5, 4, 4)).join('')}<rect x="27.5" y="3.5" width="2.5" height="8" rx="0.8" fill="${G}"/>${wheel(6)}${wheel(24.5)}`;
    case 'equipment': return `<rect x="2" y="13" width="19" height="5.5" rx="2.75" fill="${D}"/>${[4.8, 9, 13.2, 17.4].map((x) => `<circle cx="${x}" cy="15.75" r="1.3" fill="#94a3b8"/>`).join('')}
      <path d="M3 13V7.5c0-.8.7-1.5 1.5-1.5H12l2 3h5v4z" fill="${W}" stroke="${S}" stroke-width="0.6"/>${win(5, 7.2, 4.5, 3.6)}
      <path d="M17 9.5 24 3l5 6.5" fill="none" stroke="${W}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 9.5 24 3l5 6.5" fill="none" stroke="${S}" stroke-width="0.5"/>
      <path d="M27 8.5h4.2l-1 5.2h-4.6z" fill="${W}" stroke="${S}" stroke-width="0.6"/>`;
    default: return `<path d="M5 6.5 16 2l11 4.5v8.5L16 19 5 15z" fill="${W}" stroke="${S}" stroke-width="0.6"/><path d="M5 6.5 16 11l11-4.5M16 11v8" fill="none" stroke="${S}" stroke-width="0.8"/><path d="M16 11v8l11-4V6.5z" fill="${S}" opacity="0.55"/>
      <circle cx="10.5" cy="11" r="1.6" fill="${G}"/>`;
  }
};

// Status badge glyphs on a 24 × 24 grid, white.
const badgeGlyph2 = (st) => ({
  moving: '<path d="M9 6.5v11l9-5.5z" fill="#fff"/>',
  idle: '<rect x="7.5" y="6.5" width="3.2" height="11" rx="1" fill="#fff"/><rect x="13.3" y="6.5" width="3.2" height="11" rx="1" fill="#fff"/>',
  stopped: '<rect x="7" y="7" width="10" height="10" rx="1.8" fill="#fff"/>',
  parked: '<path d="M9 18V6h4.5a3.8 3.8 0 0 1 0 7.6H9" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  offline: '<path d="M4 9.5a12 12 0 0 1 16 0M7 12.8a7.5 7.5 0 0 1 10 0M10 16a3 3 0 0 1 4 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M5 5l14 14" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>'
})[st];

/** One icon as SVG markup. viewBox 0 0 48 60 (pin) or 0 0 48 52 (circle/square). */
const mapIcon = (shape, kind, st, by = 'status') => {
  const id = `i${++ICON_UID}`;
  const base = by === 'type' ? ICON_TYPE[kind] : ICON_STATUS[st][0];
  const dim = st === 'offline' && by === 'type';
  const top = mixc(base, '#ffffff', 0.32), bot = mixc(base, '#000000', 0.28), edge = mixc(base, '#000000', 0.42);
  const badge = ICON_STATUS[st][1];
  const H = shape === 'pin' ? 60 : 52;
  const cy = shape === 'pin' ? 22 : 24;
  const body = shape === 'pin' ? `M24 55.5C19.5 47.5 4 39 4 22a20 20 0 1 1 40 0c0 17-15.5 25.5-20 33.5z`
    : shape === 'circle' ? `M24 4a20 20 0 1 1 0 40a20 20 0 1 1 0-40z` : `M15 4h18a11 11 0 0 1 11 11v18a11 11 0 0 1-11 11H15A11 11 0 0 1 4 33V15A11 11 0 0 1 15 4z`;
  const ground = shape === 'pin' ? `<ellipse cx="24" cy="57" rx="7.5" ry="2.3" fill="#0f172a" opacity="0.28"/>` : `<ellipse cx="24" cy="47.5" rx="15" ry="3" fill="#0f172a" opacity="0.22"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${48 * 3}" height="${H * 3}" viewBox="0 0 48 ${H}">
  <defs>
    <linearGradient id="b${id}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.55" stop-color="${base}"/><stop offset="1" stop-color="${bot}"/></linearGradient>
    <radialGradient id="h${id}" cx="0.32" cy="0.22" r="0.55"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <linearGradient id="w${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2e8f0"/></linearGradient>
  </defs>
  ${ground}
  <path d="${body}" transform="translate(0 1.4)" fill="#0f172a" opacity="0.18"/>
  <path d="${body}" fill="url(#b${id})" stroke="${edge}" stroke-width="0.9"${dim ? ' opacity="0.55"' : ''}/>
  <path d="${body}" fill="url(#h${id})"/>
  <path d="${shape === 'pin' ? 'M10 14a17 17 0 0 1 28 0' : shape === 'circle' ? 'M10 16a17 17 0 0 1 28 0' : 'M9 12a8 8 0 0 1 7-5h16a8 8 0 0 1 7 5'}" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.2" stroke-linecap="round"/>
  <g transform="translate(8.5 ${cy - 9.5}) scale(0.97)" style="filter:none"><g transform="translate(0 0.9)" opacity="0.25">${vehGlyph(kind, id).replace(/url\(#w[^)]+\)/g, '#0f172a').replace(/fill="#[0-9a-f]{6}"/g, 'fill="#0f172a"')}</g>${vehGlyph(kind, id)}</g>
  <circle cx="39.5" cy="${shape === 'pin' ? 6.5 : 8.5}" r="8" fill="#ffffff"/><circle cx="39.5" cy="${shape === 'pin' ? 6.5 : 8.5}" r="6.4" fill="${badge}"/>
  <svg x="33.5" y="${shape === 'pin' ? 0.5 : 2.5}" width="12" height="12" viewBox="0 0 24 24">${badgeGlyph2(st)}</svg>
</svg>`;
};

/** Top-down directional vehicle, nose up; the map rotates it with the heading. viewBox 0 0 40 64. */
const topIcon = (kind, st) => {
  const id = `t${++ICON_UID}`, c = ICON_STATUS[st][0], d = mixc(c, '#000000', 0.35), l = mixc(c, '#ffffff', 0.25);
  const rig = kind !== 'trailer';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="192" viewBox="0 0 40 64">
  <defs><linearGradient id="tt${id}" x1="0" x2="1"><stop offset="0" stop-color="#d7dee8"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="1" stop-color="#c3ccd8"/></linearGradient>
  <linearGradient id="tc${id}" x1="0" x2="1"><stop offset="0" stop-color="${d}"/><stop offset="0.5" stop-color="${l}"/><stop offset="1" stop-color="${d}"/></linearGradient></defs>
  <ellipse cx="20" cy="34" rx="15" ry="27" fill="${c}" opacity="0.16"/>
  <rect x="12.2" y="${rig ? 26 : 16}" width="16.6" height="34" rx="2.5" transform="translate(1 1.5)" fill="#0f172a" opacity="0.22"/>
  <rect x="11.5" y="${rig ? 26 : 16}" width="17" height="34" rx="2.5" fill="url(#tt${id})" stroke="${rig ? '#94a3b8' : c}" stroke-width="${rig ? 0.8 : 1.6}"/>
  <path d="M11.5 ${rig ? 54 : 44}h17" stroke="#94a3b8" stroke-width="0.8"/>
  ${rig ? `<rect x="12" y="6" width="16" height="18" rx="4" fill="url(#tc${id})" stroke="${d}" stroke-width="0.8"/><path d="M14 9.5h12l-1.6 4.6h-8.8z" fill="#0f172a" opacity="0.78"/><rect x="10.2" y="10" width="1.8" height="3" rx="0.9" fill="${d}"/><rect x="28" y="10" width="1.8" height="3" rx="0.9" fill="${d}"/>`
    : `<circle cx="20" cy="20.5" r="2.6" fill="${c}"/>`}
</svg>`;
};

/**
 * "Live 3D" vehicle, seen from above with the nose up, the whole body in its status colour so the
 * state reads at a glance. The map turns it to the heading, so it lines up with the road.
 * Kinds: truck (tractor + trailer), trailer (trailer alone), car (van, pickup, car, others).
 * viewBox 0 0 48 76.
 */
const liveIcon = (kind, st) => {
  const id = `l${++ICON_UID}`, c = ICON_STATUS[st][0];
  const dk = mixc(c, '#000000', 0.38), md = mixc(c, '#000000', 0.14), lt = mixc(c, '#ffffff', 0.32), roof = mixc(c, '#ffffff', 0.16), rib = mixc(c, '#000000', 0.16), top = mixc(c, '#ffffff', 0.46);
  const glass = '#0b1730';
  const defs = `<defs>
    <linearGradient id="b${id}" x1="0" x2="1"><stop offset="0" stop-color="${dk}"/><stop offset="0.22" stop-color="${c}"/><stop offset="0.5" stop-color="${lt}"/><stop offset="0.78" stop-color="${c}"/><stop offset="1" stop-color="${dk}"/></linearGradient>
    <linearGradient id="r${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${roof}"/></linearGradient>
    <linearGradient id="g${id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#3b5278"/><stop offset="0.55" stop-color="${glass}"/></linearGradient>
    <filter id="s${id}" x="-40%" y="-20%" width="180%" height="150%"><feGaussianBlur stdDeviation="1.6"/></filter>
  </defs>`;
  let sil, body;
  if (kind === 'car') {
    sil = `<rect x="13" y="16" width="22" height="44" rx="9"/>`;
    body = `<rect x="13" y="16" width="22" height="44" rx="9" fill="url(#b${id})" stroke="${dk}" stroke-width="0.7"/>
    <path d="M16.5 28 q7.5 -4 15 0 l-1.4 7 h-12.2z" fill="url(#g${id})"/>
    <rect x="17" y="35.5" width="14" height="13" rx="2.5" fill="url(#r${id})" opacity="0.92"/>
    <path d="M17.6 49.5 h12.8 l1 5 q-7.4 2.6 -14.8 0z" fill="url(#g${id})"/>
    <rect x="10.6" y="29.5" width="2.8" height="4" rx="1.4" fill="${dk}"/><rect x="34.6" y="29.5" width="2.8" height="4" rx="1.4" fill="${dk}"/>
    <rect x="16" y="16.6" width="5" height="2" rx="1" fill="#fff6c9"/><rect x="27" y="16.6" width="5" height="2" rx="1" fill="#fff6c9"/>
    <rect x="16" y="57.6" width="5" height="1.8" rx="0.9" fill="#ff5a5a"/><rect x="27" y="57.6" width="5" height="1.8" rx="0.9" fill="#ff5a5a"/>`;
  } else {
    const rig = kind !== 'trailer', ty = rig ? 27 : 12, th = rig ? 44 : 54;
    const ribs = Array.from({ length: Math.floor((th - 8) / 6) }, (_, i) => `<path d="M16 ${ty + 7 + i * 6}h16" stroke="${rib}" stroke-width="0.8"/>`).join('');
    sil = `<rect x="13" y="${ty}" width="22" height="${th}" rx="3"/>${rig ? `<path d="M15 25 v-12 q0 -8 9 -8 q9 0 9 8 v12z"/>` : `<rect x="21" y="6" width="6" height="8" rx="2"/>`}`;
    body = `<rect x="13" y="${ty}" width="22" height="${th}" rx="3" fill="url(#b${id})" stroke="${dk}" stroke-width="0.7"/>
    <rect x="15.5" y="${ty + 2.5}" width="17" height="${th - 5}" rx="1.6" fill="url(#r${id})"/>${ribs}
    <rect x="15" y="${ty + th - 2.4}" width="5" height="1.7" rx="0.8" fill="#ff5a5a"/><rect x="28" y="${ty + th - 2.4}" width="5" height="1.7" rx="0.8" fill="#ff5a5a"/>
    ${rig ? `<rect x="19" y="23.5" width="10" height="5" fill="${dk}"/>
    <path d="M15 25 v-12 q0 -8 9 -8 q9 0 9 8 v12z" fill="url(#b${id})" stroke="${dk}" stroke-width="0.7"/>
    <path d="M17 12.6 q7 -3.4 14 0 l-1 5 h-12z" fill="url(#g${id})"/>
    <rect x="17.6" y="18.4" width="12.8" height="5.6" rx="1.8" fill="url(#r${id})" opacity="0.9"/>
    <rect x="11.4" y="12" width="3.2" height="4.4" rx="1.4" fill="${dk}"/><rect x="33.4" y="12" width="3.2" height="4.4" rx="1.4" fill="${dk}"/>
    <rect x="16.4" y="6.6" width="4.4" height="1.9" rx="0.9" fill="#fff6c9"/><rect x="27.2" y="6.6" width="4.4" height="1.9" rx="0.9" fill="#fff6c9"/>`
      : `<rect x="21" y="6" width="6" height="8" rx="2" fill="${md}" stroke="${dk}" stroke-width="0.7"/><circle cx="24" cy="9.5" r="1.5" fill="#ffffff"/>
    <rect x="15.5" y="${ty + 12}" width="2" height="5" rx="1" fill="${dk}"/><rect x="30.5" y="${ty + 12}" width="2" height="5" rx="1" fill="${dk}"/>`}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="228" viewBox="0 0 48 76">${defs}
  <g transform="translate(1.6 2.6)" fill="#0f172a" opacity="0.34" filter="url(#s${id})">${sil}</g>
  <g fill="#ffffff" stroke="#ffffff" stroke-width="3.4" stroke-linejoin="round">${sil}</g>
  ${body}
</svg>`;
};
