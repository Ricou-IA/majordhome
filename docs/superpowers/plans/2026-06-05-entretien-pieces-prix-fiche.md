# Entretien — Prix des pièces hors PDF, sur fiche/carte (TTC) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortir le prix des pièces du certificat PDF client, et faire remonter le **total TTC des pièces** sur la fiche (modale) et la carte Kanban de l'entretien.

**Architecture:** Le total est calculé **à la source** (champ dérivé `parts_total_ttc` dans la vue `majordhome_entretien_sav`, agrégat `jsonb` sur les certificats du parent **et** des enfants) → disponible partout via `select('*')` sans requête supplémentaire, sans dénormalisation. Trois retouches UI (PDF, modale, carte) + un relabel de la saisie. Aucun changement de service de lecture.

**Tech Stack:** React 18 + Vite 5, Supabase (Postgres, vues `security_invoker`), `@react-pdf/renderer`, Tailwind, TanStack Query. **Pas de test-runner JS** dans ce repo → vérification par `npx vite build` + `npm run lint:errors` + requêtes SQL (Supabase MCP). Validation visuelle finale par Eric sur son propre serveur de dev (ne PAS utiliser les preview tools).

**Spec:** `docs/superpowers/specs/2026-06-05-entretien-pieces-prix-fiche-facturation-design.md`

**Périmètre :** Phase 1 uniquement. La Phase 2 (facturation Pennylane) est hors de ce plan.

**Convention repo :** travail direct sur `main` (jamais de worktree — préférence Eric). Commit local par tâche via le hook pre-commit (lint:errors). **Ne pas `git push` sans accord explicite d'Eric.** La migration s'applique sur l'instance Supabase **partagée de prod** — `CREATE OR REPLACE VIEW` est sûr et réversible (rollback = re-replace sans la colonne).

---

## Fichiers touchés

| Fichier | Responsabilité | Action |
|---|---|---|
| Migration Supabase `entretien_parts_total_ttc` | Ajoute `parts_total_ttc` à la vue + GRANT certificats | apply_migration (MCP) |
| `src/apps/artisan/components/certificat/CertificatPDF.jsx` | PDF certificat client | Retrait colonne « Prix HT » |
| `src/apps/artisan/components/certificat/steps/StepPieces.jsx` | Saisie pièces étape 7 | Relabel « Prix HT (€) » → « Prix TTC (€) » |
| `src/apps/artisan/components/entretiens/EntretienSAVModal.jsx` | Fiche (modale) entretien | Ligne « Pièces de rechange : XX € » |
| `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` | Carte Kanban entretien | Montant pièces secondaire (ambre) |

---

## Task 1 : Migration — champ dérivé `parts_total_ttc` dans la vue

**Files:**
- Apply migration via Supabase MCP `apply_migration` (project_id `odspcxgafcqxjzrarsqf`, name `entretien_parts_total_ttc`)
- Verify via Supabase MCP `execute_sql`

- [ ] **Step 1 : Relever le compte de lignes AVANT (référence de non-régression)**

`execute_sql` (project_id `odspcxgafcqxjzrarsqf`) :
```sql
SELECT count(*) AS n FROM public.majordhome_entretien_sav;
```
Noter `n` (servira à confirmer qu'on n'a pas changé le périmètre des lignes).

