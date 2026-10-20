# Palier — dive computer comparison web app

## Goal
A web app to browse, filter and compare dive computer specs.
Desktop first, but it must work well on smartphones (≥ 360 px).
UI copy is in French. Code, comments and docs are in English.

## Data source
- Google Sheet "Comparatif ordinateurs v2"
  https://docs.google.com/spreadsheets/d/1n0uF-w1mjwbEsCtT_uA0HW3vu5XMKe5BGBjKSVCpMOk
- Read it as CSV: `https://docs.google.com/spreadsheets/d/1n0uF-w1mjwbEsCtT_uA0HW3vu5XMKe5BGBjKSVCpMOk/export?format=csv`
  (the sheet must stay shared as "anyone with the link can view").
- The sheet is the single source of truth: the app reads it at load or build time, with no manual copy of the data.
- Row 1 is a credit/disclaimer line (author: Christophe Poulette, free to share, data taken from manufacturer manuals and not peer-reviewed). Show this disclaimer in the app.
- Row 2 holds the headers. One row = one model.
- Columns: Marque, Modèle, Photo, Statut (Done/Todo), Notice, Sortie, Prix France, Bühlmann, Bühlmann Conservatisme, RGBM, RGBM Conservatisme, VPM, VPM Conservatisme, Pelagic, DCIEM, Palier profond, Palier facultatif, Dernier palier, Vitesse remontée, Affichage vitesse, Viol Déco Blocage, Plannification, Mode Air/Nitrox/Profond/Apnée/Normoxique/Hypoxique/CCR, Nombre de gaz, PpO₂, %O₂, %He, Alarme visuelle/sonore/vibration, Format, Bracelet, Bungee, Écran type/couleur/éclairage/tactile, Type batterie, Autonomie batterie, Changement batterie, Profondeur max, Réglage altitude, Mémoire, Courbe plongée, Mise à jour, Connexion USB/Bluetooth, Application smartphone, Compas, Chronomètre, Gestion gaz, Cardio fréquencemètre, Température corporelle, Mode outdoor, Alarme Déco Exponentielle, Analyseur d'O², Gas Blender Intégré.

### Data quirks to handle
- `???` means unknown (missing from the manual). `-` means not applicable. An empty cell means not filled in yet.
- Free text needs parsing:
  - prices: `"1 549,99 €"`
  - depths: `"130m"` / `"120"`
  - gases: `"6 mélanges"` / `"9 mélanges + 8 diluants"`
  - years: `"2013 (?)"`
- Yes/no fields contain `Oui` / `Non` / `En option`.
- Some cells contain line breaks, for example the conservatism presets.
- Photo cells are images embedded in the sheet and are not exported to CSV. Plan another way to get images (a dedicated column with URLs, or local files), and use a silhouette per format as the fallback.
- Trimix is the `Mode Hypoxique` column.

## Screens (mockups already designed)
1. **Catalogue**
   - Sidebar filters: budget, algorithm, format, trimix, CCR, air integration, rechargeable battery, Bluetooth, max depth.
   - Search and sort.
   - Card grid.
   - Select up to 3 models for comparison, shown in a sticky "compare" tray.
2. **Comparison**
   - Side-by-side table with up to 3 models, grouped by section: Général, Décompression, Gaz & modes, Écran & énergie, Connectivité & extras.
   - A "differences only" toggle.
   - The best value of each row is highlighted.
   - Unknown values are flagged.
   - The comparison can be shared via its URL.
3. **Model page**
   - Key figures, specs by section, link to the manual, a data-completeness indicator, and similar models.
4. **Mobile**
   - Compact list with horizontally scrolling filter chips.
   - 2-model comparison with section tabs and the label above the values.

## Visual direction
- Colors:
  - ink `#0E1A24`
  - background `#F3F5F4`
  - surface `#FFFFFF`
  - borders `#D5DCDF`
  - muted text `#4A5A66`
  - accent `#C2410C` (fill `#FFEDD5`, light `#FB923C` on dark)
  - tags `#E0F2F1` / `#134E4A`
- Fonts:
  - Barlow Condensed for titles, model names and prices
  - IBM Plex Sans for body text
  - IBM Plex Mono for technical values
- Accessibility: touch targets ≥ 44 px, contrast ≥ 4.5:1.

## Ideas for later
- A "Find my computer" quiz that presets the filters.
- A chart of the GF presets per model.
- PDF export.
- A "report an error" link.

