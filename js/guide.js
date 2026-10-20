// "Trouver mon ordinateur": questions, answer <-> URL mapping and scoring.
// Rendering lives in app.js; this module is pure logic.

import { keyOf } from './data.js';

export const QUESTIONS = [
  {
    id: 'pratique', type: 'single',
    title: 'Quelle plongée pratiquez-vous ?',
    options: [
      { value: 'loisir', label: 'Loisir', desc: 'À l’air ou au nitrox, dans la courbe ou avec des paliers courts.' },
      { value: 'deco', label: 'Nitrox et décompression', desc: 'Plusieurs mélanges, paliers planifiés, jusqu’à 40 m environ.' },
      { value: 'trimix', label: 'Technique au trimix', desc: 'Plongée profonde avec hélium et plusieurs gaz de déco.' },
      { value: 'ccr', label: 'Recycleur (CCR)', desc: 'Circuit fermé, diluants et bailout.' },
    ],
  },
  {
    id: 'usages', type: 'multi',
    title: 'En dehors de la plongée, vous voulez…',
    help: 'Plusieurs choix possibles, ou aucun.',
    options: [
      { value: 'apnee', label: 'Faire de l’apnée', desc: 'Un mode apnée dédié.' },
      { value: 'quotidien', label: 'Le porter tous les jours', desc: 'Un format montre.' },
      { value: 'outdoor', label: 'Randonnée, sport', desc: 'GPS, altimètre ou fonctions multisport.' },
    ],
  },
  {
    id: 'format', type: 'single',
    title: 'Quel format préférez-vous ?',
    options: [
      { value: 'Montre', label: 'Montre', desc: 'Discret, se porte au quotidien.' },
      { value: 'Rectangulaire', label: 'Grand écran', desc: 'La meilleure lisibilité sous l’eau.' },
      { value: 'Rond', label: 'Rond compact', desc: 'Le format classique, souvent le plus abordable.' },
      { value: 'any', label: 'Peu importe' },
    ],
  },
  {
    id: 'budget', type: 'single',
    title: 'Quel est votre budget maximum ?',
    help: 'Prix indicatifs, observés chez les revendeurs français hors promotion. Les modèles sans prix connu sont écartés dès qu’un budget est fixé.',
    options: [
      { value: '400', label: 'Jusqu’à 400 €' },
      { value: '800', label: 'Jusqu’à 800 €' },
      { value: '1200', label: 'Jusqu’à 1 200 €' },
      { value: 'any', label: 'Pas de limite' },
    ],
  },
  {
    id: 'fonctions', type: 'multi',
    title: 'Quelles fonctions comptent pour vous ?',
    help: 'Plusieurs choix possibles, ou aucun.',
    options: [
      { value: 'air', label: 'Intégration d’air', desc: 'La pression de la bouteille au poignet, via un émetteur.' },
      { value: 'couleur', label: 'Écran couleur' },
      { value: 'rechargeable', label: 'Batterie rechargeable' },
      { value: 'pile', label: 'Pile changeable soi-même', desc: 'Sans passer par un atelier.' },
      { value: 'bluetooth', label: 'Bluetooth et application' },
      { value: 'compas', label: 'Compas' },
    ],
  },
  {
    id: 'algo', type: 'single',
    title: 'Un algorithme de décompression préféré ?',
    options: [
      { value: 'any', label: 'Peu importe', desc: 'Le bon choix si vous ne savez pas : tous les algorithmes du marché conviennent à la plongée loisir.' },
      { value: 'gf', label: 'Bühlmann avec gradient factors', desc: 'La référence en plongée technique, conservatisme réglable finement.' },
      { value: 'rgbm', label: 'RGBM' },
      { value: 'vpm', label: 'VPM' },
    ],
  },
];

const Q = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
export const emptyAnswers = () => Object.fromEntries(QUESTIONS.map((q) => [q.id, q.type === 'multi' ? [] : null]));

// ---------------------------------------------------------------------------
// Answers <-> URL query

export function answersToQuery(a) {
  const p = new URLSearchParams();
  for (const q of QUESTIONS) {
    const v = a[q.id];
    if (q.type === 'multi') p.set(q.id, v.join(',') || 'aucun');
    else if (v) p.set(q.id, v);
  }
  return p.toString().replace(/%2C/g, ',');
}

/** Returns the answers, and whether every single-choice question is answered. */
export function queryToAnswers(query) {
  const p = new URLSearchParams(query);
  const a = emptyAnswers();
  for (const q of QUESTIONS) {
    const allowed = q.options.map((o) => o.value);
    const raw = p.get(q.id) || '';
    if (q.type === 'multi') a[q.id] = raw.split(',').filter((x) => allowed.includes(x));
    else a[q.id] = allowed.includes(raw) ? raw : null;
  }
  return { answers: a, complete: isComplete(a) };
}

export const isComplete = (a) => QUESTIONS.every((q) => q.type === 'multi' || a[q.id]);

