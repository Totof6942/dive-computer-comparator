# Bathy — dive computer comparison web app

## Goal
A web app to browse, filter and compare dive computer specs.
Desktop first, but it must work well on smartphones (≥ 360 px).
UI copy is in French. Code, comments and docs are in English.

## Data source
- Google Sheet "Comparatif ordinateurs v2"
  https://docs.google.com/spreadsheets/d/1n0uF-w1mjwbEsCtT_uA0HW3vu5XMKe5BGBjKSVCpMOk
- Read it as CSV: `https://docs.google.com/spreadsheets/d/1n0uF-w1mjwbEsCtT_uA0HW3vu5XMKe5BGBjKSVCpMOk/export?format=csv`
  (the sheet must stay shared as "anyone with the link can view").
- The sheet is the single source of truth: the browser reads it live on every load. Fallbacks: `data/sheet.csv` (snapshot written by the build), then the last good copy in `localStorage`. The live read times out after 8 s.
- Row 1 is a credit/disclaimer line, shown in the footer. Before display, "Libre de diffusion" is removed and the e-mail address is replaced by `poulette.christophe[at]gmail[dot]com` (anti-bot), in `js/data.js`.
- Row 2 holds the headers. One row = one model. Columns are matched by header name, ignoring case, accents and line breaks.
- Columns: Marque, Modèle, Photo, Statut (Done/Todo), Notice, Sortie, Prix France, Bühlmann, Bühlmann Conservatisme, RGBM, RGBM Conservatisme, VPM, VPM Conservatisme, Pelagic, DCIEM, Palier profond, Palier facultatif, Dernier palier, Vitesse remontée, Affichage vitesse, Viol Déco Blocage, Plannification, Mode Air/Nitrox/Profond/Apnée/Normoxique/Hypoxique/CCR, Nombre de gaz, PpO₂, %O₂, %He, Alarme visuelle/sonore/vibration, Format, Bracelet, Bungee, Écran type/couleur/éclairage/tactile, Type batterie, Autonomie batterie, Changement batterie, Profondeur max, Réglage altitude, Mémoire, Courbe plongée, Mise à jour, Connexion USB/Bluetooth, Application smartphone, Compas, Chronomètre, Gestion gaz, Cardio fréquencemètre, Température corporelle, Mode outdoor, Alarme Déco Exponentielle, Analyseur d'O², Gas Blender Intégré.
- Optional columns, not in the sheet yet; each feature stays hidden while its column is missing:
  - `ID`: stable model id (URL and folder name). Without it, the id is a slug of `Marque + Modèle`.
  - `Commercialisé` (Oui/Non): "Plus commercialisé" badge and the Disponibilité filter.
  - `Dernière modification` (date) and `Contributeurs` (names): shown on the model page. Not to be confused with `Mise à jour` (software updates).
  - `Photo URL`: `https://` link to a photo.

### Data quirks to handle
- `???` means unknown (missing from the manual). `-` means not applicable. An empty cell means not filled in yet.
- Free text needs parsing:
  - prices: `"1 549,99 €"`
  - depths: `"130m"` / `"120"`
  - gases: `"6 mélanges"` / `"9 mélanges + 8 diluants"` (the first number is used)
  - years: `"2013 (?)"`
- Yes/no fields contain `Oui` / `Non` / `En option`. "En option" counts as available in filters.
- Some cells contain line breaks, for example the conservatism presets.
- Photo cells are images embedded in the sheet and are not exported to CSV. They were extracted once from the XLSX export into `modeles/<id>/photo.png` (137 models). Models without a photo show a silhouette per format.
- Trimix is the `Mode Hypoxique` column.

## Architecture
- Static site, no framework and no build step for the app: `index.html`, `css/styles.css`, `js/app.js` (views, router, filters), `js/data.js` (CSV parsing, field catalogue, filter definitions), `js/silhouettes.js`.
- Hash routes: `#/` (catalogue, filters mirrored in the query: `prix`, `marques`, `formats`, `modes`, `options`, `algos`, `alimentation`, `dispo`, `tri`, `q`), `#/modele/<id>`, `#/comparer/<id>,<id>,<id>`.
- `modeles/<id>/` holds `photo.*`, an optional manual `.pdf` and a generated `fiche.json`.
- Manual links: the "Notice" cells hold Google Drive file chips, one per manual, each with its own link. The CSV export drops links and the XLSX export keeps one per cell, so `scripts/build.mjs` reads them from the HTML export (`export?format=zip`) into `data/manuals.json` (file name → link), which the app loads. Every manual listed in a cell is linked. New links reach the app on the next build. A PDF in `modeles/<id>/` wins over the Drive link for the first manual.
- `scripts/build.mjs` reads the sheet, updates `data/` and `modeles/<id>/fiche.json`, and writes `_site/` with one static, indexable page per model and `sitemap.xml`.
- GitHub repo `Totof6942/dive-computer-comparator`, deployed to GitHub Pages by `.github/workflows/publish.yml` on push to `main` or on demand. The workflow does not commit anything back.
- Corrections and missing models go through GitHub issue forms (`.github/ISSUE_TEMPLATE/`). The repo is derived from the `*.github.io` address.
- Local dev: `python3 serve.py` (no-cache server; `python3 serve.py 8000 _site` to preview the built site).
- Storage keys: `bathy.compare` (localStorage), `bathy.filters` (sessionStorage), `bathy.csv` (offline copy).

