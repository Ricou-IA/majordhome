# Entretien — Prix des pièces : sortir du certificat, remonter sur la fiche/carte, préparer la facturation Pennylane

> **Date** : 2026-06-05
> **Statut** : Design validé (Phase 1 à implémenter) — Phase 2 (Pennylane) conçue mais différée
> **Module** : Certificats d'entretien / Planning entretien-SAV / Pennylane
> **Spec liée** : refonte RDV↔Kanban Bloc A (`2026-06-03-rdv-kanban-unifie-bloc-a-design.md`)

## Contexte & friction

À la fin du process entretien, l'exécution se conclut par la **rédaction du certificat** (wizard 9 étapes). À l'**étape 7 « Pièces »**, le technicien saisit les pièces de SAV/rechange (désignation, référence, quantité, **prix HT**). Le prix est aujourd'hui saisi à la main (une gamme d'articles pré-remplie viendra plus tard — hors scope).

Ce prix sert deux besoins qui se mélangent mal :

- **Traçabilité interne** : savoir quelles pièces ont été posées et pour quel montant, pour facturer.
- **Document client** : le certificat PDF — où le prix n'a rien à faire.

**Problème actuel** : le prix « remonte » dans le **certificat PDF** envoyé au client (colonne « Prix HT » du tableau « Pièces remplacées »). Ce n'est pas souhaitable.

**Ce qu'on veut à la place** :

1. Le prix **disparaît du PDF client** (on garde la liste des pièces pour la traçabilité, sans tarif).
2. Le **montant cumulé des pièces** remonte sur la **fiche** (modale entretien), sous la ligne contrat :
   ```
   Contrat CTR-00493 : 90 €
   Pièces de rechange : XX €   ← XX = somme des pièces saisies
   ```
3. Le même montant s'affiche sur la **carte Kanban** une fois le certificat établi — pour faciliter la facturation d'un coup d'œil.
4. **Idéalement (Phase 2)** : pouvoir **lancer la facturation des pièces directement sur Pennylane**.

## Objectifs

**Phase 1 (ce sprint)** :
- Retirer le prix des pièces du certificat PDF (liste conservée).
- Calculer le total HT des pièces d'un entretien à la source (vue), une seule fois.
- Afficher ce total sur la modale et sur la carte Kanban.

**Phase 2 (différée, conçue ici pour cohérence)** :
- Bouton « Facturer les pièces sur Pennylane » créant un brouillon de facture.

**Hors scope** :
- Gamme d'articles pré-remplie (catalogue de pièces). Viendra plus tard.
- Facturation du contrat d'entretien lui-même (90 €) — déjà géré par l'abonnement annuel, séparé.
- Coût de main-d'œuvre.

