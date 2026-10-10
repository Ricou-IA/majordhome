# Anomalie du certificat → carte Entretien, demande SAV, facture ; commentaire sur le devis

**Date** : 2026-10-10 · **Décision** : Eric (test des devis avec Philippe, cas GUILLOU BRUNO / CTR-00127)
**Statut** : validé en discussion, implémentation dans la foulée.

## Problème

Le technicien saisit l'anomalie sur le certificat d'entretien (étape Bilan : « Détail des anomalies »
+ « Action corrective »). Aujourd'hui cette information ne vit **que** dans l'encadré orange du PDF du
certificat, en 6,5 pt. Cas réel : CERT-2026-01050 (GUILLOU, chaudière Burneco Cap 30, 07/10/2026) :
« Creuset commence à se déformer », action « devis ». Rien n'en découle : pas de SAV, rien sur la carte
Entretien, rien sur la facture. Philippe découvre l'anomalie en ouvrant le PDF, ou jamais.

Par ailleurs le devis natif n'a pas de commentaire libre visible par le client (seulement les
« Conditions de vente » et des « Notes internes » invisibles).

## Décisions

1. **L'anomalie est visible sans ouvrir la fiche** : zone « Anomalie » sur la carte du Kanban Entretien
   et section « Anomalie constatée » dans la fiche de synthèse. **La source reste le certificat** : rien
   n'est recopié dans `interventions`, la vue agrège.
2. **« Devis à établir » crée une demande SAV** dans le Kanban Entretien (colonne « Demande »), à la
   finalisation du certificat, pour Philippe. Une seule par certificat (clé `source_certificat_id`).
   Déclencheur : `action_corrective = 'devis'` et bilan non conforme. « Arrêt d'urgence » ne déclenche
   pas (décision par défaut, à élargir si Eric le demande).
3. **L'anomalie s'imprime sur la facture d'entretien** comme information client, texte pré-rempli et
   modifiable dans la modale « Facturer », dans les deux modes (hub et brouillon Pennylane).
4. **Le devis natif porte un commentaire visible par le client** (`quotes.commentaire`), distinct des
   conditions, rendu dans le PDF et l'aperçu.

## Modèle de données (migration `20261010_1`)