- [ ] **Step 2 : Vérifier le calcul attendu AVANT migration (dry-run de l'agrégat)**

```sql
SELECT i.id,
  COALESCE((
    SELECT sum(
      COALESCE((piece ->> 'prix_ht')::numeric, 0)
      * COALESCE(NULLIF(piece ->> 'quantite', '')::numeric, 1)
    )
    FROM majordhome.certificats cert
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cert.pieces_remplacees, '[]'::jsonb)) AS elem(piece)
    WHERE cert.intervention_id = i.id
       OR cert.intervention_id IN (SELECT ch.id FROM majordhome.interventions ch WHERE ch.parent_id = i.id)
  ), 0) AS parts_total_ttc
FROM majordhome.interventions i
WHERE i.id = 'd6b6cc90-f1bd-4ef4-bf66-a4fbd56b212e';
```
Attendu : `parts_total_ttc = 100` (certificat parent « Bougie » 100 € + certificat enfant « Bougue » sans prix = 0).

- [ ] **Step 3 : Appliquer la migration**

`apply_migration` (project_id `odspcxgafcqxjzrarsqf`, name `entretien_parts_total_ttc`) :
```sql
-- Recrée la vue entretien/SAV en AJOUTANT parts_total_ttc en DERNIÈRE colonne.
-- CREATE OR REPLACE VIEW exige que les colonnes existantes restent identiques et
-- dans le même ordre ; on n'ajoute qu'à la fin. security_invoker préservé.
CREATE OR REPLACE VIEW public.majordhome_entretien_sav
WITH (security_invoker = true) AS
 SELECT i.id,
    i.project_id,
    i.equipment_id,
    i.intervention_type,
    i.scheduled_date,
    i.scheduled_time_start,
    i.scheduled_time_end,
    i.technician_id,
    i.technician_name,
    i.status,
    i.report_date,
    i.report_notes,
    i.work_performed,
    i.parts_replaced,
    i.photo_before_url,
    i.photo_after_url,
    i.photos_extra,
    i.signature_url,
    i.signed_at,
    i.signed_by_name,
    i.duration_minutes,
    i.is_billable,
    i.invoice_id,
    i.location_lat,
    i.location_lng,
    i.metadata,
    i.created_by,
    i.created_at,
    i.updated_at,
    i.tags,
    i.lead_id,
    i.parent_id,
    i.slot_date,
    i.slot_start_time,
    i.slot_end_time,
    i.slot_notes,
    i.client_id,
    i.contract_id,
    i.workflow_status,
    i.sav_description,
    i.parts_order_status,
    i.devis_amount,
    i.devis_status,
    i.sav_origin,
    i.includes_entretien,
    p.org_id,
    cl.display_name AS client_name,
    cl.first_name AS client_first_name,
    cl.last_name AS client_last_name,
    cl.address AS client_address,
    cl.postal_code AS client_postal_code,
    cl.city AS client_city,
    cl.phone AS client_phone,
    cl.phone_secondary AS client_phone_secondary,
    cl.email AS client_email,
    cl.sms_optin AS client_sms_optin,
    c.contract_number,
    c.amount AS contract_amount,
    c.estimated_time,
    c.maintenance_month,
    c.status AS contract_status,
    cl.project_id AS client_project_id,
    (EXISTS ( SELECT 1
           FROM majordhome.sms_logs sl
          WHERE sl.intervention_id = i.id AND sl.campaign_name = 'avis_j1'::text)) AS sms_avis_sent,
    rdv.next_rdv_date,
    COALESCE(rdv.has_active_rdv, false) AS has_active_rdv,
    COALESCE(( SELECT sum(
                  COALESCE((piece ->> 'prix_ht')::numeric, 0)
                  * COALESCE(NULLIF(piece ->> 'quantite', '')::numeric, 1)
                )
           FROM majordhome.certificats cert
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cert.pieces_remplacees, '[]'::jsonb)) AS elem(piece)
          WHERE cert.intervention_id = i.id
             OR cert.intervention_id IN ( SELECT ch.id
                   FROM majordhome.interventions ch
                  WHERE ch.parent_id = i.id)), 0::numeric) AS parts_total_ttc
   FROM majordhome.interventions i
     JOIN core.projects p ON p.id = i.project_id
     LEFT JOIN majordhome.clients cl ON cl.id = i.client_id
     LEFT JOIN majordhome.contracts c ON c.id = i.contract_id
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.intervention_id = i.id AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE (i.intervention_type = ANY (ARRAY['entretien'::majordhome.intervention_type, 'sav'::majordhome.intervention_type]))
    AND i.parent_id IS NULL
    AND (c.status IS NULL OR (c.status <> ALL (ARRAY['cancelled'::majordhome.contract_status, 'archived'::majordhome.contract_status])));

-- La vue lit désormais majordhome.certificats : GRANT pour les lectures service_role
-- (edge functions). Idempotent. (interventions/clients/contracts/appointments/sms_logs
-- déjà accordés car déjà lus par la vue.)
GRANT SELECT ON majordhome.certificats TO service_role;

-- Expose la nouvelle colonne via PostgREST (select('*')).
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4 : Vérifier APRÈS migration — non-régression + valeur**

`execute_sql` :
```sql
SELECT
  (SELECT count(*) FROM public.majordhome_entretien_sav) AS n_after,
  (SELECT parts_total_ttc FROM public.majordhome_entretien_sav
     WHERE id = 'd6b6cc90-f1bd-4ef4-bf66-a4fbd56b212e') AS sample_d6b6cc90;
```
Attendu : `n_after` = `n` du Step 1 (périmètre inchangé) ; `sample_d6b6cc90 = 100`.
Si la ligne `d6b6cc90` n'apparaît pas (filtre type/contrat), valider plutôt avec :
```sql
SELECT id, contract_amount, parts_total_ttc
FROM public.majordhome_entretien_sav
WHERE parts_total_ttc > 0
ORDER BY parts_total_ttc DESC
LIMIT 5;
```
Attendu : au moins quelques lignes avec un `parts_total_ttc` cohérent (> 0), et `parts_total_ttc = 0` partout ailleurs (pas d'erreur, pas de NULL).

- [ ] **Step 5 : Pas de commit de code ici** (la migration est versionnée côté Supabase via `apply_migration`). Passer à la Task 2.

---

## Task 2 : PDF certificat — retirer la colonne « Prix HT »

**Files:**
- Modify: `src/apps/artisan/components/certificat/CertificatPDF.jsx` (~lignes 279-292)

- [ ] **Step 1 : Remplacer le bloc en-tête + lignes du tableau pièces**

Remplacer exactement :
```jsx
            <View style={s.tableHeader}>
              <Text style={[s.tableHeaderCell, { flex: 3 }]}>Designation</Text>
              <Text style={[s.tableHeaderCell, { flex: 2 }]}>Reference</Text>
              <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Qte</Text>
              <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Prix HT</Text>
            </View>
            {pieces.map((p, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={[s.tableCell, { flex: 3 }]}>{p.designation}</Text>
                <Text style={[s.tableCell, { flex: 2 }]}>{p.reference || '-'}</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'center' }]}>{p.quantite}</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'right' }]}>{p.prix_ht ? `${p.prix_ht} EUR` : '-'}</Text>
              </View>
            ))}
