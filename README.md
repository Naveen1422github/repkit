# repkit

Plan your workout week, then run it set by set with a big timer. PWA, works offline, all data stays on your phone.
Live: https://repskit.netlify.app · vanilla JS modules, IndexedDB, zero npm dependencies. Sibling of kharchly and macro.

## run locally
```
python -m http.server 8080      # from this folder; ES modules don't load from file://
```
Open http://localhost:8080. If you see an old version: DevTools → Application → Service Workers → Unregister, then Ctrl+Shift+R.

## test
```
node --test
```

## deploy
Push to `main` — Netlify deploys **repskit.netlify.app** automatically (own origin = own data). **Bump `CACHE_NAME` in `sw.js` on every release** and list every `js/*.js` file in `ASSETS`.
Never change the site URL or the IndexedDB name (`repkit-db`) once live: data is tied to both.

## backup
Settings → backup → **export** saves everything (plan, workouts, photos) to `repkit-backup-YYYY-MM-DD.json`; **import** replaces what is on the phone. Google Drive backup comes later.

## docs
`docs/spec.md` (design) and `docs/plan-*.md` (implementation plans, in order).
