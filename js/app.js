import {
  loadData, SECTIONS, FIELDS, ALGOS, FORMATS, MODES, OPTIONS, POWER, SHEET_URL,
  formatPrice, manualUrl, algoLabels, keyOf, issueUrl,
} from './data.js';
import { silhouette } from './silhouettes.js';

const MAX_COMPARE = 3;
const app = document.getElementById('app');
const mqMobile = matchMedia('(max-width: 767px)');

// ---------------------------------------------------------------------------
// Small helpers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const fmtDate = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');

const storage = (area) => ({
  get(k, fallback) {
    try { return JSON.parse(area.getItem(k)) ?? fallback; } catch { return fallback; }
  },
  set(k, v) { try { area.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
});
const local = storage(window.localStorage);
const session = storage(window.sessionStorage);

const nullsLast = (get, dir) => (a, b) => {
  const x = get(a), y = get(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return (x - y) * dir;
};
const byName = (a, b) => a.brand.localeCompare(b.brand, 'fr') || a.name.localeCompare(b.name, 'fr', { numeric: true });
const SORTS = {
  brand: { label: 'Marque (A → Z)', fn: byName },
  priceAsc: { label: 'Prix croissant', fn: nullsLast((m) => m.price, 1) },
  priceDesc: { label: 'Prix décroissant', fn: nullsLast((m) => m.price, -1) },
  recent: { label: 'Plus récents', fn: nullsLast((m) => m.year, -1) },
};

const defaultFilters = () => ({
  q: '', sort: 'brand', priceMin: null, priceMax: null,
  algos: [], formats: [], brands: [], modes: [], options: [], power: [], onSaleOnly: false,
});

const state = {
  data: null,
  byId: new Map(),
  compare: local.get('bathy.compare', []),
  filters: { ...defaultFilters(), ...session.get('bathy.filters', {}) },
  catalogueScroll: 0,
  route: null,
  diffOnly: false,
  mobileTab: 'general',
  mobilePair: [0, 1],
  openGroups: new Set(),
};
// A sort option saved in the session may no longer exist.
if (!SORTS[state.filters.sort]) state.filters.sort = 'brand';

// ---------------------------------------------------------------------------
// Shared fragments

function media(m, cls = '') {
  const inner = m.photo
    ? `<img src="${esc(m.photo)}" alt="${esc(`${m.brand} ${m.name}`)}" loading="lazy">`
    : `<span class="silhouette" role="img" aria-label="${esc(`Silhouette ${m.formats[0] || 'générique'}`)}">${silhouette(m.formats)}</span>`;
  return `<div class="media ${cls}">${inner}</div>`;
}

function priceHtml(m) {
  return m.price != null
    ? `<span class="price">${esc(formatPrice(m.price))}</span>`
    : `<span class="price price-missing">Prix non renseigné</span>`;
}

/** One tag per decompression algorithm, coloured by family (same on cards and model pages). */
function algoTags(m) {
  return algoLabels(m, { short: true }).map((t, i) => `<li class="tag tag-${m.algos[i]}">${esc(t)}</li>`).join('');
}

function compareButton(m, variant = '') {
  const on = state.compare.includes(m.id);
  return `<button type="button" class="btn-compare ${variant}" data-compare="${esc(m.id)}" aria-pressed="${on}"
    aria-label="${on ? 'Retirer' : 'Ajouter'} ${esc(`${m.brand} ${m.name}`)} ${on ? 'du' : 'au'} comparateur">
    <span class="ico" aria-hidden="true">${on ? '✓' : '+'}</span><span class="lbl">${on ? 'Sélectionné' : 'Comparer'}</span></button>`;
}

function card(m) {
  const figures = [
    m.year != null ? `${m.year}${m.yearUncertain ? ' ?' : ''}` : null,
    m.gases != null ? plural(m.gases, 'gaz', 'gaz') : null,
  ].filter(Boolean);
  return `<article class="card">
    <a class="card-link" href="#/modele/${esc(m.id)}">
      ${media(m, 'card-media')}
      <div class="card-body">
        <p class="brand">${esc(m.brand)}${m.onSale === false ? ' <span class="badge badge-off">Plus commercialisé</span>' : ''}${m.status !== 'Done' ? ' <span class="badge badge-todo">Fiche à compléter</span>' : ''}</p>
        <h3 class="model-name">${esc(m.name)}</h3>
        ${priceHtml(m)}
        ${figures.length ? `<p class="figures mono">${figures.map(esc).join('<span aria-hidden="true"> · </span>')}</p>` : ''}
        <ul class="tags">${algoTags(m)}</ul>
      </div>
    </a>
    ${compareButton(m)}
  </article>`;
}

/** Render one cell value with the unknown / not-applicable / empty states made explicit. */
function valueHtml(v, field, model = null) {
  if (v.state === 'unknown') return `<span class="flag flag-unknown" title="Absent de la notice du fabricant"><span aria-hidden="true">?</span> Inconnu</span>`;
  if (v.state === 'na') return `<span class="na" title="Non applicable">—<span class="sr-only">Non applicable</span></span>`;
  if (v.state === 'empty') return `<span class="flag flag-empty" title="Pas encore renseigné dans la feuille">Non renseigné</span>`;

  let html;
  if (field.type === 'bool' && /^oui$/i.test(v.text)) html = `<span class="yes"><span aria-hidden="true">✓</span> Oui</span>`;
  else if (field.type === 'bool' && /^non$/i.test(v.text)) html = `<span class="no"><span aria-hidden="true">✕</span> Non</span>`;
  else if (field.type === 'bool' && /^en option$/i.test(v.text)) html = `<span class="option">En option</span>`;
  else if (field.format === 'price' && v.score != null) html = `<span class="mono">${esc(formatPrice(v.score))}</span>`;
  else if (field.unit && v.score != null && /^\d+\s*\w*$/.test(v.text)) html = `<span class="mono">${v.score} ${field.unit}</span>`;
  else if (field.key === keyOf('Notice')) {
    // One line per manual listed in the cell, each with its own link when known.
    // The first one may also be a PDF dropped in the model's folder.
    const list = model?.manuals?.length ? model.manuals : v.text.split('\n').map((name) => ({ name, url: null }));
    html = list.map(({ name, url }, i) => {
      const href = (i === 0 && model?.manualFile) || url || (i === 0 && model ? manualUrl(model) : null);
      return href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(name)}</a>`
        : `<span class="mono small">${esc(name)}</span>`;
    }).join('<br>');
  } else html = `<span class="mono">${esc(v.text).replace(/\n/g, '<br>')}</span>`;

  if (v.uncertain) html += ` <span class="flag flag-uncertain" title="Valeur incertaine dans la notice">à vérifier</span>`;
  return html;
}

/** Compare one field across models: are all values the same, and which indexes hold the best value. */
function rowInfo(field, models) {
  const vals = models.map((m) => m.values[field.key]);
  const sig = vals.map((v) => `${v.state}|${norm(v.text)}`);
  const same = sig.every((s) => s === sig[0]);
  let best = [];
  if (field.better && !same) {
    const scores = vals.map((v) => (v.state === 'ok' && v.score != null ? v.score : null));
    const valid = scores.filter((s) => s != null);
    if (valid.length >= 2 && new Set(valid).size > 1) {
      const target = field.better === 'lower' ? Math.min(...valid) : Math.max(...valid);
      best = scores.flatMap((s, i) => (s === target ? [i] : []));
    }
  }
  return { vals, same, best };
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------------------
// Compare selection + tray

function setCompare(ids) {
  state.compare = ids.slice(0, MAX_COMPARE);
  local.set('bathy.compare', state.compare);
  renderTray();
  document.querySelectorAll('[data-compare]').forEach((btn) => {
    const m = state.byId.get(btn.dataset.compare);
    if (m) btn.outerHTML = compareButton(m, btn.classList.contains('btn-large') ? 'btn-large' : '');
  });
  document.getElementById('nav-compare').href = compareHref(state.compare);
  const nav = document.getElementById('nav-compare-count');
  nav.textContent = state.compare.length || '';
  nav.hidden = !state.compare.length;
}

function toggleCompare(id) {
  if (state.compare.includes(id)) return setCompare(state.compare.filter((x) => x !== id));
  if (state.compare.length >= MAX_COMPARE) return toast(`${MAX_COMPARE} modèles maximum dans le comparateur`);
  setCompare([...state.compare, id]);
}

const compareHref = (ids) => `#/comparer/${ids.map(encodeURIComponent).join(',')}`;

function renderTray() {
  const tray = document.getElementById('tray');
  const models = state.compare.map((id) => state.byId.get(id)).filter(Boolean);
  const show = models.length > 0 && state.route?.name !== 'compare';
  tray.hidden = !show;
  document.body.classList.toggle('has-tray', show);
  if (!show) return;
  const slots = Array.from({ length: MAX_COMPARE }, (_, i) => {
    const m = models[i];
    return m
      ? `<li class="slot"><span class="slot-name"><span class="brand">${esc(m.brand)}</span> ${esc(m.name)}</span>
          <button type="button" class="slot-remove" data-unselect="${esc(m.id)}" aria-label="Retirer ${esc(m.name)}">✕</button></li>`
      : `<li class="slot slot-empty">Emplacement libre</li>`;
  }).join('');
  tray.innerHTML = `<div class="tray-inner">
    <p class="tray-title">Comparateur <span class="mono">${models.length}/${MAX_COMPARE}</span></p>
    <ul class="slots">${slots}</ul>
    <div class="tray-actions">
      <button type="button" class="btn btn-ghost" data-action="clear-compare">Vider</button>
      <a class="btn btn-primary ${models.length < 2 ? 'disabled' : ''}" ${models.length < 2 ? 'aria-disabled="true"' : ''}
        href="${models.length < 2 ? '#/' : compareHref(state.compare)}">Comparer</a>
    </div></div>`;
}

// ---------------------------------------------------------------------------
// Catalogue

function filtered(f = state.filters) {
  return state.data.models.filter(matcher(f)).sort(SORTS[f.sort]?.fn || byName);
}

/** Predicate: does a model pass the filters `f`? */
function matcher(f) {
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  return (m) => {
    if (terms.length) {
      const hay = norm(`${m.brand} ${m.name}`);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if ((f.priceMin != null || f.priceMax != null) && m.price == null) return false;
    if (f.priceMin != null && m.price < f.priceMin) return false;
    if (f.priceMax != null && m.price > f.priceMax) return false;
    if (f.brands.length && !f.brands.includes(m.brand)) return false;
    if (f.onSaleOnly && m.onSale === false) return false;
    if (f.algos.length && !f.algos.some((a) => m.algos.includes(a))) return false;
    if (f.formats.length && !f.formats.some((x) => m.formats.includes(x))) return false;
    if (f.power.length && !f.power.includes(m.power)) return false;
    if (!f.modes.every((x) => m.modes.includes(x))) return false;
    return f.options.every((x) => m.options.includes(x));
  };
}

const bounds = () => {
  const ms = state.data.models;
  const prices = ms.map((m) => m.price).filter((p) => p != null);
  return {
    priceMin: Math.floor(Math.min(...prices) / 50) * 50,
    priceMax: Math.ceil(Math.max(...prices) / 50) * 50,
  };
};

const brandList = () => [...new Set(state.data.models.map((m) => m.brand))].sort((a, b) => a.localeCompare(b, 'fr'));

const activeFilterCount = () => {
  const f = state.filters;
  return (f.priceMin != null || f.priceMax != null) + f.onSaleOnly + f.brands.length + f.algos.length + f.formats.length + f.modes.length
    + f.options.length + f.power.length;
};

function priceLabel(lo, hi) {
  if (lo == null && hi == null) return 'Tous les prix';
  if (hi == null) return `À partir de ${formatPrice(lo)}`;
  if (lo == null) return `Jusqu’à ${formatPrice(hi)}`;
  return `${formatPrice(lo)} – ${formatPrice(hi)}`;
}

/** Position the filled part of the two-thumb budget slider. */
function paintPriceRange() {
  const lo = document.getElementById('f-price-min'), hi = document.getElementById('f-price-max');
  if (!lo) return;
  const pct = (el) => ((el.value - el.min) / (el.max - el.min)) * 100;
  const box = lo.parentElement;
  box.style.setProperty('--lo', pct(lo));
  box.style.setProperty('--hi', pct(hi));
  // When both thumbs sit at the top end, the min thumb must stay grabbable.
  lo.style.zIndex = pct(lo) > 50 ? 3 : 1;
  document.getElementById('f-price-out').textContent = priceLabel(state.filters.priceMin, state.filters.priceMax);
}

/** Copy of a filter option list in French alphabetical order of its labels. */
const alpha = (list, label = (x) => x.label ?? x) =>
  [...list].sort((a, b) => label(a).localeCompare(label(b), 'fr', { sensitivity: 'base' }));

/**
 * Checkbox groups of the filter panel, in display order. Each item:
 * { value, label, count, tag? } — `tag` is the label of its active-filter tag.
 */
function filterGroups() {
  const f = state.filters;
  // Counts follow the other active filters (faceted search):
  // - "any of" groups (brand, format…) ignore their own selection, otherwise
  //   ticking one brand would drop every other brand to 0;
  // - "all of" groups (modes, options) count what is left once the item is added.
  const pool = (key, anyOf) => state.data.models.filter(matcher(anyOf ? { ...f, [key]: [] } : f));
  const items = (key, anyOf, list, value, label, has) => {
    const ms = pool(key, anyOf);
    return list.map((x) => ({ value: value(x), label: label(x), count: ms.filter((m) => has(m, value(x))).length }));
  };
  const id = (x) => x.id, lbl = (x) => x.label, same = (x) => x;
  const algoLabel = (a) => a.filterLabel ?? a.label;
  const groups = [
    { key: 'brands', title: 'Marque', items: items('brands', true, brandList(), same, same, (m, v) => m.brand === v) },
    { key: 'formats', title: 'Format', items: items('formats', true, alpha(FORMATS), same, same, (m, v) => m.formats.includes(v)) },
    { key: 'modes', title: 'Modes', items: items('modes', false, MODES, id, lbl, (m, v) => m.modes.includes(v)) },
    { key: 'options', title: 'Options', items: items('options', false, alpha(OPTIONS), id, lbl, (m, v) => m.options.includes(v)) },
    { key: 'algos', title: 'Algorithme', items: items('algos', true, alpha(ALGOS, algoLabel), id, algoLabel, (m, v) => m.algos.includes(v)) },
    { key: 'power', title: 'Alimentation', items: items('power', true, alpha(POWER), id, lbl, (m, v) => m.power === v) },
  ];
  if (state.data.has.onSale) {
    // Here the count is the number of models the option would hide.
    const ms = state.data.models.filter(matcher({ ...f, onSaleOnly: false }));
    groups.push({ key: 'onSaleOnly', title: 'Disponibilité', items: [{
      value: '1', label: 'Masquer les modèles plus commercialisés', tag: 'Plus commercialisés masqués',
      count: ms.filter((m) => m.onSale === false).length,
    }] });
  }
  return groups;
}

const isActive = (key, value) => (key === 'onSaleOnly' ? state.filters.onSaleOnly : state.filters[key].includes(value));
const activeInGroup = (g) => g.items.filter((it) => isActive(g.key, it.value)).length;

function filtersPanel() {
  const f = state.filters;
  const b = bounds();
  const check = (name, it) => {
    const on = isActive(name, it.value);
    return `<label class="check ${!it.count && !on ? 'check-empty' : ''}">
      <input type="checkbox" data-filter="${name}" value="${esc(it.value)}" ${on ? 'checked' : ''}>
      <span>${esc(it.label)}</span><span class="count mono">${it.count}</span></label>`;
  };
  // Groups start folded; the ones opened during the visit stay open.
  const groups = filterGroups().map((g) => {
    const n = activeInGroup(g);
    return `<details class="filter-group" data-group="${g.key}" ${state.openGroups.has(g.key) ? 'open' : ''}>
      <summary><span>${esc(g.title)}</span>
        <span class="group-count" data-group-count="${g.key}" aria-label="${n ? plural(n, 'filtre actif', 'filtres actifs') : ''}">${n || ''}</span>
        <span class="chev" aria-hidden="true"></span></summary>
      <div class="group-body">${g.items.map((it) => check(g.key, it)).join('')}</div>
    </details>`;
  }).join('');
  return `<aside class="filters" id="filters" aria-label="Filtres">
    <div class="filters-head">
      <h2>Filtres</h2>
      <button type="button" class="btn-link" data-action="reset-filters">Réinitialiser</button>
      <button type="button" class="icon-btn only-mobile" data-action="close-filters" aria-label="Fermer les filtres">✕</button>
    </div>
    <fieldset class="budget">
      <legend>Budget</legend>
      <div class="dual-range">
        <input type="range" id="f-price-min" min="${b.priceMin}" max="${b.priceMax}" step="50" value="${f.priceMin ?? b.priceMin}" aria-label="Prix minimum" aria-describedby="f-price-out">
        <input type="range" id="f-price-max" min="${b.priceMin}" max="${b.priceMax}" step="50" value="${f.priceMax ?? b.priceMax}" aria-label="Prix maximum" aria-describedby="f-price-out">
      </div>
      <output id="f-price-out" class="range-out mono">${esc(priceLabel(f.priceMin, f.priceMax))}</output>
      <p class="hint">Les modèles sans prix sont masqués dès qu’un budget est fixé.</p>
    </fieldset>
    <div class="active-filters" id="active-filters" aria-label="Filtres actifs"></div>
    ${groups}
    <div class="filters-foot only-mobile"><button type="button" class="btn btn-primary btn-block" data-action="close-filters">Voir les résultats</button></div>
  </aside>`;
}

/** Mobile only: the button opening the filter sheet, with the number of active filters. */
function chipsRow() {
  const n = activeFilterCount();
  return `<button type="button" class="chip chip-filters" data-action="open-filters" aria-expanded="false" aria-controls="filters">
      <span aria-hidden="true">☰</span> Filtres${n ? ` <span class="chip-count">${n}</span>` : ''}</button>`;
}

function renderCatalogue() {
  const f = state.filters;
  app.innerHTML = `<div class="catalogue">
    ${filtersPanel()}
    <div class="filters-backdrop" data-action="close-filters" hidden></div>
    <section class="results" aria-labelledby="results-title">
      <div class="results-head">
        <h1 id="results-title" class="page-title">Ordinateurs de plongée</h1>
        <p class="result-count" id="result-count" aria-live="polite"></p>
        <div class="head-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="share" data-share-msg="Lien de la recherche copié">Partager la recherche</button>
        </div>
      </div>
      <div class="toolbar">
        <label class="search"><span class="sr-only">Rechercher un modèle</span>
          <input type="search" id="search" placeholder="Rechercher une marque, un modèle…" value="${esc(f.q)}" autocomplete="off"></label>
        <label class="sort"><span class="sort-label">Trier par</span>
          <select id="sort">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
      </div>
      <div class="chips only-mobile" id="chips" role="group" aria-label="Filtres"></div>
      <div class="grid" id="grid"></div>
      ${issueUrl('nouveau-modele') ? `<p class="suggest">Un modèle manque ? <a href="${esc(issueUrl('nouveau-modele'))}" target="_blank" rel="noopener">Proposez-le</a></p>` : ''}
    </section>
  </div>`;
  updateResults();
  paintPriceRange();
  requestAnimationFrame(() => window.scrollTo(0, state.catalogueScroll));
}

function updateResults() {
  session.set('bathy.filters', state.filters);
  // Mirror the filters in the URL so a search can be shared. replaceState
  // does not fire hashchange, so this never triggers a re-render.
  const qs = filtersToQuery(state.filters);
  history.replaceState(null, '', `#/${qs ? `?${qs}` : ''}`);
  const list = filtered();
  const total = state.data.models.length;
  document.getElementById('result-count').textContent =
    list.length === total ? plural(total, 'modèle', 'modèles') : `${list.length} sur ${plural(total, 'modèle', 'modèles')}`;
  document.getElementById('grid').innerHTML = list.length
    ? list.map(card).join('')
    : `<div class="empty-state"><p>Aucun modèle ne correspond à ces critères.</p>
        <button type="button" class="btn btn-ghost" data-action="reset-filters">Réinitialiser les filtres</button></div>`;
  document.getElementById('chips').innerHTML = chipsRow();
  // Keep the panel in sync (tags can untick boxes) and refresh the counts.
  const groups = filterGroups();
  for (const g of groups) {
    for (const it of g.items) {
      const input = document.querySelector(`[data-filter="${g.key}"][value="${CSS.escape(it.value)}"]`);
      if (!input) continue;
      input.checked = isActive(g.key, it.value);
      const label = input.closest('.check');
      label.querySelector('.count').textContent = it.count;
      label.classList.toggle('check-empty', !it.count && !input.checked);
    }
    const badge = document.querySelector(`[data-group-count="${g.key}"]`);
    const n = activeInGroup(g);
    badge.textContent = n || '';
    badge.setAttribute('aria-label', n ? plural(n, 'filtre actif', 'filtres actifs') : '');
  }
  document.getElementById('active-filters').innerHTML = activeTags(groups);
}

/** Selected filters as removable tags, shown under the budget. */
function activeTags(groups) {
  const f = state.filters;
  const tags = [];
  if (f.priceMin != null || f.priceMax != null) tags.push({ key: 'price', value: '', label: priceLabel(f.priceMin, f.priceMax) });
  for (const g of groups) {
    for (const it of g.items) if (isActive(g.key, it.value)) tags.push({ key: g.key, value: it.value, label: it.tag ?? it.label });
  }
  if (!tags.length) return '';
  return `<ul class="active-tags">${tags.map((t) => `<li><button type="button" class="active-tag" data-unfilter="${t.key}" data-value="${esc(t.value)}"
      aria-label="Retirer le filtre ${esc(t.label)}"><span>${esc(t.label)}</span><span class="x" aria-hidden="true">×</span></button></li>`).join('')}</ul>`;
}

function removeFilter(key, value) {
  const f = state.filters;
  if (key === 'price') {
    f.priceMin = null;
    f.priceMax = null;
    const lo = document.getElementById('f-price-min'), hi = document.getElementById('f-price-max');
    lo.value = lo.min;
    hi.value = hi.max;
    paintPriceRange();
  } else if (key === 'onSaleOnly') f.onSaleOnly = false;
  else f[key] = f[key].filter((x) => x !== value);
  updateResults();
}

function setFiltersOpen(open) {
  document.getElementById('filters')?.classList.toggle('open', open);
  const backdrop = document.querySelector('.filters-backdrop');
  if (backdrop) backdrop.hidden = !open;
  document.body.classList.toggle('no-scroll', open);
  document.querySelector('[data-action="open-filters"]')?.setAttribute('aria-expanded', open);
}

// ---------------------------------------------------------------------------
// Comparison

function renderCompare(ids) {
  const models = ids.map((id) => state.byId.get(id)).filter(Boolean);
  // A shared link becomes the current selection.
  if (models.length && models.map((m) => m.id).join() !== state.compare.join()) setCompare(models.map((m) => m.id));

  if (models.length < 2) {
    app.innerHTML = `<div class="page narrow"><h1 class="page-title">Comparaison</h1>
      <div class="empty-state"><p>Sélectionnez au moins deux modèles dans le catalogue avec le bouton « Comparer ».</p>
      <a class="btn btn-primary" href="#/">Parcourir le catalogue</a></div></div>`;
    return;
  }
  if (state.mobilePair.some((i) => i >= models.length)) state.mobilePair = [0, 1];

  const head = models.map((m) => `<th scope="col" class="model-col">
      <div class="col-head">
        ${media(m, 'col-media')}
        <p class="brand">${esc(m.brand)}</p>
        <a class="model-name" href="#/modele/${esc(m.id)}">${esc(m.name)}</a>
        ${priceHtml(m)}
        <button type="button" class="btn-link small" data-remove="${esc(m.id)}">Retirer</button>
      </div></th>`).join('');

  const blank = models.length < MAX_COMPARE
    ? `<th scope="col" class="model-col add-col"><a class="add-slot" href="#/">+ Ajouter un modèle</a></th>` : '';

  const body = SECTIONS.map((s) => {
    const rows = FIELDS.filter((f) => f.section === s.id).map((f) => {
      const { vals, same, best } = rowInfo(f, models);
      return `<tr class="${same ? 'same' : 'diff'}"><th scope="row">${esc(f.label)}</th>
        ${vals.map((v, i) => `<td class="${best.includes(i) ? 'best' : ''}">${valueHtml(v, f, models[i])}${best.includes(i) ? '<span class="sr-only"> (meilleure valeur)</span>' : ''}</td>`).join('')}
        ${blank ? '<td class="add-col"></td>' : ''}</tr>`;
    });
    const allSame = !rows.some((r) => r.startsWith('<tr class="diff"'));
    return `<tbody class="${allSame ? 'all-same' : ''}">
      <tr class="section-row"><th colspan="${models.length + 1 + (blank ? 1 : 0)}" scope="colgroup">${esc(s.label)}</th></tr>
      ${rows.join('')}</tbody>`;
  }).join('');

  app.innerHTML = `<div class="page compare-page ${state.diffOnly ? 'diff-only' : ''}">
    <div class="page-head">
      <div>
        <a class="back" href="#/">← Catalogue</a>
        <h1 class="page-title">Comparaison</h1>
      </div>
      <div class="page-actions">
        <label class="switch"><input type="checkbox" id="diff-only" ${state.diffOnly ? 'checked' : ''}><span class="track" aria-hidden="true"></span> Différences uniquement</label>
        <button type="button" class="btn btn-ghost" data-action="share" data-share-msg="Lien de la comparaison copié">Copier le lien</button>
      </div>
    </div>
    <p class="legend"><span class="legend-best">Meilleure valeur</span>
      <span class="flag flag-unknown">? Inconnu</span> absent de la notice ·
      <span class="na">—</span> non applicable ·
      <span class="flag flag-empty">Non renseigné</span> à compléter</p>
    <div class="table-wrap only-desktop">
      <table class="compare-table cols-${models.length + (blank ? 1 : 0)}">
        <thead><tr><td class="corner"></td>${head}${blank}</tr></thead>
        ${body}
      </table>
    </div>
    ${mobileCompare(models)}
  </div>`;
}

function mobileCompare(all) {
  const pair = state.mobilePair.map((i) => all[i]);
  const picker = all.length > 2
    ? `<div class="pair-picker" role="group" aria-label="Modèles affichés (2 maximum)">
        ${all.map((m, i) => `<button type="button" class="chip" data-pair="${i}" aria-pressed="${state.mobilePair.includes(i)}">${esc(m.name)}</button>`).join('')}
      </div>` : '';
  const tabs = SECTIONS.map((s) => `<button type="button" role="tab" class="tab" id="tab-${s.id}" data-tab="${s.id}"
      aria-selected="${state.mobileTab === s.id}" aria-controls="m-panel">${esc(s.label)}</button>`).join('');
  const rows = FIELDS.filter((f) => f.section === state.mobileTab).map((f) => {
    const { vals, same, best } = rowInfo(f, pair);
    return `<div class="m-row ${same ? 'same' : 'diff'}">
      <p class="m-label">${esc(f.label)}</p>
      <div class="m-vals">${vals.map((v, i) => `<div class="m-val ${best.includes(i) ? 'best' : ''}">${valueHtml(v, f, pair[i])}</div>`).join('')}</div>
    </div>`;
  }).join('');
  return `<div class="m-compare only-mobile">
    ${picker}
    <div class="m-heads">${pair.map((m) => `<div class="m-head">
        ${media(m, 'm-media')}
        <p class="brand">${esc(m.brand)}</p>
        <a class="model-name" href="#/modele/${esc(m.id)}">${esc(m.name)}</a>
        ${priceHtml(m)}</div>`).join('')}</div>
    <div class="tabs" role="tablist" aria-label="Sections">${tabs}</div>
    <div class="m-rows" id="m-panel" role="tabpanel" aria-labelledby="tab-${state.mobileTab}">${rows}
      <p class="m-empty">Aucune différence dans cette section.</p></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Model page

function renderModel(id) {
  const m = state.byId.get(id);
  if (!m) {
    app.innerHTML = `<div class="page narrow"><h1 class="page-title">Modèle introuvable</h1>
      <div class="empty-state"><p>Ce modèle n’existe pas ou a été renommé dans la feuille.</p>
      <a class="btn btn-primary" href="#/">Retour au catalogue</a></div></div>`;
    return;
  }
  const stateCount = (st) => FIELDS.filter((f) => m.values[f.key].state === st).length;
  const unknown = stateCount('unknown'), empty = stateCount('empty');

  const fullName = `${m.brand} ${m.name}`;
  const fixUrl = (f) => {
    const fields = { title: `[Correction] ${fullName}${f ? ` · ${f.label}` : ''}`, modele: fullName, lien: location.href };
    if (f) {
      const val = m.values[f.key];
      Object.assign(fields, { champ: f.label, actuel: val.state === 'ok' ? val.text : val.state === 'unknown' ? 'Inconnu' : val.state === 'na' ? 'Non applicable' : 'Non renseigné' });
    }
    return issueUrl('correction', fields);
  };
  const sections = SECTIONS.map((s) => `<section class="spec-card">
      <h2>${esc(s.label)}</h2>
      <dl>${FIELDS.filter((f) => f.section === s.id).map((f) => {
        const url = fixUrl(f);
        return `<div class="spec-row"><dt>${esc(f.label)}</dt><dd>${valueHtml(m.values[f.key], f, m)}</dd>${url
          ? `<a class="row-fix" href="${esc(url)}" target="_blank" rel="noopener" title="Signaler une erreur sur ce champ" aria-label="Signaler une erreur : ${esc(f.label)}">✎</a>` : ''}</div>`;
      }).join('')}</dl>
    </section>`).join('');
  const meta = [
    m.onSale === false ? '<span class="badge badge-off">Plus commercialisé</span>' : '',
    m.updatedAt ? `Fiche mise à jour le <span class="mono">${fmtDate(m.updatedAt)}</span>` : '',
    m.contributors.length ? `Contributeurs : ${m.contributors.map(esc).join(', ')}` : '',
  ].filter(Boolean);

  const level = m.completeness >= 90 ? 'high' : m.completeness >= 60 ? 'mid' : 'low';
  app.innerHTML = `<div class="page model-page">
    <a class="back" href="#/">← Catalogue</a>
    <section class="hero">
      ${media(m, 'hero-media')}
      <div class="hero-info">
        <p class="brand">${esc(m.brand)}</p>
        <h1 class="model-name hero-name">${esc(m.name)}</h1>
        <p class="hero-price">${priceHtml(m)}${m.year ? ` <span class="muted">· sorti en <span class="mono">${m.year}</span>${m.yearUncertain ? ' (à vérifier)' : ''}</span>` : ''}</p>
        <ul class="tags">${algoTags(m)}</ul>
        ${meta.length ? `<p class="hero-meta">${meta.join('<span aria-hidden="true"> · </span>')}</p>` : ''}
        <div class="hero-actions">
          ${compareButton(m, 'btn-large')}
          ${state.data.site ? `<button type="button" class="btn btn-ghost" data-action="share-model" data-id="${esc(m.id)}">Partager la fiche</button>` : ''}
          ${fixUrl() ? `<a class="btn btn-ghost" href="${esc(fixUrl())}" target="_blank" rel="noopener">Signaler une erreur</a>` : ''}
        </div>
        <div class="completeness completeness-${level}">
          <div class="completeness-top"><span>Complétude de la fiche</span><span class="mono">${m.completeness} %</span></div>
          <div class="bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.completeness}" aria-label="Complétude de la fiche"><span style="width:${m.completeness}%"></span></div>
          <p class="hint">${unknown ? `${plural(unknown, 'valeur absente', 'valeurs absentes')} de la notice` : 'Aucune valeur inconnue'}${empty ? ` · ${plural(empty, 'champ', 'champs')} à compléter` : ''}${m.status !== 'Done' ? ' · fiche en cours de saisie' : ''}</p>
        </div>
      </div>
    </section>
    <div class="spec-grid">${sections}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Router

// Catalogue filters <-> URL query, e.g. #/?prix=200-800&marques=SUUNTO,MARES&options=sonde,bungee
const LIST_PARAMS = { marques: 'brands', algos: 'algos', formats: 'formats', modes: 'modes', options: 'options', alimentation: 'power' };
// Option names used in links shared before the current filters.
const LEGACY_OPTIONS = { airIntegration: ['options', 'sonde'], rechargeable: ['power', 'batterie'], trimix: ['modes', 'trimix'], ccr: ['modes', 'ccr'] };

function filtersToQuery(f) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.priceMin != null || f.priceMax != null) p.set('prix', `${f.priceMin ?? ''}-${f.priceMax ?? ''}`);
  for (const [param, key] of Object.entries(LIST_PARAMS)) if (f[key].length) p.set(param, f[key].join(','));
  if (f.onSaleOnly) p.set('dispo', 'en-vente');
  if (f.sort !== 'brand') p.set('tri', f.sort);
  return p.toString().replace(/%2C/g, ',');
}

function queryToFilters(query) {
  const p = new URLSearchParams(query);
  const f = defaultFilters();
  const known = {
    brands: brandList(), algos: ALGOS.map((a) => a.id), formats: FORMATS,
    modes: MODES.map((x) => x.id), options: OPTIONS.map((o) => o.id), power: POWER.map((x) => x.id),
  };
  f.q = p.get('q') || '';
  const [lo, hi] = (p.get('prix') || '').split('-').map((x) => (x === '' || Number.isNaN(+x) ? null : +x));
  f.priceMin = lo ?? null;
  f.priceMax = hi ?? null;
  for (const [param, key] of Object.entries(LIST_PARAMS)) {
    f[key] = (p.get(param) || '').split(',').filter((x) => known[key].includes(x));
  }
  for (const o of (p.get('options') || '').split(',')) {
    const [key, value] = LEGACY_OPTIONS[o] || [];
    if (key && !f[key].includes(value)) f[key].push(value);
  }
  f.onSaleOnly = p.get('dispo') === 'en-vente';
  if (SORTS[p.get('tri')]) f.sort = p.get('tri');
  return f;
}

function parseRoute() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [, name, arg] = path.match(/^([^/]*)\/?(.*)$/) || [];
  if (name === 'modele') return { name: 'model', id: decodeURIComponent(arg) };
  if (name === 'comparer') return { name: 'compare', ids: arg.split(',').filter(Boolean).map(decodeURIComponent).slice(0, MAX_COMPARE) };
  return { name: 'catalogue', query };
}

function render() {
  if (!state.data) return;
  const prev = state.route;
  if (prev?.name === 'catalogue') state.catalogueScroll = window.scrollY;
  document.body.classList.remove('no-scroll');
  state.route = parseRoute();
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === state.route.name));

  if (state.route.name === 'model') renderModel(state.route.id);
  else if (state.route.name === 'compare') renderCompare(state.route.ids);
  else {
    // A search link wins over the filters remembered for this session.
    if (state.route.query) state.filters = queryToFilters(state.route.query);
    renderCatalogue();
  }

  const m = state.route.name === 'model' && state.byId.get(state.route.id);
  document.title = m ? `${m.brand} ${m.name} · Bathy`
    : state.route.name === 'compare' ? 'Comparaison · Bathy' : 'Bathy · Comparateur d’ordinateurs de plongée';
  if (state.route.name !== 'catalogue' && prev && (prev.name !== state.route.name || prev.id !== state.route.id)) window.scrollTo(0, 0);
  renderTray();
}

// ---------------------------------------------------------------------------
// Events (delegated, so re-rendering never loses listeners)

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a, [data-action]');
  if (!t) return;
  const f = state.filters;
  if (t.dataset.compare) return toggleCompare(t.dataset.compare);
  if (t.dataset.unselect) return setCompare(state.compare.filter((x) => x !== t.dataset.unselect));
  if (t.dataset.remove) {
    const ids = state.compare.filter((x) => x !== t.dataset.remove);
    setCompare(ids);
    location.hash = compareHref(ids);
    return;
  }
  if (t.dataset.unfilter) return removeFilter(t.dataset.unfilter, t.dataset.value);
  if (t.dataset.tab) { state.mobileTab = t.dataset.tab; return renderCompare(state.route.ids); }
  if (t.dataset.pair) {
    const i = +t.dataset.pair;
    if (!state.mobilePair.includes(i)) state.mobilePair = [state.mobilePair[1], i].sort();
    return renderCompare(state.route.ids);
  }
  if (t.getAttribute('aria-disabled') === 'true') return e.preventDefault();
  switch (t.dataset.action) {
    case 'clear-compare': return setCompare([]);
    case 'open-filters': return setFiltersOpen(true);
    case 'close-filters': return setFiltersOpen(false);
    case 'reset-filters':
      state.filters = { ...defaultFilters(), sort: f.sort };
      return renderCatalogue();
    case 'share':
      navigator.clipboard?.writeText(location.href).then(() => toast(t.dataset.shareMsg || 'Lien copié'),
        () => toast('Copie impossible : utilisez l’adresse de la page'));
      return;
    case 'share-model': {
      // The static page has a proper preview (title, photo) in messaging apps.
      const url = new URL(`modeles/${encodeURIComponent(t.dataset.id)}/`, location.href.split('#')[0]).href;
      navigator.clipboard?.writeText(url).then(() => toast('Lien de la fiche copié'),
        () => toast('Copie impossible'));
      return;
    }
    case 'retry': return boot();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target, f = state.filters;
  if (t.id === 'search') { f.q = t.value; return updateResults(); }
  if (t.id === 'f-price-min' || t.id === 'f-price-max') {
    const lo = document.getElementById('f-price-min'), hi = document.getElementById('f-price-max');
    // The thumbs can't cross: the one being dragged stops at the other.
    if (+lo.value > +hi.value) {
      if (t === lo) lo.value = hi.value; else hi.value = lo.value;
    }
    f.priceMin = +lo.value <= +lo.min ? null : +lo.value;
    f.priceMax = +hi.value >= +hi.max ? null : +hi.value;
    paintPriceRange();
    return updateResults();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target, f = state.filters;
  if (t.id === 'sort') { f.sort = t.value; return updateResults(); }
  if (t.id === 'diff-only') {
    state.diffOnly = t.checked;
    return document.querySelector('.compare-page')?.classList.toggle('diff-only', t.checked);
  }
  const kind = t.dataset.filter;
  if (!kind) return;
  if (kind === 'onSaleOnly') f.onSaleOnly = t.checked;
  else f[kind] = t.checked ? [...f[kind], t.value] : f[kind].filter((x) => x !== t.value);
  updateResults();
});

// "toggle" doesn't bubble: listen in the capture phase.
document.addEventListener('toggle', (e) => {
  const g = e.target.dataset?.group;
  if (!g) return;
  if (e.target.open) state.openGroups.add(g);
  else state.openGroups.delete(g);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setFiltersOpen(false);
});

window.addEventListener('hashchange', render);
mqMobile.addEventListener('change', () => { if (!mqMobile.matches) setFiltersOpen(false); });

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  app.innerHTML = `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span> Chargement des données…</div>`;
  try {
    state.data = await loadData();
  } catch (err) {
    app.innerHTML = `<div class="page narrow"><div class="empty-state error">
      <h1 class="page-title">Impossible de charger les données</h1>
      <p>La feuille Google n’a pas pu être lue (${esc(err.message)}). Vérifiez votre connexion, ou que la feuille est toujours partagée en lecture.</p>
      <button type="button" class="btn btn-primary" data-action="retry">Réessayer</button></div></div>`;
    return;
  }
  const { data } = state;
  state.byId = new Map(data.models.map((m) => [m.id, m]));
  state.compare = state.compare.filter((id) => state.byId.has(id));

  document.getElementById('disclaimer').textContent = data.disclaimer;
  document.getElementById('data-status').innerHTML = data.source === 'cache'
    ? `<span class="warn">Hors ligne : données du ${fmtDate(data.fetchedAt)}</span>`
    : data.source === 'snapshot'
    ? `<span class="warn">Feuille injoignable : copie publiée le ${fmtDate(data.fetchedAt)}</span>`
    : `${plural(data.models.length, 'modèle', 'modèles')} · <a href="${SHEET_URL}" target="_blank" rel="noopener">source</a> lue le ${fmtDate(data.fetchedAt)}`;
  if (data.lastUpdate) document.getElementById('data-status').insertAdjacentHTML('beforeend', ` · dernière modification d’une fiche le ${fmtDate(data.lastUpdate)}`);
  const suggest = issueUrl('nouveau-modele');
  if (suggest) document.getElementById('data-status').insertAdjacentHTML('beforeend', ` · <a href="${esc(suggest)}" target="_blank" rel="noopener">Proposer un modèle manquant</a>`);
  setCompare(state.compare);
  state.route = null;
  render();
}

boot();
