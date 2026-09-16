# Mouchard — journal d'audit des écritures (leads, RDV)

**Date** : 2026-09-16 · **Statut** : livré (migration `20260916_3` appliquée en prod, front branché)
**Demande (Eric)** : « je veux que chaque action soit sourçable » — une fiche lead semblait avoir été
modifiée (date de RDV) sans qu'on sache qui, quand, ni quoi.

## Constat

L'Historique d'un lead était **déclaratif** : le front écrivait une activité (`lead_activities`) quand
il y pensait — changement de statut, réassignation, note — avec un `user_id` qu'il **déclarait
lui-même** dans le payload de `create_majordhome_lead_activity`. Tout le reste était invisible :
« Enregistrer » dans la modale (date du RDV, montant, probabilité, notes…), drag dans le planning,
crons Pennylane, N8N, site vitrine.

Cas PERRON VALERIE (2026-09-16) : lead créé 14:52:59, RDV créé 14:53:18, deux activités
« Statut : RDV planifié → RDV planifié » à 14:53:19 (double appel à 43 ms, rien n'a changé), puis à
**15:05:30** le lead ET son RDV modifiés (`updated_at`) — aucune trace de quoi ni par qui.

## Décision : tracer au niveau base, pas au niveau front

Un trigger `AFTER INSERT OR UPDATE OR DELETE` générique (`majordhome.audit_row_change()`) sur
`majordhome.leads` et `majordhome.appointments` écrit dans `majordhome.audit_log` :

| Colonne | Contenu |
|---|---|
| `changed_by` | `auth.uid()` lu **côté serveur** — infalsifiable par le front ; NULL = automatisation |
| `changed_by_role` | claim JWT (`authenticated` / `service_role`) ou `session_user` (pg_cron, SQL direct) |
| `source` | RPC ou vue racine de la requête, extraite de `current_query()` (`update_majordhome_lead` = fiche lead, `majordhome_appointments` = planning, `pennylane_*` = synchro, `create_lead_from_webhook` = N8N…) |
| `changed_fields` / `old_values` / `new_values` | **seulement** les champs modifiés (INSERT : ligne entière sans NULL ; DELETE : ligne entière) |
| `org_id` | org **CORE**, normalisée (`appointments.org_id` porte l'org majordhome → `majordhome.organizations.core_org_id`) |
| `lead_id` | rattache les écritures d'un RDV à sa fiche lead |

Invariants :
- **Append-only** : le trigger (SECURITY DEFINER) est le seul écrivain ; aucun GRANT
  INSERT/UPDATE/DELETE à personne (vérifié via `has_table_privilege`, pas via le texte —
  les privilèges par défaut du schéma donnaient ALL à `authenticated`).
- **Pas de FK vers l'entité** : la piste survit à un hard delete.
- **UPDATE sans champ utile → aucune ligne** (colonnes bruit ignorées par argument du trigger :
  `updated_at`, `status_changed_at`, géocodage, `google_*`, `slack_*`, rappels SMS…).
- **Fail-safe** : une erreur du trigger part en `WARNING`, elle ne bloque jamais l'écriture métier.
  Contrepartie : vérifier régulièrement que des lignes sont produites (une écriture depuis l'app
  → une ligne).
- **Lecture = membres de l'org** (RLS SELECT), comme l'Historique de la fiche aujourd'hui :
  la transparence dissuade mieux qu'un journal secret. Vue `public.majordhome_audit_log`
  (`security_invoker`, `changed_by_name` via `profiles`).

## Front

- `src/lib/auditTrail.js` (pur, testé `scripts/audit-trail.test.mjs`) : libellés FR des colonnes,
  formats (dates, heures, montants), ids → noms via `resolvers`, `buildAuditEntry`, `mergeTimeline`.
- `audit.service.js` (`getForLead`, `getForRecord`), hooks `useLeadAuditTrail` / `useAppointmentAuditTrail`
  (`leadKeys.audit`, `appointmentKeys.audit`, `staleTime: 0`), `useAuditResolvers` (une seule
  composition statuts / sources / commerciaux / types / enums RDV).
- **Fiche lead** : l'Historique fusionne activités déclaratives et audit (`LeadActivityTimeline`,
  entrées `kind: 'audit'` rendues par `AuditEntry`, badge « RDV » pour les écritures du planning).
- **Modale RDV** : nouvelle section Historique (`AppointmentHistorySection`, édition seule).
- Nettoyage : `updateLeadStatus` n'écrit plus « Statut : X → X » quand le statut ne change pas.

## Hors périmètre (à décider plus tard)

- Journal global org_admin (qui / quand / quoi sur toute l'org, filtrable).
- Autres tables : `clients`, `contracts`, `interventions` (= 1 `CREATE TRIGGER` chacune) ;
  `appointment_technicians` (pas de colonne `id` → adapter la fonction).
- Pas de rétroactif : la piste démarre au déploiement (2026-09-16 15:45 UTC+2).
- Le `user_id` déclaratif de `lead_activities` reste tel quel ; pour prouver un auteur, c'est le
  mouchard qui fait foi.