## Hypothèses validées
- `prix_ht` = **prix unitaire HT**. Montant d'une ligne = `prix_ht × quantité`. Total pièces = Σ des lignes, **en HT**.
- Le total s'affiche **dès qu'au moins une pièce avec prix est saisie** (en pratique : pendant/après l'étape 7).
- La future facture Pennylane ne porte **que les pièces** (pas le contrat).

---

## Phase 1 — Décisions de design

### 1. Source unique du total : champ dérivé `parts_total_ht` dans la vue `majordhome_entretien_sav`

**Pourquoi la vue plutôt que le frontend** : la carte Kanban est une liste ; agréger par carte côté front = N+1 requêtes. En posant le calcul dans la vue (déjà `security_invoker=true`, déjà des `LEFT JOIN LATERAL` pour `next_rdv_date`), le total est disponible **partout sans requête supplémentaire** et se **met à jour tout seul** quand un certificat change. Pas de dénormalisation à resynchroniser, donc pas de dérive possible.

**Périmètre de la somme (point clé)** : un entretien (carte = intervention parent, `i.id`) peut avoir des certificats :
- sur le **parent lui-même** (`certificats.intervention_id = i.id`) — flux mono-équipement / legacy,
- sur ses **enfants** (`certificats.intervention_id IN (enfants où parent_id = i.id)`) — flux multi-équipements (lazy-create).

L'agrégat **somme les deux** pour ne rien rater. Les `prix_ht` à `null` comptent pour 0.

**SQL ajouté à la `SELECT` de la vue** (scalar subquery, à insérer à côté de `contract_amount`) :

```sql
COALESCE((
  SELECT SUM(
    COALESCE((elem->>'prix_ht')::numeric, 0)
    * COALESCE(NULLIF(elem->>'quantite', '')::numeric, 1)
  )
  FROM majordhome.certificats cert
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cert.pieces_remplacees, '[]'::jsonb)) elem
  WHERE cert.intervention_id = i.id
     OR cert.intervention_id IN (
          SELECT ch.id FROM majordhome.interventions ch WHERE ch.parent_id = i.id
        )
), 0) AS parts_total_ht
```

**Contraintes à respecter (charte multi-tenant)** :
- Recréer la vue avec `CREATE OR REPLACE VIEW` puis garantir `ALTER VIEW public.majordhome_entretien_sav SET (security_invoker = true);` (préserver le `security_invoker`).
- `GRANT SELECT ON majordhome.certificats TO service_role;` (idempotent) — la vue lit désormais cette table ; sous `security_invoker`, RLS suffit pour le frontend, mais une lecture service_role planterait en `42501` silencieux sans ce GRANT (`majordhome.interventions` est déjà accordé puisque la vue le lit déjà).
- Pas de filtre `org_id` à ajouter dans la subquery : la portée org est déjà garantie par la jointure `i → core.projects p` de la vue + RLS sur `certificats`.

**Migration** : versionnée via `apply_migration` (DDL), nom type `20260605_entretien_parts_total_ht.sql`.

**Impact frontend de lecture** : `savService.getEntretiensSAV` fait `.select('*')` → `item.parts_total_ht` devient disponible **sans changement de service**.

### 2. PDF certificat — retrait du prix

Fichier : `src/apps/artisan/components/certificat/CertificatPDF.jsx` (section « PIECES REMPLACEES », ~lignes 275-294).

- **Supprimer** l'en-tête de colonne `Prix HT` (ligne ~283) et la cellule `{p.prix_ht ? ...}` (ligne ~290).
- **Redistribuer** les `flex` restants pour occuper la largeur : `Designation` 3→4, `Reference` 2→3, `Qte` inchangé (1, centré).
- Conserver Désignation / Référence / Quantité → la traçabilité reste sur le document client, sans tarif.
- **Aucun changement** à la saisie étape 7 (`StepPieces.jsx`) ni au stockage (`certificats.service.js` continue de persister `pieces_remplacees` avec `prix_ht`). Le prix reste capturé, simplement il ne s'imprime plus.

### 3. Fiche (modale entretien) — ligne « Pièces de rechange : XX € »

Fichier : `src/apps/artisan/components/entretiens/EntretienSAVModal.jsx`, juste **après le bloc contrat** (après la ligne ~481, avant le bloc « Équipements du contrat »).

```jsx
{item.parts_total_ht > 0 && (
  <div className="flex items-center gap-2 text-sm text-gray-500">
    <Wrench className="w-4 h-4 text-gray-400" />
    <span>Pièces de rechange</span>
    <span className="ml-auto text-sm font-semibold text-emerald-700">
      {formatEuro(item.parts_total_ht)}
    </span>
  </div>
)}
```

- Même gabarit visuel que la ligne contrat (icône + libellé + montant aligné à droite, vert émeraude).
- `formatEuro` déjà importé dans le fichier. Icône : réutiliser une icône Lucide déjà présente (`Wrench` / `Package`).
- Montant **HT** ; libellé explicite (« Pièces de rechange »). Pas de mention HT/TTC inline pour rester lisible — c'est un indicateur de préparation facturation, pas un document comptable.

### 4. Carte Kanban — montant pièces secondaire

Fichier : `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (montant principal calculé ~lignes 71-76, rendu ~lignes 158-162).

- Le montant principal reste inchangé (contrat, ou devis+contrat pour SAV).
- Ajouter, sous/à côté du montant principal, un **petit montant secondaire** affiché seulement si `item.parts_total_ht > 0` :

```jsx
{Number(item.parts_total_ht) > 0 && (
  <span className="text-[10px] font-medium text-amber-700">
    + {formatEuro(item.parts_total_ht)} pièces
  </span>
)}
```

- Couleur distincte du montant contrat (ambre) pour signaler « à facturer en plus ».
- Visible dès qu'il y a des pièces valorisées (= certificat en cours/établi), ce qui répond à « ajouter le montant des pièces sur la carte quand le certificat est établi ».

### Fichiers touchés (Phase 1)

| Fichier | Changement |
|---|---|
| Migration SQL `majordhome.*` | Ajout `parts_total_ht` à la vue `majordhome_entretien_sav` + `GRANT SELECT certificats TO service_role` + `security_invoker` préservé |
| `CertificatPDF.jsx` | Retrait colonne Prix HT (header + cellule), redistribution flex |
| `EntretienSAVModal.jsx` | Nouvelle ligne « Pièces de rechange : XX € » sous le contrat |
| `EntretienSAVCard.jsx` | Montant pièces secondaire ambre si `parts_total_ht > 0` |

Aucune modif de service de lecture nécessaire (`select('*')`).

### Cas limites

- **Pièces sans prix** (`prix_ht: null`) → comptent 0, n'apparaissent pas comme montant. Liste toujours imprimée dans le PDF (traçabilité).
- **Double saisie parent + enfant d'une même pièce avec prix** → risque théorique de double comptage. En pratique le flux écrit soit sur le parent (mono/legacy), soit sur les enfants (lazy-create) ; les données observées n'ont de prix que d'un côté. Risque accepté et documenté ; aucune contrainte ajoutée.
- **Aucune pièce** → `parts_total_ht = 0`, aucune ligne ni badge affichés (rendu identique à l'existant).
- **Quantité vide/absente** → traitée comme 1 (`NULLIF(...,'')` + `COALESCE(...,1)`).

### Validation

- `npx vite build` (pas de preview tools — Eric a son propre serveur de dev).
- Vérification SQL : exécuter la subquery sur quelques entretiens connus (ex. parent `d6b6cc90` → 100 €) avant/après migration pour confirmer les montants.
- Contrôle visuel : modale + carte sur un entretien avec pièces valorisées, et un PDF régénéré sans colonne prix.

---

## Phase 2 — Facturation Pennylane (design préliminaire, NON implémenté)

> Décision : shipper la Phase 1 d'abord, valider en prod, puis attaquer la Phase 2.

**État de l'intégration** : le proxy Pennylane sait créer **clients** (`POST /customers`) et **devis** (`POST/PUT /quotes`), mais **bloque la création de factures** (`/customer_invoices` en `GET` uniquement). Il n'existe aujourd'hui aucun flux de création de facture in-app.

**Approche cible** : bouton « Facturer les pièces sur Pennylane » sur la carte/modale (entretien avec `parts_total_ht > 0`, certificat établi) → crée un **brouillon de facture** (facture en brouillon, validée/envoyée ensuite depuis Pennylane), lignes = pièces (désignation, qté, prix unitaire HT, TVA `tva_taux` du certificat).

**Travaux nécessaires (≈2 jours)** :
1. **Proxy** : ajouter `POST` à `/customer_invoices` dans l'allowlist (`supabase/functions/pennylane-proxy/index.ts`).
2. **Service** : `createDraftInvoiceFromEntretien()` dans `pennylane.service.js` — résout le `customer_id` Pennylane via `majordhome_pennylane_sync` (pattern bridge existant), crée la facture si le client PL existe (sinon `syncClient` d'abord), wrap `pLimit(5)` pour le rate limit, mapping TVA via `TVA_MAPPING`.
3. **Idempotence** : tracer l'`invoice_id` PL retourné (réutiliser `pennylane_sync` `entity_type='invoice'` ou `interventions.invoice_id` déjà présent) pour ne pas re-créer en double.
4. **UI** : bouton + état (« Brouillon créé sur Pennylane » + lien `public_file_url` quand dispo).

**Questions à trancher au démarrage Phase 2** :
- Facture **brouillon** (recommandé : l'humain valide dans Pennylane) vs finalisée directement.
- Comportement si le client n'a pas encore de customer Pennylane (créer à la volée vs bloquer).
- Granularité : 1 facture par entretien (somme des pièces tous équipements) — cohérent avec le `parts_total_ht`.

---

## Principes respectés
- Source unique de vérité (vue dérivée, pas de dénormalisation) — cohérent avec `next_rdv_date` du Bloc A.
- `security_invoker=true` préservé + `GRANT service_role` (charte multi-tenant).
- Montants signés/imprimés au client = pièces **listées sans prix** ; le tarif reste interne.
- YAGNI : pas de catalogue d'articles ni de main-d'œuvre dans ce lot.
