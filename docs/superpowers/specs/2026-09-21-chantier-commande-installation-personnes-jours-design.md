# Chantier : « personnes × jours » comme donnée de la commande d'installation

**Date** : 2026-09-21 · **Statut** : spec à valider par Eric · **Périmètre** : installation uniquement (entretiens et SAV hors itération).

## 1. Problème

Quand Philippe planifie une installation, il décide « 2 personnes pendant 3 jours ». Aujourd'hui ces deux nombres n'existent nulle part comme donnée :

- **Jours** : le badge « J i/N » de `ChantierInterventionSection` compte les RDV `installation` liés au chantier. Pas de cible, donc pas de « il manque un jour ».
- **Personnes** : l'assistant (`SchedulingAssistant`, mode `multi`) pose un créneau par clic dans la colonne d'une personne. Le geste naturel pour deux techniciens, un clic par colonne, crée **deux RDV** pour la même journée. Le modèle N:N (`appointment_technicians`) existe et le calendrier sait éclater un RDV à N techniciens en N blocs, mais rien ne le suggère.

Mesuré en prod le 2026-09-21 : 12 paires d'installations à venir (24 RDV, 13 lignes de sync Google Calendar, 2 avec notes), 27 paires sur l'historique, 0 RDV multi-techniciens à venir. Conséquence terrain : deux fiches, deux jeux de notes, deux historiques pour une journée de chantier ; le téléphone présent sur l'une et pas sur l'autre.

Rappel : le modèle « intervention parent + créneaux » a été abandonné au Stage 4 du Bloc B (2026-06-04, validé le 05/06) au profit de RDV `installation` natifs. Cette spec ne le réintroduit pas : elle ajoute la **commande** au chantier et fait dériver les RDV de cette commande.

## 2. Décisions