## Screens
1. **Catalogue**
   - Sidebar: Budget (two-thumb slider, always open), then the active filters as removable tags, then folded groups that open on click: Marque, Format, Modes, Options, Algorithme, Alimentation (and Disponibilité when the column exists).
   - Options inside a group are in alphabetical order, except Modes: Air, Nitrox, Trimix, CCR, Apnée, Profondimètre.
   - Options: Alarme sonore, Alarme par vibrations, Application mobile, Compas numérique, Fixation bungee, Multi-gaz (≥ 2 mixes), Écran couleur, Intégration d'air (sonde), Planification avec déco. Alimentation: Pile, Batterie.
   - Within a group: Marque, Format, Algorithme and Alimentation combine with OR; Modes and Options with AND.
   - Counts are faceted: they follow the other active filters, and options at 0 are dimmed but stay clickable.
   - Search, sort (Marque, Prix croissant, Prix décroissant, Plus récents) and "Partager la recherche".
   - Cards: photo, brand, name, price, "year · N gaz", one tag per algorithm (short form: `ZH-L16C`, `VPM`…; "Bühlmann" when the variant is not given).
   - Up to 3 models selected for comparison, shown in a sticky tray.
2. **Comparison**
   - Side-by-side table with up to 3 models, grouped by section: Général, Décompression, Gaz & modes, Écran & énergie, Connectivité & extras.
   - A "differences only" toggle. The best value of each row is highlighted. Unknown, not applicable and not-filled values are flagged.
   - The comparison can be shared via its URL.
3. **Model page**
   - Header block: photo, brand, name, price and year, algorithm tags, Comparer / Partager la fiche / Signaler une erreur, data-completeness indicator.
   - Specs by section. The manual is only listed in Général (a link when the PDF is in the model folder).
4. **Mobile**
   - Compact list, with a single "Filtres" button opening the filter sheet.
   - 2-model comparison with section tabs and the label above the values.

### Removed on purpose — don't add back without asking
"Trouver mon ordinateur" quiz and its banner, XLSX export, the "prix indicatifs" notice, max-depth filter and sort, "fiches complètes" sort and filter, quick filter chips on mobile, the five key-figure blocks and the similar models on the model page, the nightly sheet sync commit.

## Visual direction
- Colors:
  - ink `#0E1A24`
  - background `#F3F5F4`
  - surface `#FFFFFF`
  - borders `#D5DCDF`
  - muted text `#4A5A66`
  - accent `#006E9C` (fill `#E0F5FD`, Shearwater blue `#00AEEF` on dark)
  - default tags `#E0F2F1` / `#134E4A`
  - algorithm tags: Bühlmann `#E0F2F1`/`#134E4A`, RGBM `#DBEAFE`/`#1E3A8A`, VPM `#EDE9FE`/`#4C1D95`, Pelagic `#FCE7F3`/`#831843`, DCIEM `#E2E8F0`/`#1E293B`
  - yellow is reserved for "Inconnu" flags
- Logo: a dive profile (surface, descent, bottom, ascent to a stop, back to the surface — it ends at the height it starts) next to "BATHY"; the favicon is the same curve on a dark tile.
- Fonts:
  - Barlow Condensed for titles, model names and prices
  - IBM Plex Sans for body text
  - IBM Plex Mono for technical values
- Accessibility: touch targets ≥ 44 px, contrast ≥ 4.5:1.

## Ideas for later
- A chart of the GF presets per model.
- PDF / print version of a comparison.
- Fill in the sheet: "GF libres" where the manuals confirm custom GF, the Luna gas count (`3 mélanges (option PMG)`), the obfuscated e-mail in row 1.
