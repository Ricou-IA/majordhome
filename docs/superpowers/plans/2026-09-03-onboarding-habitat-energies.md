# Onboarding Habitat & Énergies — chemin d'onboarding réutilisable

> Plan d'implémentation — 2026-09-03. **Statut : en attente de validation par Eric.**
> Décisions actées : org cible = **H&E**, périmètre complet (socle + leads entrants + mailing + Pennylane),
> approche = **chemin réutilisable** (RPC de provisioning + écran), pas un one-shot.

**Goal :** rendre Majord'home utilisable par Habitat & Énergies sur le périmètre complet — et faire
que la 3ᵉ entreprise soit un formulaire de dix minutes, pas un chantier de trois mois.

**Architecture :** le provisioning d'une organisation devient **une RPC idempotente + une fonction
d'état vérifiable**, jamais une check-list dans une tête. `org_provisioning_status(p_org_id)` répond
« ce qui manque », `org_provision(p_org_id)` pose ce qui est posable automatiquement, et un écran
super-admin affiche l'un et déclenche l'autre. Le critère de succès de chaque lot se lit dans cette
fonction, pas dans une relecture.

**Spec amont réutilisée :** `docs/superpowers/specs/2026-08-12-sources-statuts-multi-org-design.md`
(lot 3, écrite et jamais implémentée — vérifié en base : les colonnes n'existent pas).

---

## 1. Constat de départ — mesuré en base le 2026-09-03

Instance `ejqqqwudmizqisdkxohw`, trois organisations, deux onboardings commencés jamais terminés.

| Org | core `id` | Créée | Membres | Leads | Clients | `settings` | Tarifs | Droits | Ligne `majordhome.organizations` |
|---|---|---|---:|---:|---:|---|---:|---:|---|
| Mayer Energie | `3c68193e…` | 06/01 | 7 | 458 | 3601 | 40 clés | 36 | 138 | ✅ `7825fe43…` |
| Cimaj | `62cd2073…` | 21/05 | 1 | 4 | 1 | **vide** | 0 | 130 | ✅ `12b73348…` |
| **H&E** | `65aea930…` | 25/07 | 1 | 1 | 1 | **vide** | 0 | **0** | ❌ **absente** |

H&E : `org_admin` = Philippe Rerat (`philippe.rerat@habitat-energies.com`), domaine
`habitat-energies.com`.

### 1.1 Les six blocages, par ordre de gravité

| # | Blocage | Constat vérifiable | Lot |
|---|---|---|---|
| **B1** | `create_organization` ouverte à `anon` avec garde fail-open | `has_function_privilege('anon', 'public.create_organization(...)', 'EXECUTE')` = `true`, et le corps teste `IF v_caller_role != 'super_admin'` → `NULL` pour un appelant sans profil → le bloc de refus est **sauté** | 0 |
| **B2** | `pennylane-quotes-sweep` passe **un seul token global** à toutes les orgs | La boucle filtre les orgs sur `settings.pennylane.enabled === true` puis appelle `sweepOrg(supabase, org.id, apiToken)` avec le même `PENNYLANE_API_TOKEN` d'environnement | 0 (garde) → 5 (fix) |
| **B3** | Fallbacks Mayer résiduels dans `mailing-send` | `loadOrgBranding()` retombe sur `contact@mayer-energie.fr` et `https://www.mayer-energie.fr` quand `settings.from_email` est absent | 0 |
| **B4** | Double identité d'org, non posée pour H&E | `appointments` (522) et `team_members` (7) portent l'id **majordhome** ; clients/leads/contrats l'id **core**. H&E n'a pas de ligne `majordhome.organizations` → `getMajordhomeOrgId()` throw | 1-2 |
| **B5** | Aucun chemin d'onboarding | Aucun appel à `create_organization` dans `src/`, aucun script de provisioning. C'est la cause directe des `settings` vides de Cimaj et H&E | 1 |
| **B6** | `sources` sans `org_id`, `statuses` sans `key` | `information_schema.columns` : `sources(id, name, description, is_active, color, created_at, updated_at)`, `statuses(id, label, description, display_order, color, is_final, is_won, created_at)` | 3 |

### 1.2 Ce que B2 produit concrètement

Le jour où l'on pose `settings.pennylane.enabled = true` sur H&E — le geste normal d'activation —
le sweep suivant (cron 5 min) lit les devis du compte Pennylane **de Mayer** et les écrit avec
`org_id = H&E`. Noms de clients, montants, numéros de devis de Mayer apparaissent dans le pipeline
de H&E, et la RLS ne voit rien à redire puisque les lignes portent le bon `org_id`.

**Conséquence immédiate, avant tout code : ne pas activer Pennylane pour H&E.** C'est le lot 5 qui
lève cette interdiction, pas un réglage.

---

## 2. Contraintes globales

Reprises de `CLAUDE.md`, elles s'appliquent à chaque tâche de ce plan :

- **Base de production partagée.** Chaque migration est additive et vérifiable seule ; aucune étape
  ne supprime de donnée. Remplacement de garde = ADD en OR → vérifier → DROP l'ancienne.
- **RPC `SECURITY DEFINER`** : `REVOKE EXECUTE FROM PUBLIC, anon` immédiat — `PUBLIC` n'est pas
  optionnel. Si le payload porte un `org_id` non dérivé d'`auth.uid()` → `service_role` seul.
- **Gardes en autorisation positive** : `IF (autorisé) IS NOT TRUE THEN refuser`, jamais
  `IF NOT (…)`. `auth.uid()` NULL traité en première instruction.
- **Effet des droits audité par `has_function_privilege` / `has_table_privilege`**, jamais en
  relisant le texte de la migration.
- **Fallback neutre, jamais Mayer** : une org sans settings affiche « Votre entreprise », champs
  vides, slate `#64748b`. Un fallback qui nomme Mayer est un bug, pas une commodité.
- **Échouer fort** : un envoi qui ne sait pas sous quelle identité partir ne part pas.
- `npm run lint` à 0 nouveau warning ; `npx vite build` passe.

---

## 3. Lot 0 — Fermer les deux failles (bloquant, petit)

Rien d'autre ne commence avant. Ces deux corrections sont indépendantes de H&E : elles protègent
l'instance telle qu'elle tourne aujourd'hui.

- [ ] **0.1** Migration `20260903_1_create_organization_hardening.sql`
  - `REVOKE EXECUTE ON public.create_organization(...) FROM PUBLIC, anon, authenticated`
  - idem `core.create_organization(...)`
  - Réécrire la garde de `core.create_organization` en autorisation positive :
    `IF auth.uid() IS NULL THEN RAISE` puis
    `IF (SELECT app_role = 'super_admin' FROM core.profiles WHERE id = auth.uid()) IS NOT TRUE THEN RAISE`
  - **Ne plus renvoyer `{success:false}` sur un refus** : lever une exception nommée. Un refus qui
    ressemble à un succès partiel est ce qui rend les fail-open invisibles.
  - Vérification : `has_function_privilege('anon', …, 'EXECUTE')` = `false` sur les deux.
- [ ] **0.2** `supabase/functions/mailing-send/index.ts` — `loadOrgBranding()`
  - Supprimer `contact@mayer-energie.fr` et `https://www.mayer-energie.fr`.
  - `from_email` absent → **refus explicite** (`400`, message nommé), pas de repli. Un e-mail parti
    sous l'identité d'une autre entreprise ne se rattrape pas.
  - `brandName` / `fromName` retombent sur le neutre de `orgBranding.js`, pas sur « Majord'home ».
  - Vérification : appel `mailing-send` sur une org sans `from_email` → 400, aucun envoi Resend.
- [ ] **0.3** Note dans `CLAUDE.md` (§ multi-tenant) : « `PENNYLANE_API_TOKEN` est global — activer
  `settings.pennylane.enabled` sur une 2ᵉ org injecte les devis de la 1ʳᵉ. Interdit jusqu'au lot 5. »

**Critère de succès du lot 0** — trois commandes, pas une relecture :
```sql
select has_function_privilege('anon', p.oid, 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'create_organization';         -- attendu : false, false
select count(*) from core.organizations
where coalesce(settings->'pennylane'->>'enabled','false')='true';  -- attendu : 1 (Mayer seule)
```

---

## 4. Lot 1 — Le chemin de provisioning réutilisable

Le cœur du chantier. Ce que Cimaj et H&E n'ont jamais eu.

- [ ] **1.1** `public.org_provisioning_status(p_org_id uuid) RETURNS jsonb` — SECURITY DEFINER,
  `service_role` + `super_admin`. **Lecture seule.** Retourne, poste par poste, `ok` / `manquant` :
  ligne `majordhome.organizations`, `settings` obligatoires (`brand_name`, `legal_name`, `siret`,
  `address`, `postal_code`, `city`, `phone`, `from_email`, `territoire_centers`,
  `geogrid_target_department`), `role_permissions`, grille tarifaire (zones / types / tarifs),
  `team_members` ≥ 1, sources propres à l'org (lot 3), domaine Resend vérifié (lot 4).
  C'est le **contrat de vérification** de tout le plan : chaque lot suivant se prouve en le rappelant.
- [ ] **1.2** `public.org_provision(p_core_org_id uuid) RETURNS jsonb` — SECURITY DEFINER,
  `service_role` seul (payload = `org_id` non dérivé d'`auth.uid()`), **idempotente**. Pose :
  - la ligne `majordhome.organizations` (`core_org_id` renseigné) si absente — **c'est B4** ;
  - `org_seed_permissions(p_core_org_id)` ;
  - `org_seed_sources(p_core_org_id)` (lot 3 ; no-op tant que le lot 3 n'est pas livré) ;
  - une grille tarifaire **vide mais structurée** (1 zone « Zone 1 », aucun tarif) — pas de copie
    des tarifs de Mayer : ce sont ses prix.
  - Retourne le `org_provisioning_status` d'après exécution.
- [ ] **1.3** `org_seed_permissions` : remplacer le template Mayer par les **défauts app-level** de
  `src/lib/permissionsRegistry.js` (dette signalée dans `CLAUDE.md` § droits app-level). Copier les
  droits d'une entreprise cliente vers une autre est un accident qui attend son tour.
- [ ] **1.4** Écran `/admin/organizations` — visible aux seuls `app_role = 'super_admin'`
  (`RouteGuard` + garde in-component). Liste des orgs, état de provisioning par poste (vert/rouge
  depuis 1.1), bouton « Provisionner » (appelle 1.2 via une edge function `verify_jwt:true` qui
  revalide le `super_admin` — la RPC reste `service_role` seul).
- [ ] **1.5** Service + hook + cache keys (`orgAdminKeys`, convention `all: (orgId) => […]`).
- [ ] **1.6** Tests : `scripts/org-provisioning.test.mjs` sur la partie pure (lecture du statut →
  liste des manques). La partie SQL se vérifie par les requêtes du critère de succès.

**Critère de succès du lot 1 :** `org_provision` exécutée deux fois de suite sur une org de test
donne le même état final et ne crée aucun doublon ; `org_provisioning_status` sur Mayer ne signale
aucun manque sur le socle.

---

## 5. Lot 2 — Habitat & Énergies utilisable sur le socle

- [ ] **2.1** `org_provision('65aea930-…')` → pose la ligne `majordhome.organizations` manquante.
- [ ] **2.2** Renseigner les `settings` via `/settings/organization` (les 3 onglets), avec Philippe
  Rerat ou depuis les informations qu'il fournit : identité légale, coordonnées, siège + département.
  **Aucune valeur en dur dans le code** — c'est la règle de la charte.
- [ ] **2.3** Grille tarifaire H&E via `/settings/pricing` (leurs zones, leurs prix).
- [ ] **2.4** Utilisateurs : créer les membres via `/settings/team` (edge `create-user`), vérifier
  que `team_member_ensure_for_user` a bien posé une ressource planning pour chacun — sans elle, un
  membre n'apparaît dans aucune assignation de RDV et sa couleur est inéditable.
- [ ] **2.5** Recette manuelle : créer un client, un lead, un contrat d'entretien, un RDV ; ouvrir le
  planning et la programmation. Vérifier qu'aucun libellé « Mayer » n'apparaît nulle part (PDF de
  contrat, e-mail de test, en-tête).

**Critère de succès du lot 2 :** `org_provisioning_status('65aea930-…')` ne signale plus aucun manque
sur le socle, et un RDV créé côté H&E apparaît dans son planning.

---

## 6. Lot 3 — Sources et statuts multi-org (prérequis « leads entrants »)

Implémentation de la spec du 2026-08-12, dont les 5 étapes de migration et les 9 critères de succès
sont déjà écrits. Aucune redécision ici : le plan est le document de spec.

- [ ] **3.1** Étapes 1-4 de la spec (`statuses.key`, `sources.org_id` + `key`, semis Cimaj/H&E,
  clé étrangère composite `leads_source_same_org`).
- [ ] **3.2** Étape 5 : bascule des consommateurs, dans l'ordre imposé — les trois
  `WHERE is_won = true LIMIT 1` **en premier**, puis les 5 fonctions Pennylane, `mail_segment_compile`,
  les 8 vues, puis le frontend.
- [ ] **3.3** `org_seed_sources` (jeu neutre de 8 sources, clés sur `site_web` et `meta_ads`
  seulement) branchée dans `org_provision` (1.2).
- [ ] **3.4** Écran `/settings/sources` + RPC `source_reassign_leads`.
- [ ] **3.5** Le point à trancher de la spec §6.3 (statut visé par `commande-pro`) — arbitrage Eric.

**Critère de succès du lot 3 :** les 9 critères de la spec, dont le n°8 (comptage par `column_key`
sur `majordhome_kanban_cards`, avant/après, sur les 3 orgs) qui est le filet anti-régression.

---

## 7. Lot 4 — Mailing Resend pour H&E

Le `RESEND_API_KEY` global est **acceptable** : un compte Resend opérateur peut porter plusieurs
domaines vérifiés, et `resend-domain-onboard` existe déjà. À confirmer avec Eric — si H&E doit
utiliser **son propre compte** Resend, ce lot devient un jumeau du lot 5.

- [ ] **4.1** Domaine `habitat-energies.com` vérifié via `resend-domain-onboard` (DNS côté H&E).
- [ ] **4.2** `from_email` / `reply_to` / `from_name` / templates SMS dans les settings H&E.
- [ ] **4.3** Envoi de test de bout en bout, webhook `resend-webhook` inclus (ouverture, clic).

---

## 8. Lot 5 — Pennylane multi-compte (lève l'interdiction du lot 0.3)

Le plus lourd, et le seul qui touche cinq edge functions. Un token Pennylane par organisation,
jamais un env global.

- [ ] **5.1** Stocker le token par org dans `vault.secrets` (motif déjà en place pour
  `MDH_CRON_SECRET` côté pg_cron), résolu par `org_id`. Jamais dans `core.organizations.settings` :
  un settings se lit via une vue `security_invoker` par tout membre de l'org.
- [ ] **5.2** Un résolveur partagé `_shared/pennylane.ts::getOrgToken(orgId)`, **qui lève** si l'org
  n'a pas de token — pas de repli sur l'env. Le repli silencieux est exactement B2.
- [ ] **5.3** Bascule des cinq consommateurs : `pennylane-proxy`, `pennylane-quotes-sweep`,
  `pennylane-sync-cron`, `pennylane-sync-quote-status`, `pennylane-backfill-quotes`.
- [ ] **5.4** Retrait de `PENNYLANE_API_TOKEN` de l'environnement, après bascule de Mayer sur le
  Vault.
- [ ] **5.5** Seulement alors : `settings.pennylane.enabled = true` sur H&E.

**Critère de succès du lot 5 :** un sweep exécuté avec deux orgs actives écrit dans chaque org
uniquement les devis de son propre compte — vérifié en comparant les `pennylane_quote_id` ramenés
par org, qui doivent être disjoints.

---

## 9. Ordre et dépendances

```
Lot 0 (failles) ──▶ Lot 1 (provisioning) ──▶ Lot 2 (H&E socle) ──▶ recette
                                    │
                                    ├──▶ Lot 3 (sources/statuts) ──▶ leads entrants
                                    ├──▶ Lot 4 (Resend)          ──▶ mailing
                                    └──▶ Lot 5 (Pennylane)       ──▶ devis
```

Les lots 3, 4 et 5 sont indépendants entre eux et peuvent être pris dans n'importe quel ordre une
fois le lot 2 livré. Le lot 0 ne dépend de rien et ne peut pas attendre.

## 10. Ce que ce plan ne fait pas

- **Ne touche pas à la forme du tunnel commercial** (décision actée dans la spec du 12/08).
- **Ne copie aucune donnée de Mayer** vers H&E : ni tarifs, ni sources partenaires, ni templates.
- **Ne migre pas les callers legacy de `useAuth().organization?.settings`** vers `useOrgSettings()`
  (dette signalée dans `CLAUDE.md`, passage dédié — Posture #3).
- **Ne traite pas Cimaj.** Le lot 1 la rendra provisionnable en un clic ; l'activer est une décision
  commerciale, pas technique.