1. **La commande est une donnée du chantier**, saisie dans la modale de prise de RDV (section Installation de `ChantierModal`), persistée, éditable.
2. **Un jour = un RDV, N techniciens.** Dans l'assistant, un second clic sur la même journée ajoute la personne au créneau du jour au lieu d'en créer un second. Une installation est une journée entière (`fixedDuration`), la fusion se fait **par date**, sans test de chevauchement.
3. **On prévient, on ne bloque pas** (« on décide sur l'instant », Eric 2026-09-17) : commande incomplète → avertissement explicite au moment de planifier, pas d'interdiction.
4. **Rattrapage des 12 paires** existantes par les gestes de l'app (le service `deleteAppointment` porte la suppression Google Calendar), pas par SQL.

## 3. Modèle de données

Migration versionnée `supabase/migrations/20260922_1_leads_install_order.sql`, répétée sur `scripts/migration-rehearsal/` :

```sql
ALTER TABLE majordhome.leads
  ADD COLUMN install_team_size smallint CHECK (install_team_size BETWEEN 1 AND 20),
  ADD COLUMN install_days      smallint CHECK (install_days BETWEEN 1 AND 60);
```

- `NULL` = commande non renseignée (comportement actuel : le badge compte les RDV).
- Exposition dans `public.majordhome_chantiers` : les deux colonnes **en fin de liste** (`CREATE OR REPLACE VIEW` n'accepte l'ajout qu'en fin, cf. gotcha `appointments.grand_secteur`). `security_invoker=true` conservé.
- Écriture front via la RPC générique existante `update_majordhome_lead(p_lead_id, p_updates)` (membership vérifiée côté RPC), aucune nouvelle RPC. Le mouchard `audit_log` trace la modification (colonnes non listées dans le bruit).
- Pas de colonne sur `appointments` : le lien jour ↔ chantier reste `lead_id`.

## 4. Module pur `src/lib/installOrder.js` (testé `scripts/install-order.test.mjs`, ajouté à `audit:quality`)

Aucun import React/Supabase. Deux fonctions :

- `fusionnerCreneau(draftSlots, slot)` → nouveau tableau : si un brouillon porte la même `date`, retourne le tableau avec `technicianIds` = union (ordre conservé) ; sinon ajoute `slot`. Utilisé par `handlePlaceSlot` de `SchedulingAssistant` **quand `mergeByDay` est actif** (prop, `true` depuis `ChantierModal` ; `false` ailleurs pour ne rien changer aux VT, entretiens, SAV).
- `etatCommande({ teamSize, days }, jours)` où `jours` = `[{ date, technicianIds }]` (brouillons ou RDV posés) → `{ joursAttendus, joursPoses, joursIncomplets: [{ date, personnes, attendues }], complete: boolean, message: string|null }`. `teamSize`/`days` NULL → `joursAttendus = joursPoses`, jamais d'incomplet (rétro-compat). `message` = phrase FR prête à afficher (« Il manque 1 jour et 1 personne le 23/09 »).

## 5. UI

### ChantierModal — section Installation
- En tête de section, deux champs numériques inline : **Personnes** et **Jours** (défaut affiché 1 × 1 tant que NULL, mais rien n'est écrit tant que l'utilisateur ne touche pas). Sauvegarde au blur via `chantiersService.updateInstallOrder(leadId, { teamSize, days })` → `update_majordhome_lead`, toast d'erreur, invalidation `chantierKeys`.
- Résumé « 2 pers. × 3 j — 2/3 jours posés » dérivé d'`etatCommande` sur les RDV `installation` actifs.
- `SchedulingAssistant` reçoit `mergeByDay`, `expectedTeamSize`, `expectedDays`, et `defaultDuration` inchangé (480).

### SchedulingAssistant
- `handlePlaceSlot` passe par `fusionnerCreneau` si `mergeByDay`.
- `SlotDraftList` : sous chaque créneau, « 1/2 personnes » en ambre si en dessous de `expectedTeamSize` ; pied de liste « 2/3 jours ». Le sélecteur de techniciens par créneau, déjà présent, reste le moyen d'ajouter ou retirer quelqu'un.
- Bouton Planifier : actif ; si `etatCommande(...).complete === false`, le `message` s'affiche au-dessus en ambre. Pas de confirmation supplémentaire.

### ChantierInterventionSection
- Badge « J i/N » : `N = install_days ?? nombre de RDV`. Ligne ambre « Il manque 1 jour » si commande incomplète. Une journée à 1/2 personnes s'affiche « 1/2 pers. » à côté des noms.

### EventModal (édition d'un jour)
- Inchangé : `TechnicianSelect` est déjà multi. Ajouter une personne après coup sur un jour posé se fait là.

## 6. Rattrapage des 12 paires existantes

Liste fournie par requête (lead, date, RDV A créé en premier, RDV B). Pour chaque paire, dans l'app : ouvrir A → ajouter le technicien de B → Enregistrer (la sync Google crée l'événement du 2ᵉ technicien) ; ouvrir B → **Supprimer** (org_admin, `deleteAppointment` supprime l'événement Google). Les 2 RDV avec notes : recopier les notes sur A avant de supprimer B. Vérification : la requête « paires à venir » doit renvoyer 0, et `SELECT count(*) FROM (…appointment_technicians GROUP BY appointment_id HAVING count(*) >= 2)` sur les RDV à venir doit renvoyer 12.

Un script SQL n'est pas retenu : 13 lignes `google_calendar_sync` portent des événements réels dans les agendas des techniciens, seule la voie service les nettoie.

## 7. Hors périmètre

- Entretiens et SAV (une visite = une personne aujourd'hui ; à revoir si le besoin apparaît).
- Fusion automatique quand la journée porte déjà un RDV **persisté** du chantier et qu'on clique une autre colonne dans l'assistant : la grille montre le RDV existant comme occupé ; l'ajout se fait dans `EventModal`.
- Suggestion automatique des techniciens compétents (`team_member_skills`, rôle `pose`) : les compétences `pose` sont stockées mais non consommées, ça reste vrai.
- Historique : 15 paires passées laissées telles quelles (RDV réalisés).

## 8. Vérification

- `node --test scripts/install-order.test.mjs` : fusion par date (union, ordre, date différente), `etatCommande` (NULL, complet, jour manquant, personne manquante, message).
- `npm run audit:quality`, `npx vite build`.
- Manuel (Eric) : planifier une installation 2 × 2 depuis un chantier en cliquant 4 fois (2 colonnes × 2 jours) → 2 RDV en base, chacun avec 2 techniciens, 4 blocs au calendrier, une seule carte contact par jour, badge « J 2/2 ».
