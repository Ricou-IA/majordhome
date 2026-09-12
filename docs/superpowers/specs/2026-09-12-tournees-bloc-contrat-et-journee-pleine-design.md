# Tournées — bloc contrat et journée pleine (tranche 3)

**Date** : 2026-09-12 · **Décideur** : Eric · **Suite de** : `2026-09-12-tournees-fenetres-et-consolidation-design.md` (tranche 2, livrée).

## Ce qu'Eric a tranché (lecture patron de la journée du 15/09)

Deux entretiens posés à la main (EKOUE 8h-12h, GOMES 12h30-17h, Antoine) : rien n'avait
calculé ni le temps ni la route. Le barème donne 3h + 4h ; la route réelle (Mapbox)
38 + 39 + 23 min ; le budget d'Antoine 8h. Verdict d'Eric : **la journée est valable**.

1. **Les durées du barème sont celles d'interventions isolées.** Chez un client à
   plusieurs équipements, on gagne ~10 % (`gain_multi_equipements_pct`, livré `31d665e`).
2. **La journée peut déborder de 30 min** (`depassement_journee_minutes`, livré `31d665e`).
   Le « fini-parti » n'a rien à coder : le budget est un plafond, pas une cible.
3. **« Budget »** = `team_members.daily_work_minutes` (Settings → Équipe, « Budget
   journalier (tournées) », 8h par défaut) : le temps d'homme de la journée, **trajets
   compris**, ce que le moteur refuse de dépasser (au-delà du dépassement toléré).
4. **Le temps de travail du moteur est le barème × gain, le bloc n'est qu'un dessin.**
   Si le barème est faux, on corrige le barème (Tarification → durées), pas le bloc.
5. **Pose à la main = bloc contrat.** On sait calculer le temps contrat : à la pose, la
   plage est figée comme un bloc de cette durée (on choisit l'heure de début, la fin suit),
   au lieu d'une plage dessinée « à peu près ».
6. **La journée se fige toute seule dès qu'elle est pleine** — pas « la veille » (« si
   c'est plein depuis 10 jours, pourquoi attendre ? »). Figer à la main reste possible.

## Règles

### R1 — Temps du moteur
Pour un RDV d'**Entretien** (`appointment_type = 'maintenance'`) rattaché à un contrat
(`intervention_id → interventions.contract_id`), le temps de travail que voit le moteur
est `dureeContrat(équipements du contrat) × (1 − gain)`. À défaut (pas de contrat, pas
d'équipement), `duration_minutes` du RDV. Les SAV gardent leur durée saisie (pas de barème).
Le bloc du planning suit : à la pose à la main il prend cette durée ; au figeage
(`scheduled_end`, `duration_minutes`) il est redimensionné.

### R2 — Journée pleine par code
`reste utile = budget + dépassement − (travail barème + trajets réels + pause)`.
Une journée est **pleine** quand `reste utile < reste_utile_min_minutes` (75) et qu'elle
porte au moins un RDV adaptable. Elle se fige alors automatiquement : ordonnancement
dans les tolérances (`sequencerTournee`, figés = faits), heures définitives, `🔒`,
SMS `heure_de_passage` à chaque client adaptable (mobile FR). Une journée non pleine reste
adaptable jusqu'au bout — le rappel J-1 (réglage SMS, s'il est activé) annonce l'heure
telle qu'elle est.

### R3 — Pleine mais impossible
Une journée pleine que l'ordonnanceur ne sait pas tenir (route, budget, amplitude) ne se
fige pas : elle remonte en **« journée à arbitrer »** dans l'onglet Tournées avec le
diagnostic chiffré (travail / trajets / budget / trajets qui ne tiennent pas). C'est le
seul moment où l'humain intervient.

### R4 — Sans gabarit, pas de figeage automatique
Figer sans prévenir personne serait pire que ne pas figer : si le gabarit
`heure_de_passage` (Settings → Organisation → SMS) est absent ou si les SMS de l'org sont
désactivés, le cron ne fige rien et le dit dans son rapport. Le bouton manuel, lui, fige
et signale « SMS non envoyés ».

## Implémentation

| Pièce | Quoi |
|---|---|
| `src/lib/tournee/loaders.js` | `chargerJournees({…, reglages})` enrichit chaque RDV `maintenance` d'un `duree_bareme_minutes` (intervention → contrat → équipements → types) ; `chargeMinutes` = durées effectives. |
| `src/lib/tournee/arrets.js` | `dureeEffective(rdv)` = `duree_bareme_minutes ?? duration_minutes ?? 60`, utilisée par `construireArretsExistants` et `toleranceDe`. |
| `src/lib/tournee/plein.js` (pur) | `evaluerRemplissage({ arrets, trajet, depotKey, budgetMinutes, depassementMinutes, pauseMinutes, resteUtileMinMinutes })` → `{ pleine, resteUtileMinutes, … }` sur le diagnostic chronologique. |
| Consolidation (`useConsolidationJournee`) | durée de ligne = celle de l'arrêt ; écrit `scheduled_end` **et** `duration_minutes`. |
| Pose à la main | `DayResourceGrid` / `SchedulingAssistant` : prop `fixedDuration` (un clic pose le bloc, pas d'étirement). `SchedulingTransitionModal` charge la durée du contrat (`chargerContrat` + réglages) ; `EventModal` idem pour un Entretien sur un client à contrat. |
| Edge `tournees-figer` | `verify_jwt:false` + `MDH_CRON_SECRET`, cron horaire 5-19 UTC. Par org : journées de l'horizon à ≥ 1 adaptable → matrice Mapbox → pleine ? → ordonnancer → RPC `tournees_figer_journee` (service_role only, garde « rien n'a bougé ») → SMS. Body `{ dry_run, org_id, date }`. |
| Migration `20260912_5` | RPC `public.tournees_figer_journee(p_org_id, p_lignes jsonb)` SECURITY DEFINER, `REVOKE FROM PUBLIC, anon, authenticated` ; `cron.schedule('tournees-figer', '15 5-19 * * *')`. |
| Onglet Tournées | `AlertesTournees` : « journée pleine, à arbitrer » (diagnostic, trajets estimés) ; bouton « Figer » inchangé. |
| Settings → Organisation → Tournées | Nouvel onglet : souplesse par défaut, reste utile minimum, trajet max entre clients, gain multi-équipements, dépassement toléré, figeage automatique (on/off). Règle « pas de config sans UI ». |

## Hors périmètre
- Le rappel J-1 « vers 8h » pour un RDV encore adaptable (le gabarit dit ce qu'il dit).
- Le figeage la veille (refusé).
- Le serveur MCP (tranche suivante) — les outils restent machine-usables : tout passe par le moteur pur et des RPC.
