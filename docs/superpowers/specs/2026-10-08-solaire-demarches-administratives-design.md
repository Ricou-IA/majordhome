# Solaire — Démarches administratives photovoltaïque (conception)

> Date : 2026-10-08. Source : `SPEC_demarches_photovoltaique.md` d'Eric (08/10/2026), adaptée à l'existant de `src/apps/solaire/`.
> Brouillon du mandat : `docs/solaire/2026-10-08-mandat-representation-pv-brouillon.md`.
> Décisions prises avec Eric le 2026-10-08 : **pose au sol hors périmètre** (« on n'en fera jamais ») ; **frais avancés par l'entreprise et refacturés au client** ; **dépôt par mandat** (mandat signé à l'offre, effet à l'acceptation du devis) ; pas de « date de signature », le planning part de la validation du dossier.

## 1. Objectif

À partir d'une simulation PV et de son dossier (`pv_dossiers`), produire sans resaisie :

1. le **parcours administratif** applicable (étapes, qui fait quoi, délais) ;
2. un **planning prévisionnel daté** jusqu'à la mise en service ;
3. la **checklist des pièces** à collecter auprès du client ;
4. le **tableau des frais** (DP, Enedis, Consuel) avec leur prise en charge ;
5. les **alertes** (ABF, copropriété, éligibilité au rachat, paramètre périmé…) ;
6. deux **pages « Démarches » dans l'étude PDF** (synoptique + vigilance) ;
7. le **mandat de représentation** (mairie + Enedis) généré depuis le consentement déjà signé, assemblé dans le dossier PV.

Tout montant et tout délai est un **paramètre daté** éditable dans Settings, jamais une constante du code.

## 2. Périmètre

**Dans le périmètre** : installation photovoltaïque **en toiture** d'un logement individuel, ≤ 36 kVA, autoconsommation totale (CACSI) ou avec vente du surplus (obligation d'achat). Mayer est RGE ; le champ `installateur_rge` est conservé (dérivé des certifications de l'org) parce qu'une autre org pourrait ne pas l'être.

**Hors périmètre (assumé)** :
- pose au sol (règles §4.1 de la spec d'origine abandonnées : la DP est toujours due, l'éligibilité au rachat ne dépend que du RGE) ;
- suivi prévu/réalisé par étape (§6.5, « V2 ») : il s'appuiera sur la machine à états existante `pv_dossiers.status`, pas sur un 2ᵉ jeu de statuts ;
- récupération automatique du périmètre ABF : **déjà livrée** (apicarto GPU, juillet 2026), rien à faire ;
- dépôt automatisé sur le guichet numérique, télétransmission Enedis : geste humain.

## 3. Existant réutilisé (ne pas recréer)

| Besoin | Existant |
|---|---|
| Entité pivot par projet | `majordhome.pv_dossiers` (1 simulation → 1 dossier, statuts forward-only, RPC `pv_dossier_advance`) |
| Périmètre ABF | `wizardState.abf` → `pv_dossiers.abf` `{ secteur_protege, protections, source, checked_at }` |
| Adresse, INSEE, parcelles | `location`, `cadastre` (`commune_insee`, `parcelles`) |
| Puissance | scénario sélectionné (`selectedKwc` ou recommandé) |
| Batterie | `optim.batteryOn` |
| Déclarant (identité, naissance) | `pv_dossiers.declarant` |
| Consentement + signature manuscrite | `pv_dossiers.consent` (`items.dp_depot`, `items.enedis_raccordement`, `signataire_nom`, `lieu`, `signed_at`, `signature_path`) |
| Identité de l'entreprise | `buildCompanyInfo(settings)` (`legalName`, `siret`, `rcs`, `capital`, adresse, `rgeCertifications`) |
| Paramètres org Solaire | `settings.pv` via `buildPvConfig`, page `/settings/solaire` (onglets, `save({ pv })` objet complet) |
| PDF étude | `EtudePDF.jsx` + `etude/pdfShared.jsx` (react-pdf, formatters PDF-safe) |
| Assemblage du dossier | `dossierDocuments.js` + `assembleDossierBlob` (CERFA → notice → DPC1 → DPC2) |
| Palette | `palette.js` (jaunes graphiques, bleus texte, deutan) |

## 4. Architecture

```
src/apps/solaire/lib/demarches/        ← moteur PUR (aucun import React/Supabase/alias, JSDoc)
  index.js          calculerDemarches(inputs, parametres, { aujourdhui }) → résultat ; ENGINE_VERSION
  referentiel.js    ETAPES (9 + étape préalable copropriété), textes client / entreprise / tiers
  regles.js         applicabilité des étapes, délai d'instruction, Consuel, Enedis, rachat, alertes
  planning.js       dates prévisionnelles (chevauchement recours / Enedis, arrondi semaine ouvrée)
  pieces.js         checklist (pièces de base + conditionnelles)
  frais.js          lignes de frais + prise en charge
  parametres.js     DEMARCHES_DEFAULTS, buildDemarchesParams(settings), valeurA(liste, date)
  mandatModel.js    blocs de texte du mandat (parties, site, articles, signatures)
src/apps/solaire/components/demarches/ ← UI étape Résultats (section « Démarches administratives »)
src/apps/solaire/components/etude/DemarchesPage.jsx, DemarchesVigilancePage.jsx   ← pages PDF
src/apps/solaire/components/dossier/MandatPDF.jsx                                 ← document mandat
src/apps/artisan/pages/settings/solaire/DemarchesTab.jsx                          ← onglet Settings
scripts/solaire/demarches.test.mjs, scripts/solaire/mandat-model.test.mjs         ← node --test, dans audit:quality
```

Principes : le moteur **calcule**, les composants **affichent**, le PDF **ne calcule rien** (même pattern que `etudeModel` ↔ `EtudePDF`). Le résultat est **figé** dans `pv_dossiers.demarches` avec `engine_version` : un dossier rouvert relit le résultat, il ne recalcule que sur action explicite (« Recalculer »).

## 5. Données

### 5.1 Entrées du moteur (`inputs`)

| Champ | Type | Source |
|---|---|---|
| `commune_insee`, `commune_nom` | string | `cadastre.commune_insee`, `location.address` |
| `puissance_kwc` | number | scénario sélectionné |
| `batterie` | boolean | `optim.batteryOn` |
| `perimetre_abf` | `'oui' \| 'non' \| 'inconnu'` | dérivé : `abf.secteur_protege === true → oui`, `=== false → non`, `abf == null → inconnu` |
| `installateur_rge` | boolean | `company.rgeCertifications.length > 0` |
| `mode_valorisation` | `'autoconso_totale' \| 'autoconso_surplus'` | **nouveau champ**, défaut `autoconso_surplus` |
| `copropriete_ou_lotissement` | `'aucun' \| 'copropriete' \| 'lotissement'` | **nouveau champ**, défaut `aucun` |
| `compteur_linky` | boolean | **nouveau champ**, défaut `true` |
| `date_depart` | ISO date | défaut = date de validation du dossier (`dossier_valide`) si connue, sinon aujourd'hui ; modifiable |
| `prise_en_charge` | `{ raccordement_enedis, consuel }` ∈ `'refacture' \| 'inclus'` | défaut global (Settings), surcharge par projet |

Les nouveaux champs sont saisis dans la section Démarches de l'étape Résultats et persistés dans `pv_dossiers.demarches.inputs`.

### 5.2 Résultat du moteur

```js
{
  engine_version: 1,
  calcule_le: '2026-10-08',
  etapes: [{ code, libelle, ordre, applicable, client, installateur, tiers, delai: { libelle } | null }],
  planning: {
    depot_dp, accord_dp, fin_recours, depot_enedis, reponse_enedis,
    pose_au_plus_tot, mise_en_service_au_plus_tard,       // ISO dates
    duree_totale_mois: 7.5,
    hypotheses: ['Dépôt de la DP 7 jours après le départ', 'Instruction 2 mois (ABF)', …],
  },
  pieces: [{ code, libelle, obligatoire, condition, statut: 'a_demander' }],   // statut remis par l'UI
  frais: [{ code, libelle, montant_ttc, montant_connu, prise_en_charge, parametre: { cle, date_effet } }],
  alertes: [{ code, niveau: 'info' | 'avertissement' | 'bloquant', message }],
  parametres_utilises: { frais_raccordement_enedis: { valeur, date_effet }, … },   // traçabilité
}
```

### 5.3 Paramètres org — `settings.pv.demarches`

Deux familles. Les **délais** sont de simples valeurs ; les **tarifs** sont des listes datées.

```js
demarches: {
  delais: {
    depot_dp:           { jours: 7 },
    instruction_dp:     { mois: 1 },
    instruction_dp_abf: { mois: 2 },
    recours_tiers:      { mois: 2 },
    enedis_cacsi:       { mois: 2 },
    enedis_surplus:     { mois: 3 },
    duree_pose:         { jours: 2 },     // 1 à 3 jours, interne
    consuel:            { jours: 21 },    // hypothèse à ajuster par Mayer
    mise_en_service:    { jours: 42 },    // 6 semaines après Consuel
  },
  tarifs: {
    // liste triée par date_effet ; valeur en vigueur = dernière entrée dont date_effet ≤ date cible
    frais_raccordement_enedis: [{ date_effet: '2026-01-01', valeur_ttc: 50.10, valide_jusqu_au: '2026-10-27', note: 'nouveau barème au 28/10/2026 à saisir' }],
    tarif_consuel_bleu:        [{ date_effet: '2026-01-01', valeur_ttc: 195.20 }],
    tarif_consuel_violet:      [],                                     // à renseigner → alerte parametre_manquant
    tarif_oa_surplus_lte_9kwc: [{ date_effet: '2026-06-05', valeur_c_eur_kwh: 1.1, source: 'Arrêté du 01/06/2026' }],
    tarif_oa_surplus_gt_9kwc:  [],
    prime_autoconsommation:    [{ date_effet: '2026-06-05', valeur_ttc: 0, note: 'supprimée pour toute demande complète déposée à partir du 05/06/2026' }],
  },
  prise_en_charge_defaut: { raccordement_enedis: 'refacture', consuel: 'refacture' },
}
```

`valeurA(liste, dateCible)` renvoie `{ valeur, date_effet, perimee }` ; `perimee = true` si `valide_jusqu_au < dateCible` → alerte `parametre_perime`. Liste vide → `null` → alerte `parametre_manquant`, montant affiché « à renseigner », jamais 0.

Gotcha connu : `org_update_settings` merge le JSONB au niveau 1 → `DemarchesTab` sauve via `save({ pv: formComplet })` comme les autres onglets de `SolaireSettings` (`buildPvConfig` fait le deepMerge des défauts ; les listes datées **remplacent**, elles ne fusionnent pas).

### 5.4 Nouveaux réglages d'identité (mandat)

`settings.signatory = { name, role, signature_path }` édité dans Settings → Organisation → Identité (champ « Signataire des mandats », upload PNG dans le bucket `product-documents`, path `${orgId}/branding/signature-mandat.png`, URL signée à la génération). Exposé par `buildCompanyInfo` sous `company.signatory`. Sans signataire configuré, le mandat se génère avec la zone de signature entreprise vide et une alerte `signataire_manquant` (Enedis exige les deux signatures).

### 5.5 Persistance par projet — `pv_dossiers.demarches jsonb`

```js
{ inputs, resultat, pieces_statut: { factures_12_mois: 'recue', … }, mis_a_jour_le }
```

Migration versionnée `supabase/migrations/20261008_1_pv_dossiers_demarches.sql` :
- `ALTER TABLE majordhome.pv_dossiers ADD COLUMN IF NOT EXISTS demarches jsonb;`
- `CREATE OR REPLACE VIEW public.majordhome_pv_dossiers WITH (security_invoker=true) AS SELECT * FROM majordhome.pv_dossiers;` + `NOTIFY pgrst, 'reload schema';` (le `SELECT *` de la vue est figé à la création — gotcha vécu avec `consent`).
- Répétée sur `scripts/migration-rehearsal/` avant livraison. Aucune nouvelle table, aucune nouvelle RPC.

Le document mandat s'ajoute à `pv_dossiers.documents` (`mandat_pdf_path`) et à `DOSSIER_DOCUMENTS` (`{ key: 'mandat', label: 'Mandat de représentation' }`), assemblé juste après le CERFA.

## 6. Règles métier (moteur)

### 6.1 Étapes et applicabilité

Référentiel = les 9 étapes de la spec d'origine (`ETUDE_DEVIS`, `DEPOT_DP`, `INSTRUCTION_DP`, `ACCORD_AFFICHAGE`, `RACCORDEMENT_ENEDIS`, `INSTALLATION`, `CONSUEL`, `MISE_EN_SERVICE`, `CONTRAT_CLOTURE`) + `ACCORD_AG` (préalable, uniquement si `copropriete`). Les textes « client » / « installateur » de la spec sont repris tels quels, avec deux variantes pilotées par les entrées :
- `DEPOT_DP` : « Signe la DP, {société} la dépose en mairie par mandat » (toujours, puisque le dépôt est mandaté) ;
- `RACCORDEMENT_ENEDIS` : CACSI (totale) ou demande complète avec obligation d'achat (surplus) ;
- `CONTRAT_CLOTURE` : la phrase « signe le contrat de rachat » n'apparaît qu'en surplus.

Toutes les étapes sont applicables en V1 (toiture ⇒ DP toujours due). Le champ `applicable` reste dans le modèle pour que le PDF masque proprement une étape si une règle future en retire une.

### 6.2 Délai d'instruction
`perimetre_abf = oui` → `instruction_dp_abf` ; `non` → `instruction_dp` ; `inconnu` → `instruction_dp_abf` + alerte `abf_a_verifier` (avertissement). Si `oui` → alerte `abf_prescriptions` (info : panneaux noirs, pose intégrée, échange préalable avec l'UDAP).

### 6.3 Copropriété / lotissement
`copropriete` → étape `ACCORD_AG` + pièce `reglement_copropriete` + alerte `copropriete_ag` (avertissement : la DP ne se dépose qu'après l'accord de l'AG). `lotissement` → pièce `reglement_lotissement` + alerte info.

### 6.4 Enedis
`autoconso_totale` → CACSI, délai `enedis_cacsi`, frais de raccordement 0 €. `autoconso_surplus` → demande complète avec obligation d'achat, délai `enedis_surplus`, frais = `frais_raccordement_enedis` à la date `planning.depot_enedis` si `compteur_linky` ; sinon montant inconnu + alerte `compteur_non_linky` (avertissement : remplacement de compteur, montant à confirmer avec Enedis).

### 6.5 Consuel
`batterie = false` → visa bleu, `tarif_consuel_bleu` ; `true` → visa violet, `tarif_consuel_violet`.

### 6.6 Contrat de rachat
Uniquement en surplus. Éligible si `installateur_rge` (la pose est toujours en toiture). Non RGE → alerte `oa_non_eligible` (bloquant pour le mode surplus). Tarif affiché = `tarif_oa_surplus_lte_9kwc` si `puissance_kwc ≤ 9`, sinon `tarif_oa_surplus_gt_9kwc` (vide → `parametre_manquant`). La prime à l'autoconsommation vaut 0 € : **jamais affichée** dans l'étude ; le paramètre existe pour la traçabilité et pour une éventuelle réintroduction.

### 6.7 Planning (`planning.js`)
À partir de `date_depart` :
```
depot_dp        = date_depart + delais.depot_dp
accord_dp       = depot_dp + instruction (1 ou 2 mois calendaires)
fin_recours     = accord_dp + recours_tiers
depot_enedis    = accord_dp                                   // démarre dès l'accord, en parallèle du recours
reponse_enedis  = depot_enedis + enedis_(cacsi|surplus)
pose_au_plus_tot = lundi suivant max(fin_recours, reponse_enedis)   // « prochaine semaine ouvrée »
mise_en_service_au_plus_tard = pose_au_plus_tot + duree_pose + consuel + mise_en_service
duree_totale_mois = (mise_en_service_au_plus_tard − date_depart) / 30.44, 1 décimale
```
`ACCORD_AG` (copropriété) n'a pas de délai réglementaire : il n'entre pas dans le calcul, il est signalé comme préalable. Arithmétique de dates en UTC pur (`Date.UTC`), mois calendaires (`setUTCMonth`), semaine ouvrée = lundi. Toute date affichée porte la mention « délais indicatifs ».

### 6.8 Pièces (`pieces.js`)
Base : `factures_12_mois`, `numero_pdl`, `justificatif_propriete`, `piece_identite_declarant`, `mandat_signe`. Conditionnelles : `rib` (surplus), `reglement_copropriete` (copropriété), `reglement_lotissement` (lotissement), `accord_ag` (copropriété). Statut par pièce `a_demander | recue | non_applicable`, porté par l'UI dans `pieces_statut`, défaut `a_demander` (ou `non_applicable` quand la condition n'est pas remplie).

### 6.9 Frais (`frais.js`)
Lignes : `dp` (0 €, « gratuite »), `raccordement_enedis`, `consuel`. Chaque ligne : `montant_ttc` (ou `null` + `montant_connu: false`), `prise_en_charge` (`refacture` : « avancés par {société}, refacturés » ; `inclus` : « inclus dans l'offre »), `parametre` (clé + date d'effet utilisée). Total affiché uniquement si tous les montants sont connus.

### 6.10 Alertes
Codes : `abf_a_verifier`, `abf_prescriptions`, `copropriete_ag`, `lotissement_reglement`, `oa_non_eligible`, `compteur_non_linky`, `parametre_manquant` (avec la clé), `parametre_perime` (avec la clé et la date), `signataire_manquant`. Niveaux `info | avertissement | bloquant`. Rendu : couleur **et** icône **et** libellé du niveau (jamais la couleur seule).

## 7. Mandat de représentation

- Texte = brouillon `docs/solaire/2026-10-08-mandat-representation-pv-brouillon.md` (un document bipartite : article 1 urbanisme, article 2 Enedis aligné sur `Enedis-FOR-RAC_02E`, effet à l'acceptation du devis, caducité 12 mois, pouvoir de règlement coché, L.342-2 non coché).
- `mandatModel.js` (pur) construit les blocs depuis `{ declarant, site, cadastre, projet, company, consent, devis }` ; `MandatPDF.jsx` les rend (react-pdf, 2 pages, logo org en tête comme l'autorise Enedis). Signature client = image `consent.signature_path` (re-fetchée, fail-loud comme le CERFA) ; signature entreprise = `company.signatory.signature_path`.
- `devis` = `{ numero, date }` saisi dans la section Démarches (libre tant que les devis natifs ne sont pas là ; pré-rempli depuis le devis Pennylane rattaché au lead si disponible).
- Les textes de `consentItems.js` restent le **résumé à l'écran** avant signature ; une phrase renvoie au mandat complet (« le mandat complet vous est remis avec le dossier »). Un seul geste de signature couvre CERFA + mandat. Les dossiers déjà signés avant cette livraison peuvent générer le mandat : le consentement existant contient déjà les deux autorisations.
- Généré dans la même chaîne que le CERFA (`DossierDrawer`), stocké `${orgId}/solaire/dossiers/${dossierId}/mandat.pdf`, assemblé après le CERFA.

## 8. UI

### 8.1 Étape Résultats — section « Démarches administratives »
Sous la carte « Dossier réglementaire ». Composants `components/demarches/` :
- `DemarchesSection.jsx` (orchestrateur : lit le dossier, calcule ou relit le résultat figé, bouton « Recalculer » si `engine_version` ou entrées changent) ;
- `DemarchesInputs.jsx` (mode de valorisation, copropriété/lotissement, Linky, date de départ, devis de référence, prise en charge des frais) ;
- `ParcoursSynoptique.jsx` (étapes en 3 colonnes : Étape / Ce que vous faites / Ce que nous faisons, jaune `#FFF6D6` bord `#F5C542` et bleu `#E3F0FD` bord `#2196F3`, avec icône et libellé) ;
- `PlanningPrevisionnel.jsx` (frise datée + durée totale + hypothèses) ;
- `ChecklistPieces.jsx` (3 états, persistés via `patchBlock`) ;
- `TableauFrais.jsx` ; `AlertesDemarches.jsx`.
Sans simulation enregistrée : même message que la carte Dossier (enregistrer d'abord). La logique reste dans le moteur ; les composants reçoivent `resultat` et des callbacks.

### 8.2 Settings → Solaire → onglet « Démarches »
`DemarchesTab.jsx` : délais (champ + unité), tarifs datés (tableau par clé : date d'effet, valeur, valide jusqu'au, note ; ajouter / supprimer une ligne), prise en charge par défaut. Sauvegarde = objet `pv` complet. Tuile `modules.js` : description mise à jour (« …, démarches administratives »).

### 8.3 Settings → Organisation → Identité
Bloc « Signataire des mandats » : nom, fonction, image de signature (upload PNG, aperçu, suppression).

### 8.4 DossierDrawer
Ligne « Mandat de représentation » dans la liste des pièces générées ; régénération possible avec le reste.

## 9. PDF étude

Deux pages ajoutées à `EtudePDF` après `CoutsPage` :
- `DemarchesPage` : synoptique 3 colonnes (étapes applicables), mention « délais indicatifs ».
- `DemarchesVigilancePage` : points de vigilance (PLU, ABF, copropriété), planning daté, checklist, frais avec prise en charge, « bon à savoir ».
Rendu depuis `resultat` figé (jamais de recalcul dans le PDF). Formatters PDF-safe (`pdfShared`), aucun glyphe hors Helvetica. Pages présentes uniquement si le dossier porte un résultat Démarches (une étude sans dossier reste à 6 pages).

## 10. Tests et critères d'acceptation

`scripts/solaire/demarches.test.mjs` (moteur) et `scripts/solaire/mandat-model.test.mjs`, ajoutés à `audit:quality` :

1. Toiture, sans ABF, surplus, sans batterie, Linky → 9 étapes applicables, instruction 1 mois, Consuel bleu, contrat de rachat affiché, frais Enedis = valeur en vigueur à `depot_enedis`.
2. Même projet, `abf = null` → instruction 2 mois + alerte `abf_a_verifier`.
3. `abf.secteur_protege = true` → 2 mois + `abf_prescriptions`.
4. Batterie → Consuel violet ; liste `tarif_consuel_violet` vide → `parametre_manquant`, montant `null`, pas de total.
5. Autoconso totale → CACSI, délai 2 mois, frais Enedis 0, pas de contrat de rachat, pas de RIB.
6. Copropriété → étape `ACCORD_AG` + pièces + alerte ; lotissement → pièce seule.
7. Non RGE + surplus → `oa_non_eligible` bloquant.
8. Planning : chevauchement (pose = lundi suivant le max), mois calendaires (31/01 + 1 mois), tarif résolu à la bonne date (28/10/2026 bascule), `parametre_perime` quand `valide_jusqu_au` est dépassé.
9. Changer un paramètre dans `settings` → nouveau résultat sans redéploiement (test : deux jeux de paramètres, deux résultats).
10. Mandat : blocs complets avec consentement existant ; signataire org absent → `signataire_manquant` ; mode totale → CACSI cité, OA absent.
11. Accessibilité : chaque alerte et chaque colonne du synoptique porte icône + libellé (test sur le modèle : `niveau` et `libelle` toujours présents ; contrôle visuel pour le rendu).

Vérification de livraison : `npx vite build`, `npm run lint:errors`, `npm run audit:quality`, migration répétée sur le harnais, contrôle visuel PDF via le harnais react-pdf → PNG.

## 11. Découpage en tranches

1. **Moteur + paramètres + onglet Settings** (pur, testé ; rien de visible pour le client).
2. **Section Résultats + persistance** (`pv_dossiers.demarches`, migration, checklist).
3. **Pages PDF + mandat** (`DemarchesPage`, `DemarchesVigilancePage`, `mandatModel`, `MandatPDF`, signataire org, assemblage dossier).

Chaque tranche se termine par build + tests verts + checkpoint.

## 12. Points restant à renseigner par Mayer (pas des bloqueurs)

- Tarif Consuel violet ; tarif de rachat > 9 kWc ; nouveau barème Enedis au 28/10/2026 (saisis dans l'onglet Démarches, alertes tant qu'ils manquent).
- Délai Consuel (hypothèse 21 jours) et durée de pose (2 jours).
- Nom, fonction et signature du signataire Mayer pour le mandat.
- Relecture du texte du mandat par Eric (brouillon fourni).
