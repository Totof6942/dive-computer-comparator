// Data layer: fetch the Google Sheet as CSV, parse it and normalise each row
// into a model object the views can use directly.

export const SHEET_ID = '1n0uF-w1mjwbEsCtT_uA0HW3vu5XMKe5BGBjKSVCpMOk';
export const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

// When manuals get hosted somewhere, set this to the folder URL (ending with "/")
// and the "Notice" filenames from the sheet become links.
export const MANUALS_BASE_URL = '';

// GitHub repository ("owner/name") that receives corrections and new-model
// requests as issues, through the forms in .github/ISSUE_TEMPLATE/.
export const GITHUB_REPO = 'Totof6942/dive-computer-comparator';

// Snapshot of the sheet written by scripts/build.mjs, used when Google can't be reached.
const SNAPSHOT_URL = 'data/sheet.csv';

const CACHE_KEY = 'bathy.csv';

// Shown instead of the e-mail address of the sheet's credit line, written so
// that address-harvesting bots don't pick it up.
const CONTACT_EMAIL = 'poulette.christophe[at]gmail[dot]com';

// ---------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes)

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------------------
// Cell parsing

// Header lookup key: case, accents, punctuation and line breaks ignored, so a
// renamed or re-spaced header in the sheet still matches.
export const keyOf = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[₂²]/g, '2').replace(/[^a-z0-9%]+/g, ' ').trim();

