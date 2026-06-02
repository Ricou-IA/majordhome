# Permissions — Phase 3 : Enforcement RLS écritures — Record

> **Statut** : PARTIEL livré (equipments + interventions) le 2026-06-02. Reste : clients/leads/contracts (à faire avec Eric présent).
> Phase qui **change le comportement prod** (écritures gouvernées par `role_can`).
> Migrations appliquées via MCP (comme Couche 1 / PR2) — pas de fichier repo.

## Livré (migration `equipment_intervention_write_role_can`)

Helper ajouté : `majordhome.project_org_id(uuid)` (SECDEF, search_path lock, REVOKE anon) — résout l'org d'un projet en bypassant la RLS `core.projects`.

**equipments** + **interventions** : les anciennes policies `FOR ALL` core.projects-based (`equipments_owner_or_org`, `interventions_tech_owner_org`) sont **remplacées** par des policies d'écriture pilotées par `role_can`, gouvernées par la resource **`clients`** (modèle « fiche client ») :
- `INSERT` / `UPDATE` → `role_can(project_org_id(project_id), 'clients', 'edit')` = **tous les rôles** (règle « modif fiche incl. équipement/intervention ok for all »)
- `DELETE` → `role_can(project_org_id(project_id), 'clients', 'delete')` = **org_admin only**
- `SELECT` inchangé (policies org-wide `*_select_org_member` de la Couche 1 + portal).

**Sûreté** : additif côté capacité (l'ancien chemin d'écriture était cassé pour les membres via la RLS `core.projects`) → aucune régression pour les workflows existants ; admins inchangés (bypass) ; SELECT couvert par la Couche 1 (drop du `FOR ALL` sans perte de lecture).

## Vérification (impersonation, BEGIN/ROLLBACK)
| Test | Attendu | Observé |
|---|---|---|
| Ludovic (technicien) UPDATE équipement | autorisé | ✅ 1 |
| Ludovic UPDATE intervention | autorisé | ✅ 1 |
| Ludovic DELETE équipement | bloqué | ✅ 0 |
| Membre autre org UPDATE équipement Mayer | bloqué | ✅ 0 |
| Eric (admin) DELETE équipement | autorisé (RLS) | ✅ (passe RLS, stoppé par FK certificats — couche données) |
| Ludovic lecture équip/interv | intacte | ✅ 1 / 519 |

## Reste à faire (avec Eric présent — remplacement de policies FONCTIONNELLES)
1. **clients / contracts** : remplacer `org_leaders_insert/update_clients`, `org_admin_delete_clients`, `contracts_*_org_member` par des policies `role_can(org_id, 'clients', …)`. Note : `role_can` ⊇ ancien (create ajoute commercial ; edit ajoute commercial+technicien ; delete=admin inchangé) → **superset, donc dropper l'ancien ne retire aucun accès** (vérifié : diff false→true vide pour Mayer). Technique sûre : ADD role_can (OR avec ancien) → vérifier → DROP ancien.
2. **leads** (pipeline) : remplacer les policies d'écriture par `role_can(org_id, 'pipeline', …)`. Vérifier d'abord que `role_can` ⊇ ancien (sinon un rôle perdrait l'accès).
3. **Affinement `interventions`** (optionnel) : si on veut distinguer la gouvernance entretiens vs chantiers (décision spec §9 « interventions = entretiens + chantiers »), passer l'écriture en union `role_can(clients,…) OR role_can(entretiens,…) OR role_can(chantiers,…)`. Aujourd'hui gouverné par `clients` seul (suffit pour « edit fiche = all » + « delete = admin »).
4. **Quotes / tasks / appointments / autres tables org_id** : étendre au besoin (chacune sa resource).

## Pourquoi le reste est différé
clients/leads/contracts ont des policies d'écriture **fonctionnelles** aujourd'hui ; les remplacer sur la prod partagée pendant qu'Eric travaille en direct = risque de casser sa session. À faire quand il est présent pour valider (impersonation avant/après + vérif visuelle).
