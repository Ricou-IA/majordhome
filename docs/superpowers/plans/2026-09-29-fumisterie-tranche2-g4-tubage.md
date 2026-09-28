# Plan — fumisterie tranche 2 : G4 tubage

Spec : `docs/superpowers/specs/2026-09-29-fumisterie-tranche2-g4-tubage-design.md`.
Critère de succès : `node --test "scripts/fumisterie/*.test.mjs"` vert avec les 4 cas tubage sur
tarif réel pinnés, `npx vite build` + lint verts, seed rejoué en prod, CFG-34/26/35/27 métrables
dans l'app.

1. **Moteur** — `config.js` (3 réglages), `articles.js` (`{BOI}`), `nomenclature.js`
   (alternatives, `par_longueur` sur la composition, `par_longueur_ml`), `gabarits/g4.js` +
   `controlesG4`, `index.js` (G4/G4R, `sortieMinimale` tolérant, `ENGINE_VERSION`).
   Tests : `g4.test.mjs`, ajouts `nomenclature.test.mjs`. Checkpoint : tests verts, CFG-24 inchangé.
2. **Données + seed** — gabarits, nomenclatures, mapping ; `seed-configurations.mjs` générique ;
   `tarif-reel.test.mjs` étendu (4 cas). Checkpoint : aucune ligne à chiffrer sur le tarif réel,
   sinon corriger le mapping (jamais le test).
3. **Service / hook** — `getArticles` charge aussi les gammes sans diamètre ; clé de cache.
4. **Écran** — `ReleveForm` libellés de choix, `CoupeCoteeG4`, `ReleveStep`, hint
   « métrables dans cette version » dans `QualificationStep`, `FumisterieTab` (3 réglages).
   Checkpoint : lint + build.
5. **Prod** — `node scripts/fumisterie/seed-configurations.mjs` puis `apply-sql.mjs` ; vérifier
   en SQL que CFG-34/26/35/27 ont un `gabarit_id`. Push, déploiement, recette Eric.
6. **Docs / mémoire** — tests manuels tranche 2, proposition CLAUDE.md, mémoire projet.
