# Vague de correctifs finale — entité chantier (2026-10-01)

## Par finding
1. Plafond `realise` au groupement
   - `supabase/migrations/20260930_12_chantiers_rpc.sql` `chantier_group` : après la boucle, si le statut cible vaut `facture`, lecture de `chantier_quote_stats` (`validated_count`, `invoiced_count`) pour la cible ; `validated = 0` ou `invoiced < validated` => `realise`. Variables `v_validated`, `v_invoiced` ajoutées.
   - `src/lib/chantierSplit.js::resumeGroupement` : même règle (au moins une ligne avec `validated_quotes_count > 0`, et toute ligne avec devis validés `is_invoiced === true`), JSDoc mise à jour.
   - `scripts/chantier-split.test.mjs` : test existant adapté (`is_invoiced`, cible `facture` + source `planification` non facturée => `realise`) ; nouveau test « tout facturé => facture ; sans devis validé => realise ».
   - `scripts/migration-rehearsal/assert-chantiers.sql` §B, nouvelle assertion B5b (après B5) : détache le devis `…02` de la cible (nouveau chantier), force ce chantier en `facture`, le regroupe sur la cible, attend `realise`.
2. Verrou `pg_advisory_xact_lock(hashtext(p_lead_id::text))` dans `chantier_ensure_for_lead`, juste avant le `SELECT id INTO v_id` (après les gardes).
3. `chantier_detach` : `v_quotes := array_agg(DISTINCT …)`, `p_quote_ids` remplacé partout (validations, UPDATE devis/réceptions, libellé/statut, activité) ; NULL ou `cardinality = 0` => `invalid_selection`.
4. `COALESCE(status, '') <> ALL (…)` dans `chantier_delete` et dans la validation des RDV de `chantier_detach`.
5. `src/shared/hooks/usePennylane.js` : 3 clés `['chantiers']` => `chantierKeys.all(orgId)` (import déjà présent, `orgId` déjà utilisé dans chaque hook).
6. `ChantierModal.jsx` ~l.253 : commentaire corrigé.

## Commandes
- `node --test scripts/chantier-split.test.mjs` : 11 tests, 11 pass, 0 fail.
- run.mjs (fixture + migrations 11/12/13 + assert-chantiers) : `§A OK`, `§B OK`, `§C OK`, `[rehearsal] OK`.
- `npm run lint:errors` : 0 erreur. `npm run lint` (`--max-warnings 0`) : OK. `npx vite build` : OK.

## Mutation finding 1
`v_t.chantier_status := 'realise'` remplacé temporairement par `'facture'` : le harnais échoue
(`ERROR: B5b : groupe non intégralement facturé, statut plafonné à realise attendu, trouvé facture`).
Code remis, harnais de nouveau vert.

## Concerns
- `invoiced_count` (quote_status = 'invoiced') est comparé à `validated_count` (accepted + invoiced) : un groupe mêlant accepted/invoiced reste plafonné à `realise`, voulu.
- Dédoublonnage des `p_appointment_ids` non demandé, non fait (le compte d'invalid_appointments y serait sensible de la même façon).
