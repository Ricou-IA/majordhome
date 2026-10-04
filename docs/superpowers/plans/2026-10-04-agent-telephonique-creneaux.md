# Plan — agent téléphonique : proposer et poser un créneau d'entretien

Spec : `docs/superpowers/specs/2026-10-04-agent-telephonique-creneaux-design.md`.
Chaque étape se termine par sa preuve ; on n'empile pas sur une étape rouge.

| # | Étape | Preuve |
|---|---|---|
| 1 | Moteur pur : `journeesPourDate()` dans `src/lib/tournee/auto-rdv.js` (une date, journées à secteur + journée vide d'un technicien éligible, refus hors horizon / dimanche / figée) + libellés parlés (`jour`, `plage`) | tests `node --test` verts, `npm run sync:tournee-engine` + test de synchro |
| 2 | Extraction `charger` / `trajetPour` / `rdvDejaPris` → `_shared/autoRdvContexte.ts`, `auto-rdv` les importe | `deno check` des deux edges ; GET `/rdv/:token` d'un contrat test renvoie les mêmes créneaux avant/après |
| 3 | Migration : `auto_rdv_poser(..., p_date_max)` + table `agent_propositions` | répétition `scripts/migration-rehearsal/` (page client inchangée sans `p_date_max`, pose J+40 acceptée avec, refusée sans) ; droits `has_function_privilege` |
| 4 | Edge `agent-creneaux` (`proposer` / `reserver`), client lu dans `agent_verifications` | `deno check` ; appels curl avec secret : sans vérification → `client_non_verifie` |
| 5 | Déploiement (migration, `auto-rdv` redéployée, `agent-creneaux`), `config.toml` | requêtes de contrôle en prod, page client toujours OK |
| 6 | Outils ElevenLabs + prompt v9 | **soumis à Eric avant application** |
| 7 | Appels tests (client test ABRIOUX : RDV du 16/10 à déplacer/annuler d'abord, ou autre fiche test) | RDV visible au planning, carte « Planifié », source `auto_rdv:agent` |

Arrêt si : la page client change de comportement (étape 2), une règle du moteur doit être
modifiée pour la page client, ou un arbitrage métier apparaît (choix du technicien, plages).
