# rsandroni1.github.io

Personal app platform. A launcher (`/`) plus a set of installable PWAs hosted under their own paths.

## Apps

- `/enso/` — Enso, hybrid practice tracker (running + strength)
- `/vault/` — PIN Vault, AES-256-GCM encrypted notes
- `/wine-inventory/` — Wine inventory app with Firebase sync

## Structure

- `index.html` + `store.js` + `store.css` + `store-manifest.json` + `store-sw.js` — the launcher
- `apps.json` — registry of apps shown by the launcher
- `.nojekyll` — disables Jekyll; the site is plain static HTML/CSS/JS

## Adding an app

1. Create a new directory at the repo root (e.g. `/myapp/`).
2. Drop in `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` plus any app code.
3. Append an entry to `apps.json` matching the existing schema.

That's it — push to `master` and GitHub Pages serves it.