| Objet | Changement |
|---|---|
| `majordhome.quotes` | `+ commentaire text` ; vues `majordhome_quotes` et `majordhome_quotes_write` : colonne ajoutée **en fin de liste** (CREATE OR REPLACE) |
| `majordhome.interventions` | `+ source_certificat_id uuid REFERENCES certificats(id) ON DELETE SET NULL` ; index unique partiel `WHERE source_certificat_id IS NOT NULL` ; vue `majordhome_interventions` : colonne en fin |
| `majordhome.invoices` | `+ client_note text` (figée à l'émission : ajoutée au trigger `invoices_guard_immutable`, branche émise) ; vue `majordhome_invoices` recréée (`i.*` ⇒ DROP + CREATE + re-GRANT) ; RPC `invoice_create_draft` : `client_note` dans l'INSERT |
| `majordhome_entretien_sav` | `+ anomalies jsonb` en fin : un élément par certificat (racine + enfants) dont `bilan_conformite IN ('anomalie','arret_urgence')` : `{ certificat_id, intervention_id, equipment_id, equipement, equipement_type, bilan, detail, action, date, sav_id }` ; `sav_id` = intervention SAV dont `source_certificat_id` = ce certificat |

Harnais de répétition : `certificats` photographié avec les colonnes du bilan ; vues `majordhome_quotes`,
`majordhome_quotes_write`, `majordhome_invoices` et fonctions `invoice_create_draft`,
`invoices_guard_immutable` ajoutées aux listes de `snapshot.mjs` ; assertions
`assert-anomalie-certificat.sql` (colonnes exposées, index unique, vue interrogeable).

## Module pur `src/lib/certificatAnomalies.js` (testé, dans `audit:quality`)

- `ACTIONS_CORRECTIVES` : source unique des libellés (`sur_place`, `devis`, `arret_urgence`) ;
  `StepBilan` l'importe (plus de liste locale).
- `anomaliesDeCarte(item)` : normalise `item.anomalies` (jsonb ou chaîne) en tableau trié par date.
- `doitCreerSav(certificat)` : `action_corrective === 'devis'` et bilan ∈ {anomalie, arret_urgence}.
- `descriptionSavDepuisCertificat(cert, { equipementLabel })` : texte de la demande SAV
  (« Suite à l'entretien du 7 octobre 2026 (Burneco Cap 30) : Creuset commence à se déformer. Devis à établir. »).
- `noteClientDepuisAnomalies(anomalies)` : texte pré-rempli de la facture
  (« Constaté lors de l'entretien : … Un devis vous sera adressé. » / « Corrigé sur place. » /
  « Installation mise à l'arrêt par sécurité. ») ; vide s'il n'y a rien.

## Flux

**Carte** (`EntretienSAVCard`) : sous le numéro de contrat, bloc ambre « Anomalie » (icône triangle,
détail sur deux lignes, étiquette de l'action, « SAV créé » si `sav_id`). Les SAV d'origine `entretien`
portent une étiquette « Suite d'entretien ».

**Fiche de synthèse** (`EntretienSAVModal`) : section « Anomalie constatée » en lecture seule au-dessus
de « Notes internes » : équipement, détail, action, bouton « Voir certificat » (`CertificatLink`),
mention « Demande SAV créée » le cas échéant.

**Finalisation du certificat** (`CertificatWizard.finaliser`) : après `markRealise` et avant le PDF,
si `doitCreerSav(data)` ⇒ `savService.createSAV({ …, savOrigin: 'entretien', sourceCertificatId,
equipmentId, savDescription })`. Violation d'unicité (`23505`) = déjà créé, silencieux. Autre erreur ⇒
`toast.warning` explicite, le certificat et le « Réalisé » restent posés (jamais bloquant). Cache
`entretienSavKeys.all(orgId)` invalidé.

**Facture** (`FacturerEntretienDialog`) : champ « Information client (imprimée sur la facture) »,
pré-rempli par `noteClientDepuisAnomalies`, modifiable, vide = rien. Porté par `model.clientNote` :
- hub : `buildInvoiceDraft` → `invoice.client_note` ; `buildInvoicePdfModel` → `clientNote` ;
  `InvoicePDF` : bloc « Information » entre les totaux et « Règlement ». L'import Pennylane du hub
  envoie notre PDF, rien d'autre à faire. Un avoir ne reprend pas la note.
- brouillon Pennylane : `toPennylaneInvoicePayload` → `pdf_invoice_free_text` (texte libre du PDF
  Pennylane). ⚠️ Nom de champ non vérifiable hors ligne : à confirmer au premier brouillon réel, une
  erreur 400 remonte le message Pennylane tel quel (`apiCall`).

**Devis** : `createQuote` / `updateQuote` / duplication portent `commentaire` ; champ « Commentaire sur
le devis (visible par le client) » dans le bloc « Remise, validité, conditions » au-dessus des
conditions ; zone `commentaire` dans `devisDocumentModel` (réglage `null`, portée par le devis),
rendue dans `DevisPDF` et `ApercuDevis` entre les totaux et la validité, affichée dans `DevisModal`.

## Hors périmètre

Pré-remplissage du commentaire de devis depuis le SAV (le devis SAV reste un devis Pennylane) ;
« Arrêt d'urgence » → SAV ; note client sur les factures d'avoir ; rétro-création de SAV pour les
certificats déjà signés (GUILLOU : Philippe crée le SAV à la main depuis la carte, qui affiche
désormais l'anomalie).

## Vérification

`npx vite build`, `npm run audit:quality` (tests purs : certificat-anomalies, devis-document-model,
entretien-invoice-model, invoice-document-model), répétition de la migration sur le harnais, puis
application en prod et contrôle sur CTR-00127 : la carte GUILLOU affiche « Creuset commence à se
déformer · Devis à établir ».