export function optionLabel(qid, value) {
  return Q[qid].options.find((o) => o.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Scoring

const cell = (m, col) => m.values[keyOf(col)];
// true = yes or optional, false = no, null = unknown / not filled in.
const has = (m, col) => {
  const v = cell(m, col);
  if (v.state !== 'ok' || v.score == null) return null;
  return v.score >= 1;
};

/**
 * Soft criteria for these answers: each has a weight, and a test returning
 * true, false or null (unknown in the data, counted as not met).
 */
function criteria(a) {
  const list = [];
  const add = (label, weight, test) => list.push({ label, weight, test });

  if (a.pratique === 'loisir') add('Mode nitrox', 1, (m) => has(m, 'Mode Nitrox'));
  if (a.pratique === 'deco') {
    add('Au moins 2 mélanges', 3, (m) => (m.gases == null ? null : m.gases >= 2));
    add('Planification avec déco', 1, (m) => {
      const v = cell(m, 'Plannification');
      return v.state === 'ok' ? /avec/i.test(v.text) : null;
    });
  }
  if (a.pratique === 'trimix') add('Au moins 3 mélanges', 2, (m) => (m.gases == null ? null : m.gases >= 3));

  if (a.usages.includes('apnee')) add('Mode apnée', 2, (m) => has(m, 'Mode Apnée'));
  if (a.usages.includes('quotidien')) add('Format montre', 3, (m) => (m.formats.length ? m.formats.includes('Montre') : null));
  if (a.usages.includes('outdoor')) add('Fonctions outdoor (GPS, altimètre…)', 2, (m) => has(m, 'Mode outdoor'));

  if (a.format && a.format !== 'any') add(`Format ${optionLabel('format', a.format).toLowerCase()}`, 4, (m) => (m.formats.length ? m.formats.includes(a.format) : null));

  const f = a.fonctions;
  if (f.includes('air')) add('Intégration d’air', 2, (m) => has(m, 'Gestion gaz'));
  if (f.includes('couleur')) add('Écran couleur', 2, (m) => has(m, 'Écran couleur'));
  if (f.includes('rechargeable')) add('Batterie rechargeable', 2, (m) => (cell(m, 'Type batterie').state === 'ok' ? m.rechargeable : null));
  if (f.includes('pile')) add('Pile changeable soi-même', 2, (m) => {
    const v = cell(m, 'Changement batterie');
    return v.state === 'ok' ? /utilisateur/i.test(v.text) : null;
  });
  if (f.includes('bluetooth')) add('Bluetooth', 2, (m) => has(m, 'Connexion Bluetooth'));
  if (f.includes('compas')) add('Compas', 1, (m) => has(m, 'Compas'));

  if (a.algo === 'gf') add('Bühlmann à gradient factors', 2, (m) => {
    if (!m.algos.includes('buhlmann')) return false;
    const v = cell(m, 'Bühlmann Conservatisme');
    return v.state === 'ok' ? /GF|\d+\s*\/\s*\d+/.test(v.text) : null;
  });
  if (a.algo === 'rgbm') add('Algorithme RGBM', 2, (m) => m.algos.includes('rgbm'));
  if (a.algo === 'vpm') add('Algorithme VPM', 2, (m) => m.algos.includes('vpm'));
  return list;
}

/** Hard constraints: a model failing one is never suggested. */
function eligible(m, a) {
  if (m.onSale === false) return false;
  if (a.pratique === 'trimix' && !m.trimix) return false;
  if (a.pratique === 'ccr' && !m.ccr) return false;
  if (a.budget !== 'any' && (m.price == null || m.price > +a.budget)) return false;
  return true;
}

/**
 * Rank the models for these answers. Ties go to the more complete sheet,
 * then to the lower price.
 */
export function recommend(models, a) {
  const crit = criteria(a);
  const total = crit.reduce((s, c) => s + c.weight, 0);
  return models.filter((m) => eligible(m, a)).map((m) => {
    const reasons = crit.map((c) => ({ label: c.label, ok: c.test(m) }));
    const got = crit.reduce((s, c, i) => s + (reasons[i].ok ? c.weight : 0), 0);
    return { model: m, reasons, match: total ? Math.round((got / total) * 100) : 100 };
  }).sort((x, y) => y.match - x.match
    || (y.model.completeness >= 70) - (x.model.completeness >= 70)
    || (x.model.price ?? Infinity) - (y.model.price ?? Infinity));
}

/** Catalogue filters matching the answers, for "see all in the catalogue". */
export function catalogueFilters(a) {
  const f = {};
  if (a.pratique === 'trimix') f.trimix = true;
  if (a.pratique === 'ccr') f.ccr = true;
  if (a.budget !== 'any') f.priceMax = +a.budget;
  if (a.format && a.format !== 'any') f.formats = [a.format];
  else if (a.usages.includes('quotidien')) f.formats = ['Montre'];
  if (a.fonctions.includes('air')) f.airIntegration = true;
  if (a.fonctions.includes('rechargeable')) f.rechargeable = true;
  if (a.fonctions.includes('bluetooth')) f.bluetooth = true;
  if (a.algo === 'gf') f.algos = ['buhlmann'];
  if (a.algo === 'rgbm' || a.algo === 'vpm') f.algos = [a.algo];
  return f;
}
