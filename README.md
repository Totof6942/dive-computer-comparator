# Palier

Static web app to browse, filter and compare dive computers: plain HTML, CSS and JS modules. The app itself needs no build step; `scripts/build.mjs` only prepares the published site (data snapshot, one static page per model).

## Run

Serve the folder over HTTP (ES modules don't load from `file://`):

```bash
python3 serve.py
```

`serve.py` is `http.server` with caching disabled. With plain `python3 -m http.server`, the browser can keep an old JS module after an update and the page stays blank (fix: Ctrl+Shift+R).

Then open http://localhost:8000. In `public_html`, Apache serves it as is.

To preview the published site, static model pages included:

```bash
node scripts/build.mjs && python3 serve.py 8000 _site
```

## Data

The Google Sheet is read live by the browser on every load (`js/data.js`, `CSV_URL`). When it can't be reached, the app falls back to `data/sheet.csv` (snapshot published with the site), then to the last good copy kept in `localStorage`.

- Columns are matched by header name, ignoring case, accents and line breaks, so reordering columns in the sheet is fine.
- The field list, its comparison sections and the "best value" rules live in `FIELDS` in `js/data.js`.
- Model IDs (used in URLs and folder names) come from an optional `ID` column, otherwise from `Marque + Modèle`, e.g. `shearwater-perdix-2`. Without an `ID` column, renaming a model in the sheet changes its URL and orphans its `modeles/<id>/` folder.

## Photos and manuals

Each model has a folder `modeles/<id>/`. Drop files there:

- **Photo**: `photo.webp` (or `.jpg`, `.png`, `.avif`). About 600 px wide, WebP, ~50 KB. Without a photo, a silhouette of the format is shown (`js/silhouettes.js`).
- **Manual**: any `.pdf`. GitHub refuses files over 100 MB and Pages sites over ~1 GB, so compress large manuals or link to the manufacturer instead: an `https://` URL in the `Notice` cell, or `MANUALS_BASE_URL` in `js/data.js`.

`fiche.json` in the same folder is generated: don't edit it, edit the sheet. A `Photo URL` column with `https://` links also works.

## Optional sheet columns

Add these columns to the sheet (any position) to enable the matching features. While a column is missing, its feature stays hidden.

- `Commercialisé` (`Oui` / `Non`): "Plus commercialisé" badge and a filter to hide those models. Empty cells count as on sale.
- `Dernière modification` (date): shown on the model page; the most recent one is shown in the footer. Not to be confused with the existing `Mise à jour` column (software updates).
- `Contributeurs` (names separated by commas): shown on the model page.

## Corrections and new models

On GitHub Pages the repository is detected from the address (`owner.github.io/repo`); set `GITHUB_REPO` in `js/data.js` only for a custom domain. The app then shows "Signaler une erreur" links (one per model, and one per spec row on hover) and "Proposer un modèle manquant". They open the issue forms in `.github/ISSUE_TEMPLATE/`, pre-filled with the model, field and current value.

## Publishing (GitHub Pages)

`.github/workflows/publish.yml` runs on every push to `main` and on demand (Actions → "Publier le site" → Run workflow). It runs `node scripts/build.mjs`, which reads the sheet, then deploys `_site/`: the app, one static page per model at `modeles/<id>/` (indexable, with link previews) and `sitemap.xml`. Nothing is committed back to the repo.

The app always reads the sheet live; the static model pages only reflect the sheet as of the last deployment. To refresh them, run the workflow by hand.

To update the committed data files (`data/`, `modeles/<id>/fiche.json`), run `node scripts/build.mjs` locally and commit.

One-time setup: Settings → Pages → Source: **GitHub Actions**.

## Export

The catalogue (current filtered list) and the comparison can be exported to `.xlsx`. SheetJS is loaded from cdnjs on first use.

## Routes

- `#/?prix=300-800&marques=SUUNTO,MARES&algos=vpm&formats=Montre&options=trimix,bluetooth&tri=priceAsc&q=…`: catalogue. The filters are mirrored in the URL so a search can be shared; `#/` alone restores the session's filters.
- `#/modele/<id>`: model page
- `#/guide`: "Trouver mon ordinateur" quiz. Results are shareable: `#/guide?pratique=loisir&usages=apnee&format=any&budget=800&fonctions=air,bluetooth&algo=any`. Questions and scoring live in `js/guide.js`.
- `#/comparer/<id>,<id>,<id>`: comparison (shareable link)