```
par :
```jsx
            <View style={s.tableHeader}>
              <Text style={[s.tableHeaderCell, { flex: 4 }]}>Designation</Text>
              <Text style={[s.tableHeaderCell, { flex: 3 }]}>Reference</Text>
              <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Qte</Text>
            </View>
            {pieces.map((p, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={[s.tableCell, { flex: 4 }]}>{p.designation}</Text>
                <Text style={[s.tableCell, { flex: 3 }]}>{p.reference || '-'}</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'center' }]}>{p.quantite}</Text>
              </View>
            ))}
```
(Le prix `p.prix_ht` n'est plus rendu ; les colonnes Désignation/Référence s'élargissent. La liste des pièces reste pour la traçabilité.)

- [ ] **Step 2 : Build**

Run: `npx vite build`
Expected: build OK, aucune erreur. (Le PDF ne se teste pas unitairement ; le rendu visuel sera vérifié par Eric.)

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/certificat/CertificatPDF.jsx
git commit -m "feat(certificat): retire le prix des pièces du PDF client (traçabilité conservée)"
```

---

## Task 3 : Saisie étape 7 — relabel « Prix HT (€) » → « Prix TTC (€) »

**Files:**
- Modify: `src/apps/artisan/components/certificat/steps/StepPieces.jsx:81`

- [ ] **Step 1 : Changer le libellé du champ**

Remplacer exactement :
```jsx
            <FormField label="Prix HT (€)">
```
par :
```jsx
            <FormField label="Prix TTC (€)">
```
(La clé stockée reste `prix_ht` — voir `updatePiece(index, 'prix_ht', ...)` ligne ~86, **ne pas y toucher**. Seul le libellé visible change : le technicien saisit du TTC.)

- [ ] **Step 2 : Lint**

Run: `npm run lint:errors`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/certificat/steps/StepPieces.jsx
git commit -m "feat(certificat): saisie pièces libellée TTC (clé stockage inchangée)"
```

---

## Task 4 : Fiche (modale) — ligne « Pièces de rechange : XX € »

**Files:**
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVModal.jsx` (insertion après la ligne ~481)

Contexte : `Wrench` et `formatEuro` sont déjà importés (lignes 26 et 32). On insère le bloc juste **après** le bloc contrat (qui se termine par `)}` à la ligne 481) et **avant** le commentaire `{/* Équipements du contrat */}`.

- [ ] **Step 1 : Insérer la ligne pièces**

