# Facturation d'un entretien : push Majord'home → Pennylane

> Date : 2026-09-21 · Arbitré avec Eric (30 jours d'échéance, pièces sur la même facture, envoi au client depuis Pennylane pour l'instant).

## Constat

Le tag « Facturé » d'une carte entretien n'a qu'un seul écrivain : le bouton manuel de la carte
(`invoiced_at`). Aucune fonction DB, aucun cron, aucun workflow N8N ne lit les factures Pennylane pour
marquer les entretiens ; `pullInvoices` n'a aucun appelant et le proxy bloque tout `POST` sur
`/customer_invoices`. Mesuré en prod le 2026-09-21 : 50 entretiens « Réalisé », 41 marqués à la main,
0 mapping facture dans `pennylane_sync`, 0 `interventions.invoice_id` renseigné. « Ça marche parfois »
= quelqu'un a cliqué.

## Décision

Un bouton **« Facturer »** sur la carte entretien Réalisé crée la facture dans Pennylane **et** marque la
carte (`invoice_id` + `invoiced_at`) dans la foulée. Le marquage manuel reste en secours (facture faite
directement dans Pennylane, org sans intégration).

- **Périmètre V1** : cartes `intervention_type = 'entretien'` en `realise`, org avec
  `settings.pennylane.enabled`. Les SAV restent hors périmètre (leur montant vient d'un devis PL).
- **Lignes** = lignes tarifaires enregistrées du contrat effectif (`majordhome_contract_pricing_items`,
  1 par équipement, libellé du type) **mises à l'échelle du montant contractuel** `contract.amount`
  (source figée à la signature, cf. Module Contrats) — la facture porte le prix facturé, pas le prix
  catalogue ni une ligne de remise (c'est ce que fait la saisie manuelle : DALOUS 90 € sur un produit
  catalogue à 99 €). Sans ligne tarifaire : une ligne « Contrat d'entretien CTR-xxx » au montant.
  Plus les **pièces non offertes** de `parts_detail`, sur la même facture.
- **TVA par ligne** = `equipment_categories.default_vat_rate` de la catégorie du type. Catégorie sans
  TVA → 20 % **et avertissement visible** dans l'aperçu. Les pièces prennent la TVA de la première
  ligne d'équipement. Montants MDH en TTC → HT = TTC / (1 + taux), transmis avec 10 décimales (PL
  recalcule et arrondit ; c'est ce qu'a produit la saisie manuelle : `81.81818181818181`).
- **Objet PDF** : « Entretien de votre poêle à bois : Marque · Modèle · N° série », reconstruit depuis
  les équipements du contrat (format de la saisie manuelle).
- **Échéance** : `settings.pennylane.invoice.deadline_days` (défaut 30).
- **Mode** : `settings.pennylane.invoice.mode` = `draft` (défaut) | `final`. On démarre en brouillon :
  la facture apparaît dans Pennylane, la carte est marquée, Eric finalise et envoie depuis PL. Bascule
  en `final` quand le mapping est jugé fiable. Une facture finalisée est un document légal irréversible.
- **Idempotence** : `external_reference` = id de l'intervention ; ligne `pennylane_sync`
  `entity_type='invoice'`, `local_id` = intervention, `pennylane_id` = facture PL, `pennylane_number`,
  `metadata.public_file_url`. Avant tout POST on relit ce mapping : s'il existe, on ne recrée pas, on
  ré-applique juste `invoice_id`/`invoiced_at` sur l'intervention (filet si l'écriture MDH avait
  échoué après la création PL).
- **Client** : pont `pennylane_sync` type `client`, sinon `getOrCreateCustomer` (même pattern que le
  push devis).
- **Réglages sans UI = interdit** → nouvelle tuile Socle « Facturation Pennylane » (`/settings/pennylane`)
  : activation de l'intégration (le toggle n'avait aucune UI), échéance, mode brouillon/finalisée.

## Pièces

- Module pur `src/lib/entretienInvoiceModel.js` (testé `scripts/entretien-invoice-model.test.mjs`,
  inclus dans `audit:quality`) : `buildEntretienInvoice(...)` → modèle (lignes, objet, total,
  avertissements, erreurs) et `toPennylaneInvoicePayload(model, …)` → corps `POST /customer_invoices`.
- Proxy `pennylane-proxy` : `POST` autorisé sur `/customer_invoices` **exact** (pas les sous-routes
  `finalize` / `send_by_email`, qui restent bloquées).
- Service `pennylaneService.createInvoiceFromEntretien({ orgId, interventionId, clientId, payload })`.
- `savService.updateFields` : `invoice_id` ajouté à l'allowlist.
- Hook `useCreateEntretienInvoice(orgId)` (`usePennylane.js`), contrat `unwrapResult`.
- UI : `FacturerEntretienDialog` (aperçu lignes / TVA / total / objet / mode, avertissements, erreurs
  bloquantes) ouvert depuis `EntretienSAVCard` ; bouton grisé « Facturée » quand `invoice_id` est posé.
- Settings : `PennylaneSettings.jsx` + `pennylane/FacturationTab.jsx`, route `settings/pennylane`,
  tuile dans `src/lib/modules.js`.

## Hors périmètre (suites)

- Envoi de la facture au client depuis Majord'home (`send_by_email`).
- Lien direct vers la facture sur la carte (le mapping existe, il manque une colonne de vue).
- Rattrapage des factures faites à la main dans Pennylane (sweep `customer_invoices` → matching
  client × date, heuristique).
- SAV.