const toNumber = (s) => {
  const m = s.replace(/[\s  ]/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

const parsers = {
  price: (s) => toNumber(s),
  int: (s) => toNumber(s),
  year: (s) => { const m = s.match(/\d{4}/); return m ? +m[0] : null; },
  // "Non" counts as 0 (e.g. no air integration), otherwise the first number.
  count: (s) => /^non$/i.test(s) ? 0 : toNumber(s),
  // Oui > En option > Non. Other free text ("Sur PC", "GPS"…) is a yes.
  bool: (s) => /^non\b/i.test(s) ? 0 : /option/i.test(s) ? 1 : 2,
};

/** Turn a raw cell into { raw, state, text, score, uncertain }. */
function parseCell(raw, field) {
  const text = (raw ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  if (text === '') return { raw, state: 'empty', text: '' };
  if (/^\?+$/.test(text) || text === '? | ???') return { raw, state: 'unknown', text: '' };
  if (text === '-') return { raw, state: 'na', text: '' };
  const v = { raw, state: 'ok', text, uncertain: text.includes('?') };
  if (field.type && parsers[field.type]) {
    const score = parsers[field.type](text);
    if (score != null && !Number.isNaN(score)) v.score = score;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Field catalogue: which column goes in which section, how to read it and
// which direction is "better" when comparing.

export const SECTIONS = [
  { id: 'general', label: 'Général' },
  { id: 'deco', label: 'Décompression' },
  { id: 'gas', label: 'Gaz & modes' },
  { id: 'screen', label: 'Écran & énergie' },
  { id: 'extras', label: 'Connectivité & extras' },
];

const F = (section, col, label, type = null, better = null, extra = {}) =>
  ({ section, col, key: keyOf(col), label: label || col, type, better, ...extra });

export const FIELDS = [
  F('general', 'Prix France', 'Prix', 'price', 'lower', { format: 'price' }),
  F('general', 'Sortie', 'Année de sortie', 'year', 'higher'),
  F('general', 'Format'),
  F('general', 'Bracelet', null, 'bool', 'higher'),
  F('general', 'Bungee', null, 'bool', 'higher'),
  F('general', 'Profondeur max', 'Profondeur max', 'int', 'higher', { unit: 'm' }),
  F('general', 'Notice'),

  F('deco', 'Bühlmann'),
  F('deco', 'Bühlmann Conservatisme', 'Bühlmann · conservatisme'),
  F('deco', 'RGBM'),
  F('deco', 'RGBM Conservatisme', 'RGBM · conservatisme'),
  F('deco', 'VPM'),
  F('deco', 'VPM Conservatisme', 'VPM · conservatisme'),
  F('deco', 'Pelagic'),
  F('deco', 'DCIEM'),
  F('deco', 'Palier profond'),
  F('deco', 'Palier facultatif'),
  F('deco', 'Dernier palier'),
  F('deco', 'Vitesse remontée', 'Vitesse de remontée'),
  F('deco', 'Affichage vitesse', 'Affichage de la vitesse'),
  F('deco', 'Viol Déco Blocage', 'Blocage après violation déco'),
  F('deco', 'Plannification', 'Planification'),
  F('deco', 'Réglage altitude', 'Réglage altitude'),
  F('deco', 'Alarme Déco Exponentielle', 'Alarme déco exponentielle', 'bool', 'higher'),

  F('gas', 'Mode Air', null, 'bool', 'higher'),
  F('gas', 'Mode Nitrox', null, 'bool', 'higher'),
  F('gas', 'Mode Profond', 'Mode profondimètre', 'bool', 'higher'),
  F('gas', 'Mode Apnée', null, 'bool', 'higher'),
  F('gas', 'Mode Normoxique', 'Mode normoxique', 'bool', 'higher'),
  F('gas', 'Mode Hypoxique', 'Mode hypoxique (trimix)', 'bool', 'higher'),
  F('gas', 'Mode CCR', 'Mode CCR (recycleur)', 'bool', 'higher'),
  F('gas', 'Nombre de gaz', null, 'count', 'higher'),
  F('gas', 'PpO₂'),
  F('gas', '%O₂', '% O₂'),
  F('gas', '%He', '% He'),
  F('gas', 'Gestion gaz', 'Intégration d’air', 'count', 'higher'),
  F('gas', 'Analyseur d\'O²', 'Analyseur d’O₂', 'bool', 'higher'),
  F('gas', 'Gas Blender Intégré', 'Gas blender intégré', 'bool', 'higher'),

  F('screen', 'Écran type', 'Type d’écran'),
  F('screen', 'Écran couleur', 'Écran couleur', 'bool', 'higher'),
  F('screen', 'Écran éclairage', 'Rétroéclairage', 'bool', 'higher'),
  F('screen', 'Écran tactile', 'Écran tactile', 'bool', 'higher'),
  F('screen', 'Alarme visuelle', null, 'bool', 'higher'),
  F('screen', 'Alarme sonore', null, 'bool', 'higher'),
  F('screen', 'Alarme vibration', null, 'bool', 'higher'),
  F('screen', 'Type batterie', 'Type de batterie'),
  F('screen', 'Autonomie batterie', 'Autonomie'),
  F('screen', 'Changement batterie', 'Changement de batterie'),

  F('extras', 'Connexion USB', 'USB', 'bool', 'higher'),
  F('extras', 'Connexion Bluetooth', 'Bluetooth', 'bool', 'higher'),
  F('extras', 'Application smartphone', 'Application smartphone', 'bool', 'higher'),
  F('extras', 'Mise à jour', 'Mise à jour logicielle', 'bool', 'higher'),
  F('extras', 'Mémoire', 'Mémoire carnet'),
  F('extras', 'Courbe plongée', 'Courbe de plongée', 'bool', 'higher'),
  F('extras', 'Compas', null, 'bool', 'higher'),
  F('extras', 'Chronomètre', null, 'bool', 'higher'),
  F('extras', 'Cardio fréquencemètre', 'Cardiofréquencemètre', 'bool', 'higher'),
  F('extras', 'Température corporelle', null, 'bool', 'higher'),
  F('extras', 'Mode outdoor', null, 'bool', 'higher'),
];

export const FIELD = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
const K = Object.fromEntries(FIELDS.map((f) => [f.col, f.key]));

export const ALGOS = [
  { id: 'buhlmann', label: 'Bühlmann', filterLabel: 'Bühlmann (ZHL)', col: 'Bühlmann' },
  { id: 'rgbm', label: 'RGBM', col: 'RGBM' },
  { id: 'vpm', label: 'VPM', col: 'VPM' },
  { id: 'pelagic', label: 'Pelagic', col: 'Pelagic' },
  { id: 'dciem', label: 'DCIEM', col: 'DCIEM' },
];

export const FORMATS = ['Montre', 'Rectangulaire', 'Rond', 'Console', 'HUD'];

// Equipment options offered as filters. Yes or "En option" counts, unless
// `match` is given (the cell text must match it) or `min` (the parsed number
// must reach it).
export const OPTIONS = [
  { id: 'alarme-sonore', label: 'Alarme sonore', col: 'Alarme sonore' },
  { id: 'vibration', label: 'Alarme par vibrations', col: 'Alarme vibration' },
  { id: 'appli', label: 'Application mobile', col: 'Application smartphone' },
  { id: 'compas', label: 'Compas numérique', col: 'Compas' },
  { id: 'bungee', label: 'Fixation bungee', col: 'Bungee' },
  { id: 'multigaz', label: 'Multi-gaz', col: 'Nombre de gaz', min: 2 },
  { id: 'couleur', label: 'Écran couleur', col: 'Écran couleur' },
  { id: 'sonde', label: 'Intégration d’air (sonde)', col: 'Gestion gaz' },
  { id: 'deco', label: 'Planification avec déco', col: 'Plannification', match: /avec/i },
];

// Power source, from "Type batterie": "Pile - CR2450" vs "Lithium-ion".
export const POWER = [
  { id: 'pile', label: 'Pile' },
  { id: 'batterie', label: 'Batterie' },
];

// Dive modes offered as filters, in display order: from the most common gas
// to the most technical, then the side modes. "En option" counts as available.
export const MODES = [
  { id: 'air', label: 'Air', col: 'Mode Air' },
  { id: 'nitrox', label: 'Nitrox', col: 'Mode Nitrox' },
  { id: 'trimix', label: 'Trimix', col: 'Mode Hypoxique' },
  { id: 'ccr', label: 'CCR', col: 'Mode CCR' },
  { id: 'apnee', label: 'Apnée', col: 'Mode Apnée' },
  { id: 'profondimetre', label: 'Profondimètre', col: 'Mode Profond' },
];

// ---------------------------------------------------------------------------
// Rows → models

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Rows → models. `assets` maps a model id to the files found in its
 * modeles/<id>/ folder: { photo, notice } (paths relative to the site root).
 * `manuals` maps a manual's file name, as written in the "Notice" cells, to its link.
 */
export function buildModels(rows, assets = {}, manuals = {}) {
  // Row 1 = credit line, row 2 = headers. Be tolerant if the credit line moves.
  const headerIdx = rows.findIndex((r) => r.some((c) => keyOf(c) === 'marque') && r.some((c) => keyOf(c) === 'modele'));
  if (headerIdx < 0) throw new Error('En-têtes introuvables dans la feuille');
  const disclaimer = rows.slice(0, headerIdx).flat().map((c) => c.trim()).filter(Boolean).join(' ')
    .replace(/\s*Libre de diffusion\s*-\s*/i, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/, CONTACT_EMAIL);
  const headers = rows[headerIdx].map(keyOf);
  const col = (key) => headers.indexOf(key);
  const iBrand = col('marque'), iModel = col('modele'), iStatus = col('statut');
  // Optional stable id, so renaming a model keeps its URL and its folder.
  const iId = col('id');
  const iPhoto = headers.findIndex((h) => h === 'photo url' || h === 'url photo');
  // Optional metadata columns, outside the spec fields. Features using them
  // stay hidden while the column is missing from the sheet.
  const iOnSale = headers.findIndex((h) => h === 'commercialise' || h === 'en vente');
  const iUpdated = col('derniere modification');
  const iContrib = col('contributeurs');

  const models = [];
  const seen = new Set();
  for (let ri = headerIdx + 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const brand = (r[iBrand] || '').trim();
    const name = (r[iModel] || '').trim();
    if (!brand || !name) continue;
    let id = slug((iId >= 0 && r[iId]) || `${brand} ${name}`);
    while (seen.has(id)) id += '-bis';
    seen.add(id);

    const values = {};
    for (const f of FIELDS) {
      const i = col(f.key);
      values[f.key] = i < 0 ? { raw: '', state: 'empty', text: '' } : parseCell(r[i], f);
    }
    const v = (c) => values[K[c]];
    const ok = (c) => v(c).state === 'ok';
    const score = (c) => (ok(c) ? v(c).score ?? null : null);

    const formats = ok('Format') ? v('Format').text.split(/\s*[|\n/]\s*/).filter(Boolean) : [];
    const algos = ALGOS.filter((a) => ok(a.col)).map((a) => a.id);
    const modes = MODES.filter((x) => (score(x.col) ?? 0) >= 1).map((x) => x.id);
    const options = OPTIONS.filter((o) => (o.match ? ok(o.col) && o.match.test(v(o.col).text) : (score(o.col) ?? 0) >= (o.min ?? 1))).map((o) => o.id);
    const battery = ok('Type batterie') ? v('Type batterie').text : '';
    const power = /^pile/i.test(battery) ? 'pile' : /lithium|recharge|batterie/i.test(battery) ? 'batterie' : null;
    const filled = FIELDS.filter((f) => values[f.key].state === 'ok' || values[f.key].state === 'na').length;

    const photoCell = iPhoto >= 0 ? (r[iPhoto] || '').trim() : '';
    models.push({
      id, brand, name,
      status: (r[iStatus] || '').trim(),
      values,
      price: score('Prix France'),
      year: score('Sortie'),
      yearUncertain: !!v('Sortie').uncertain,
      depth: score('Profondeur max'),
      gases: score('Nombre de gaz'),
      formats,
      algos,
      modes,
      options,
      power,
      trimix: score('Mode Hypoxique') === 2,
      ccr: (score('Mode CCR') ?? 0) >= 1,
      airIntegration: (score('Gestion gaz') ?? 0) > 0,
      rechargeable: ok('Type batterie') && /lithium|recharge/i.test(v('Type batterie').text),
      bluetooth: (score('Connexion Bluetooth') ?? 0) >= 1,
      completeness: Math.round((filled / FIELDS.length) * 100),
      onSale: iOnSale < 0 ? null : /^oui/i.test((r[iOnSale] || '').trim()) ? true : /^non/i.test((r[iOnSale] || '').trim()) ? false : null,
      updatedAt: iUpdated < 0 ? null : parseDate(r[iUpdated]),
      contributors: iContrib < 0 ? [] : (r[iContrib] || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean),
      photo: /^https?:\/\//.test(photoCell) ? photoCell : assets[id]?.photo ?? null,
      manual: ok('Notice') ? v('Notice').text : null,
      manualFile: assets[id]?.notice ?? null,
      // One entry per manual listed in the cell, with its link when the sheet has one.
      manuals: ok('Notice') ? v('Notice').text.split('\n').map((name) => ({ name, url: manuals[name] ?? null })) : [],
      row: ri + 1, // sheet row number, to match data from other exports (XLSX links)
    });
  }
  const has = { onSale: iOnSale >= 0, updatedAt: iUpdated >= 0, contributors: iContrib >= 0 };
  return { models, disclaimer, has };
}

/** Sheet dates come out as displayed: "20/10/2026", "20.10.2026" or "2026-10-20". */
function parseDate(raw) {
  const s = (raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? new Date(+m[3], m[2] - 1, +m[1]) : null;
}

// Files written by scripts/build.mjs: data/assets.json (photos and manuals found
// in modeles/<id>/) and data/manuals.json (file name → link of the sheet's manuals,
// which the CSV export drops).
async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    return res.ok ? await res.json() : {};
  } catch { return {}; }
}

// The published site's index.html carries <meta name="bathy-built" content="ISO date">,
// added by scripts/build.mjs. Its presence means the static pages modeles/<id>/ exist.
// Read from the page itself: no request, so no 404 when serving the repo root.
function siteInfo() {
  const meta = typeof document !== 'undefined' && document.querySelector('meta[name="bathy-built"]');
  return meta ? { builtAt: meta.content } : null;
}

// A hanging request to Google must not block the app: give up and fall back.
const LIVE_TIMEOUT_MS = 8000;

async function fetchCsv(url) {
  const res = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  if (!csv.includes('Marque')) throw new Error('Réponse inattendue (la feuille est-elle toujours partagée ?)');
  return csv;
}

/**
 * Load the sheet live. Falls back to the snapshot published with the site,
 * then to the last good copy in localStorage, so the app still opens offline.
 */
export async function loadData() {
  const assetsP = fetchJson('data/assets.json');
  const manualsP = fetchJson('data/manuals.json');
  let csv, source = 'live', fetchedAt = new Date();
  try {
    csv = await fetchCsv(CSV_URL);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ csv, at: fetchedAt.toISOString() })); } catch { /* quota or private mode */ }
  } catch (err) {
    try {
      csv = await fetchCsv(SNAPSHOT_URL);
      source = 'snapshot';
      fetchedAt = new Date(siteInfo()?.builtAt || Date.now());
    } catch {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { /* ignore */ }
      if (!cached) throw err;
      csv = cached.csv; source = 'cache'; fetchedAt = new Date(cached.at);
    }
  }
  const { models, disclaimer, has } = buildModels(parseCSV(csv), await assetsP, await manualsP);
  const dates = models.map((m) => m.updatedAt).filter(Boolean);
  const lastUpdate = dates.length ? new Date(Math.max(...dates)) : null;
  return { models, disclaimer, has, lastUpdate, source, fetchedAt, site: siteInfo() };
}