Repérer la fin du bloc contrat suivie du commentaire équipements :
```jsx
                {item.contract_number && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span>Contrat {item.contract_number}</span>
                    {item.contract_amount > 0 && (
                      <span className="ml-auto text-sm font-semibold text-emerald-700">
                        {formatEuro(item.contract_amount)}
                      </span>
                    )}
                  </div>
                )}

                {/* Équipements du contrat */}
```
Remplacer par (ajout du bloc « Pièces de rechange » entre les deux) :
```jsx
                {item.contract_number && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span>Contrat {item.contract_number}</span>
                    {item.contract_amount > 0 && (
                      <span className="ml-auto text-sm font-semibold text-emerald-700">
                        {formatEuro(item.contract_amount)}
                      </span>
                    )}
                  </div>
                )}

                {/* Total TTC des pièces saisies dans les certificats (préparation facturation) */}
                {item.parts_total_ttc > 0 && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Wrench className="w-4 h-4 text-gray-400" />
                    <span>Pièces de rechange</span>
                    <span className="ml-auto text-sm font-semibold text-emerald-700">
                      {formatEuro(item.parts_total_ttc)}
                    </span>
                  </div>
                )}

                {/* Équipements du contrat */}
```
(Note : après saisie d'un certificat dans cette même modale, la valeur se met à jour au prochain refetch/réouverture de la liste — comportement attendu, pas bloquant.)

- [ ] **Step 2 : Build**

Run: `npx vite build`
Expected: build OK, aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/entretiens/EntretienSAVModal.jsx
git commit -m "feat(entretien): total TTC des pièces affiché sur la fiche, sous le contrat"
```

---

## Task 5 : Carte Kanban — montant pièces secondaire (ambre)

**Files:**
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (insertion après la ligne ~163)

Contexte : `formatEuro` est déjà utilisé dans le fichier (ligne 160). On insère une petite ligne sous le bloc « Nom + montant » (qui se ferme à la ligne 163) et avant le bloc « Ligne 2 : Code postal + ville ».

- [ ] **Step 1 : Insérer le montant pièces**

Repérer :
```jsx
            {amount > 0 && (
              <span className="text-xs font-semibold text-emerald-700 flex-shrink-0">
                {formatEuro(amount)}
              </span>
            )}
          </div>

          {/* Ligne 2 : Code postal + ville */}
```
Remplacer par :
```jsx
            {amount > 0 && (
              <span className="text-xs font-semibold text-emerald-700 flex-shrink-0">
                {formatEuro(amount)}
              </span>
            )}
          </div>

          {/* Montant pièces (TTC) — à facturer en plus du contrat */}
          {Number(item.parts_total_ttc) > 0 && (
            <div className="flex justify-end">
              <span className="text-[10px] font-medium text-amber-700">
                + {formatEuro(Number(item.parts_total_ttc))} pièces
              </span>
            </div>
          )}

          {/* Ligne 2 : Code postal + ville */}
```

- [ ] **Step 2 : Build**

Run: `npx vite build`
Expected: build OK, aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/entretiens/EntretienSAVCard.jsx
git commit -m "feat(entretien): montant pièces TTC sur la carte Kanban (facilite la facturation)"
```

---

## Task 6 : Vérification finale

- [ ] **Step 1 : Build + lint + dead-code complets**

Run: `npx vite build`
Expected: OK.

Run: `npm run audit:quality`
Expected: `lint:errors` clean + aucun nouveau fichier mort.

- [ ] **Step 2 : Contrôle de cohérence SQL ↔ UI (spot-check)**

`execute_sql` — récupérer un entretien avec pièces pour qu'Eric le retrouve dans l'UI :
```sql
SELECT id, client_name, contract_number, contract_amount, parts_total_ttc
FROM public.majordhome_entretien_sav
WHERE parts_total_ttc > 0
ORDER BY parts_total_ttc DESC
LIMIT 5;
```
Attendu : montants `parts_total_ttc` plausibles. Communiquer un exemple (nom + montant) à Eric pour vérif visuelle modale + carte sur son serveur de dev.

- [ ] **Step 3 : Récap à Eric** — lister les commits, rappeler que le PDF doit être régénéré pour voir la colonne prix disparue, et **demander si on push** (pas de push sans accord). Ne pas oublier la question cosmétique ouverte (montant carte en ambre vs vert).

---

## Self-review (rempli par l'auteur du plan)

- **Couverture spec :** PDF sans prix (Task 2 ✅), total à la source TTC parent+enfants (Task 1 ✅), ligne fiche (Task 4 ✅), montant carte (Task 5 ✅), relabel saisie TTC (Task 3 ✅), GRANT + security_invoker + NOTIFY (Task 1 ✅). Phase 2 hors périmètre (conforme).
- **Placeholders :** aucun — tous les blocs de code sont complets et exacts.
- **Cohérence des noms :** `parts_total_ttc` partout (vue, modale, carte, vérifs) ; clé JSONB `prix_ht` laissée intacte (documenté). `Wrench`/`formatEuro` confirmés importés dans la modale ; `formatEuro` confirmé présent dans la carte.
- **Risque DB :** `CREATE OR REPLACE VIEW` additive (colonne en fin), `security_invoker` réaffirmé, rollback trivial (re-replace sans la colonne). Instance prod partagée → vérifs de non-régression (count avant/après) incluses.
