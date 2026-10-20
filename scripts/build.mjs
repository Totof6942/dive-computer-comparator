// Build the published site from the Google Sheet.
//
//   node scripts/build.mjs            (SITE_URL=https://owner.github.io/repo/ for canonical URLs)
//
// 1. Reads the sheet (CSV export) — the sheet stays the single source of truth.
// 2. Updates the committed data files, so git history logs every change:
//      data/sheet.csv           raw snapshot, fallback for the app
//      data/models.json         every model as a flat object
//      data/assets.json         photo / manual found in each modeles/<id>/ folder
//      modeles/<id>/fiche.json  one flat file per model
// 3. Writes the deployable site to _site/: the app, plus one static HTML page
//    per model (indexable, with link previews) and sitemap.xml.

import { mkdir, readdir, readFile, rm, writeFile, cp, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CSV_URL, SHEET_URL, PRICE_NOTE, SECTIONS, FIELDS,
  parseCSV, buildModels, formatPrice, algoSummary, manualUrl,
} from '../js/data.js';
import { silhouette } from '../js/silhouettes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const MODELS_DIR = join(ROOT, 'modeles');
const SITE_URL = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';
const STATIC_FILES = ['index.html', 'css', 'js', 'data', 'modeles'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const exists = (p) => stat(p).then(() => true, () => false);
const json = (data) => `${JSON.stringify(data, null, 2)}\n`;

/** Write only when the content changes, so unchanged files keep their mtime. */
async function writeIfChanged(path, content) {
  const old = await readFile(path, 'utf8').catch(() => null);
  if (old === content) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return true;
}

// ---------------------------------------------------------------------------
// 1. Sheet

async function fetchSheet(attempts = 3) {
  let res;
  for (let i = 1; ; i++) {
    try {
      res = await fetch(CSV_URL);
      break;
    } catch (err) {
      if (i >= attempts) throw new Error(`Feuille injoignable : ${err.cause?.code || err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  if (!res.ok) throw new Error(`Feuille illisible : HTTP ${res.status}`);
  const csv = await res.text();
  if (!csv.includes('Marque')) throw new Error('Réponse inattendue : la feuille est-elle toujours partagée en lecture ?');
  return csv;
}

// ---------------------------------------------------------------------------
// 2. Assets and committed data

const PHOTO_RE = /\.(webp|avif|jpe?g|png)$/i;

/** Photo and manual in modeles/<id>/. A file named photo.* wins over other images. */
async function scanAssets() {
  const assets = {};
  if (!(await exists(MODELS_DIR))) return assets;
  for (const id of (await readdir(MODELS_DIR)).sort()) {
    const dir = join(MODELS_DIR, id);
    if (!(await stat(dir)).isDirectory()) continue;
    const files = (await readdir(dir)).sort();
    const photo = files.find((f) => /^photo\./i.test(f) && PHOTO_RE.test(f)) || files.find((f) => PHOTO_RE.test(f));
    const notice = files.find((f) => /\.pdf$/i.test(f));
    if (photo || notice) {
      assets[id] = {};
      if (photo) assets[id].photo = `modeles/${id}/${photo}`;
      if (notice) assets[id].notice = `modeles/${id}/${notice}`;
    }
  }
  return assets;
}

/** Flat record of one model: sheet values as typed, grouped by section. */
function fiche(m, has, assets) {
  const specs = {};
  for (const s of SECTIONS) {
    specs[s.label] = {};
    for (const f of FIELDS.filter((x) => x.section === s.id)) {
      specs[s.label][f.col] = (m.values[f.key].raw || '').replace(/\r/g, '').trim();
    }
  }
  return {
    id: m.id,
    marque: m.brand,
    modele: m.name,
    statut: m.status,
    ...(has.onSale ? { commercialise: m.onSale } : {}),
    ...(has.contributors ? { contributeurs: m.contributors } : {}),
    photo: assets[m.id]?.photo?.split('/').pop() ?? null,
    notice: assets[m.id]?.notice?.split('/').pop() ?? null,
    caracteristiques: specs,
  };
}

/** Remove fiche.json of models gone from the sheet; keep folders holding the user's files. */
async function pruneModels(ids) {
  if (!(await exists(MODELS_DIR))) return;
  for (const id of await readdir(MODELS_DIR)) {
    if (ids.has(id)) continue;
    const dir = join(MODELS_DIR, id);
    if (!(await stat(dir)).isDirectory()) continue;
    await rm(join(dir, 'fiche.json'), { force: true });
    const left = await readdir(dir);
    if (!left.length) await rm(dir, { recursive: true });
    else console.warn(`⚠ modeles/${id}/ n’est plus dans la feuille mais contient encore : ${left.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Static pages

function valueHtml(v, f) {
  if (v.state === 'unknown') return '<span class="flag flag-unknown"><span aria-hidden="true">?</span> Inconnu</span>';
  if (v.state === 'na') return '<span class="na">—<span class="sr-only">Non applicable</span></span>';
  if (v.state === 'empty') return '<span class="flag flag-empty">Non renseigné</span>';
  if (f.type === 'bool' && /^oui$/i.test(v.text)) return '<span class="yes"><span aria-hidden="true">✓</span> Oui</span>';
  if (f.type === 'bool' && /^non$/i.test(v.text)) return '<span class="no"><span aria-hidden="true">✕</span> Non</span>';
  if (f.format === 'price' && v.score != null) return `<span class="mono">${esc(formatPrice(v.score))}</span>`;
  return `<span class="mono">${esc(v.text).replace(/\n/g, '<br>')}</span>`;
}

function header(prefix) {
  return `<header class="site-header"><div class="header-inner">
    <a class="logo" href="${prefix}#/" aria-label="Palier, accueil">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 8h22M5 16h15M5 24h8" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>
      <span class="logo-text">Palier</span></a>
    <span class="tagline">Comparateur d’ordinateurs de plongée</span>
    <nav class="nav" aria-label="Navigation principale">
      <a href="${prefix}#/">Catalogue</a>
      <a href="${prefix}#/guide"><span class="nav-long">Trouver mon ordinateur</span><span class="nav-short">Guide</span></a>
      <a href="${prefix}#/comparer/">Comparer</a>
    </nav></div></header>`;
}

function footer(disclaimer, builtAt) {
  return `<footer class="site-footer"><div class="footer-inner">
    <p class="disclaimer-title">Avertissement</p>
    <p class="disclaimer">${esc(disclaimer)}</p>
    <p class="disclaimer">${esc(PRICE_NOTE)}</p>
    <p class="data-status">Page générée le ${builtAt} depuis la <a href="${SHEET_URL}" rel="noopener">feuille source</a>.</p>
  </div></footer>`;
}

function modelPage(m, disclaimer, builtAt) {
  const prefix = '../../';
  const fullName = `${m.brand} ${m.name}`;
  const algo = algoSummary(m);
  const facts = [
    m.price != null ? formatPrice(m.price) : null,
    m.depth != null ? `${m.depth} m max` : null,
    m.gases != null ? `${m.gases} gaz` : null,
    algo, m.formats.join(' / ') || null,
  ].filter(Boolean);
  const description = `${fullName} : ${facts.join(' · ')}. Caractéristiques détaillées issues de la notice du fabricant.`;
  const url = SITE_URL ? `${SITE_URL}modeles/${m.id}/` : '';
  const image = m.photo && SITE_URL ? (/^https?:/.test(m.photo) ? m.photo : SITE_URL + m.photo) : '';
  const manual = manualUrl(m);
  const tags = [algo, m.trimix && 'Trimix', m.ccr && 'CCR', m.airIntegration && 'Intégration d’air'].filter(Boolean);

  const media = m.photo
    ? `<img src="${esc(/^https?:/.test(m.photo) ? m.photo : prefix + m.photo)}" alt="${esc(fullName)}">`
    : `<span class="silhouette" role="img" aria-label="Silhouette ${esc(m.formats[0] || 'générique')}">${silhouette(m.formats)}</span>`;

  const sections = SECTIONS.map((s) => `<section class="spec-card"><h2>${esc(s.label)}</h2><dl>
      ${FIELDS.filter((f) => f.section === s.id).map((f) => `<div class="spec-row"><dt>${esc(f.label)}${f.note ? ` <span class="field-note">${esc(f.note)}</span>` : ''}</dt><dd>${valueHtml(m.values[f.key], f)}</dd></div>`).join('')}
    </dl></section>`).join('');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(fullName)} · Palier</title>
  <meta name="description" content="${esc(description)}">
  ${url ? `<link rel="canonical" href="${esc(url)}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:site_name" content="Palier">
  <meta property="og:title" content="${esc(fullName)}">
  <meta property="og:description" content="${esc(description)}">
  ${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
  ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
  <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
  <meta name="theme-color" content="#0E1A24">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230E1A24'/%3E%3Cpath d='M7 9h18M7 16h12M7 23h6' stroke='%23FB923C' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
  <link rel="stylesheet" href="${prefix}css/styles.css">
</head>
<body>
  ${header(prefix)}
  <main class="page model-page">
    <a class="back" href="${prefix}#/">← Catalogue</a>
    <section class="hero">
      <div class="media hero-media">${media}</div>
      <div class="hero-info">
        <p class="brand">${esc(m.brand)}</p>
        <h1 class="model-name hero-name">${esc(m.name)}</h1>
        <p class="hero-price">${m.price != null ? `<span class="price">${esc(formatPrice(m.price))}</span>` : '<span class="price price-missing">Prix non renseigné</span>'}${m.year ? ` <span class="muted">· sorti en <span class="mono">${m.year}</span></span>` : ''}</p>
        ${m.price != null ? '<p class="hint price-note">Prix indicatif, observé chez les revendeurs français hors promotion.</p>' : ''}
        ${m.onSale === false ? '<p class="hero-meta"><span class="badge badge-off">Plus commercialisé</span></p>' : ''}
        <ul class="tags">${tags.map((t) => `<li class="tag">${esc(t)}</li>`).join('')}</ul>
        <div class="hero-actions">
          <a class="btn btn-primary" href="${prefix}#/modele/${encodeURIComponent(m.id)}">Comparer avec d’autres modèles</a>
          ${manual ? `<a class="btn btn-ghost" href="${esc(/^https?:/.test(manual) ? manual : prefix + manual)}" rel="noopener">Notice (PDF)</a>` : ''}
        </div>
        <p class="hint">Fiche complète à ${m.completeness} %.</p>
      </div>
    </section>
    <div class="spec-grid" style="margin-top:16px">${sections}</div>
  </main>
  ${footer(disclaimer, builtAt)}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------

async function main() {
  const now = new Date();
  const builtAt = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');

  const csv = await fetchSheet();
  const assets = await scanAssets();
  const { models, disclaimer, has } = buildModels(parseCSV(csv), assets);
  console.log(`${models.length} modèles lus dans la feuille, ${Object.keys(assets).length} dossiers avec photo ou notice.`);

  // Committed data
  let changed = 0;
  changed += await writeIfChanged(join(ROOT, 'data/sheet.csv'), csv);
  changed += await writeIfChanged(join(ROOT, 'data/assets.json'), json(assets));
  const fiches = models.map((m) => fiche(m, has, assets));
  changed += await writeIfChanged(join(ROOT, 'data/models.json'), json(fiches));
  for (const f of fiches) changed += await writeIfChanged(join(MODELS_DIR, f.id, 'fiche.json'), json(f));
  await pruneModels(new Set(models.map((m) => m.id)));
  console.log(`${changed} fichier(s) de données mis à jour.`);

  // Deployable site
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  for (const p of STATIC_FILES) {
    if (await exists(join(ROOT, p))) await cp(join(ROOT, p), join(OUT, p), { recursive: true });
  }
  await writeFile(join(OUT, '.nojekyll'), '');
  await writeFile(join(OUT, 'data/site.json'), json({ builtAt: now.toISOString() }));
  for (const m of models) await writeFile(join(OUT, 'modeles', m.id, 'index.html'), modelPage(m, disclaimer, builtAt));

  if (SITE_URL) {
    const urls = ['', ...models.map((m) => `modeles/${m.id}/`)];
    await writeFile(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(SITE_URL + u)}</loc></url>`).join('\n')}
</urlset>
`);
  }
  console.log(`Site prêt dans _site/ (${models.length} pages modèles${SITE_URL ? `, ${SITE_URL}` : ''}).`);
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