// ---------------------------------------------------------------------------
// Display helpers shared by the views

export const formatPrice = (n) => n == null ? null
  : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

/** Link of the model's first manual: a PDF in its folder wins over the sheet's link. */
export function manualUrl(model) {
  if (model.manualFile) return model.manualFile;
  if (model.manuals?.[0]?.url) return model.manuals[0].url;
  if (!model.manual) return null;
  if (/^https?:\/\//.test(model.manual)) return model.manual;
  return MANUALS_BASE_URL ? MANUALS_BASE_URL + encodeURIComponent(model.manual) : null;
}

/**
 * Link to a pre-filled GitHub issue form (.github/ISSUE_TEMPLATE/*.yml).
 * Query keys matching a form field id pre-fill that field.
 */
export function issueUrl(template, fields = {}) {
  if (!GITHUB_REPO) return null;
  const p = new URLSearchParams({ template: `${template}.yml`, ...fields });
  return `https://github.com/${GITHUB_REPO}/issues/new?${p}`;
}

/**
 * Algorithm labels, e.g. ["Bühlmann ZH-L16C", "VPM"]. With `short`, a known
 * Bühlmann variant is shown alone ("ZH-L16C"); "Bühlmann" stays when unspecified.
 */
export function algoLabels(m, { short = false } = {}) {
  const b = m.values[keyOf('Bühlmann')];
  return m.algos.map((id) => {
    const a = ALGOS.find((x) => x.id === id);
    if (id === 'buhlmann' && b.state === 'ok') {
      // Accept "ZH-L16C" as well as "ZHL-16C" / "ZHL16C", shown as "ZH-L16C".
      const v = b.text.split(/\n/)[0].match(/ZH-?L-?\s?(\d+)([A-Z]?)/i);
      const variant = v && `ZH-L${v[1]}${v[2].toUpperCase()}`;
      if (variant) return short ? variant : `Bühlmann ${variant}`;
      return a.label;
    }
    return a.label;
  });
}

/** The same labels on one line, e.g. "Bühlmann ZH-L16C · VPM". */
export function algoSummary(m, { separator = ' · ', short = false } = {}) {
  return m.algos.length ? algoLabels(m, { short }).join(separator) : null;
}
