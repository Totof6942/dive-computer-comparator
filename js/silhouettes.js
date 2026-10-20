// Fallback illustrations, one per form factor, used when no photo is available.
// Drawn with currentColor so the CSS decides the colour.

const wrap = (body) =>
  `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const straps = (w) => `
  <path d="M${60 - w / 2} 26 L${60 - w / 2 + 4} 4 H${60 + w / 2 - 4} L${60 + w / 2} 26"/>
  <path d="M${60 - w / 2} 94 L${60 - w / 2 + 4} 116 H${60 + w / 2 - 4} L${60 + w / 2} 94"/>`;

const SHAPES = {
  Montre: wrap(`${straps(36)}
    <circle cx="60" cy="60" r="34"/><circle cx="60" cy="60" r="25" stroke-width="2"/>
    <path d="M94 50 h5 M94 70 h5 M21 50 h-5 M21 70 h-5"/>
    <path d="M48 62 h24 M52 54 h16" stroke-width="2.5"/>`),
  Rond: wrap(`${straps(30)}
    <circle cx="60" cy="60" r="36"/><circle cx="60" cy="60" r="27" stroke-width="2"/>
    <path d="M60 33 v6 M60 81 v6 M33 60 h6 M81 60 h6" stroke-width="2"/>`),
  Rectangulaire: wrap(`${straps(44)}
    <rect x="22" y="26" width="76" height="68" rx="12"/><rect x="32" y="36" width="56" height="48" rx="4" stroke-width="2"/>
    <path d="M98 44 h5 M98 76 h5 M17 44 h-5 M17 76 h-5"/>
    <path d="M40 52 h22 M40 62 h40 M40 72 h14" stroke-width="2.5"/>`),
  Console: wrap(`
    <rect x="30" y="10" width="60" height="70" rx="22"/><circle cx="60" cy="40" r="16" stroke-width="2"/>
    <rect x="44" y="60" width="32" height="12" rx="3" stroke-width="2"/>
    <path d="M60 80 v8 C60 104 40 100 34 116"/>`),
  HUD: wrap(`
    <path d="M14 46 C14 34 30 30 60 30 C90 30 106 34 106 46 V62 C106 76 92 80 80 80 C70 80 66 72 60 72 C54 72 50 80 40 80 C28 80 14 76 14 62 Z"/>
    <rect x="70" y="40" width="22" height="16" rx="3" stroke-width="2"/>
    <path d="M14 50 H4 M106 50 H116"/>`),
  default: wrap(`
    <rect x="24" y="24" width="72" height="72" rx="18"/>
    <path d="M50 52 C50 44 70 44 70 52 C70 59 60 59 60 66 M60 76 v1"/>`),
};

export function silhouette(formats) {
  const f = (formats || []).find((x) => SHAPES[x]);
  return SHAPES[f] || SHAPES.default;
}
