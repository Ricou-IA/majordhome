# Fiche poêle : caractéristiques exigées par le CEE (BAR-TH-112) et sortie des fumées

Date : 2026-11-28 · Demandé par Eric · Taille : petit changement (document court)

## Intention

Le devis d'un poêle, d'un insert ou d'un foyer doit porter **au minimum** ce que la fiche CEE BAR-TH-112 exige
sur la preuve de réalisation, plus **la sortie du conduit de fumée** (utile à la pose et au métré de fumisterie).
Ces valeurs sont des caractéristiques de l'ARTICLE : saisies (ou récupérées par l'aspirateur, document
`2026-11-28-aspirateur-sites-fournisseurs-recettes-communes-design.md`) une fois, imprimées sur chaque devis.

## Ce qu'exige la fiche (texte lu le 2026-11-28 sur ecologie.gouv.fr, version A46.3, abrogée au 1ᵉʳ octobre 2027)

La preuve de réalisation mentionne la mise en place d'un appareil indépendant de chauffage au bois (poêle, foyer
fermé, insert, cuisinière) et : efficacité énergétique saisonnière (Etas), émissions de particules, COG, CO, NOx
**avec leur norme de mesure** — ou, pour les émissions seulement, le label Flamme Verte. À défaut : marque et
référence + document du fabricant. Valeurs en mg/Nm³ à 13 % d'O2.

| | Bûches | Granulés |
|---|---|---|
| Etas ≥ | 66 % | 80 % |
| Particules ≤ | 40 mg/Nm³ | 20 mg/Nm³ |
| COG ≤ | 120 mgC/Nm³ | 60 mgC/Nm³ |
| CO ≤ | 1 500 mg/Nm³ | 300 mg/Nm³ |
| NOx ≤ | 200 mg/Nm³ | 200 mg/Nm³ |

Normes citées : NF EN 13240, 14785, 15250 (poêles), 13229 (foyers, inserts), 12815 (cuisinières). Paliers de
prime à Etas 72 % et 80 %.

## Objectifs

- Sept champs ajoutés au schéma `poele` (`src/shared/specs/poele.schema.js`), dans un groupe « Performances CEE »
  placé EN TÊTE (donc imprimé en premier par `lignesCaracteristiques`, sans autre changement du devis) :
  `etas_pct` (%), `pm_mg_nm3` (particules, mg/Nm³ à 13 % O2), `cog_mgc_nm3`, `co_mg_nm3`, `nox_mg_nm3`,
  `norme_mesure` (enum : EN 13240, EN 14785, EN 15250, EN 13229, EN 12815, EN 16510-1, autre),
  `flamme_verte` (booléen).
- Sortie des fumées : le diamètre existe (`flue_outlet_diameter_mm`) ; ajouter `flue_outlet_position`
  (enum : dessus, arrière, dessus ou arrière, latérale), dans le groupe Raccordements, imprimée avec le diamètre.
- Repère sur la fiche article (pas sur le devis) : « Conforme CEE » / « Hors seuil : particules 45 > 40 » /
  « Incomplet pour le CEE : Etas, NOx » — règle pure `src/lib/cee/barTh112.js` (seuils ci-dessus, testée), qui
  rend `inconnu` si le combustible n'est pas connu. **Jamais bloquant** : le devis s'enregistre et s'envoie.
- Les alias de ces champs complètent `aliases` (ETAS, ηs, rendement saisonnier, COG / OGC, NOx, Flamme verte…)
  pour que l'enrichissement web et l'aspirateur les rangent au bon endroit.

## Non-objectifs

- Pas de calcul de prime CEE ni d'attestation sur l'honneur.
- Pas de conversion automatique des anciens champs : `co_emission_pct` (CO en %) et `dust_emission_mg_m3`
  (référence d'O2 inconnue) restent tels quels et ne sont pas lus par la règle CEE. Une valeur mal convertie sur
  une facture CEE serait pire qu'une valeur absente.
- Pas de nouveau schéma pour inserts / foyers : ils sont dans la catégorie `poele` aujourd'hui.

## Point ouvert (à Eric, sans bloquer la livraison)

La fiche ne cite pas EN 16510-1, qui remplace les anciennes normes (Deville n'affiche plus que celle-là). Le
repère CEE l'accepte comme norme de mesure et l'écrit (« norme EN 16510-1 : à faire accepter par l'obligé ») ;
à confirmer auprès de l'obligé.

## Approches

1. **Champs dans le schéma existant, imprimés par le mécanisme actuel** (retenue) : zéro changement du PDF, de
   Pennylane ou de `figerCaracteristiques` ; les lignes de devis déjà enregistrées gardent leurs caractéristiques
   figées.
2. Un bloc « Performances CEE » séparé dans le modèle de document : plus visible, mais une zone de plus dans
   `devisDocumentModel` + PDF + aperçu, pour un gain faible. Écartée.

## Laissé au constructeur

Libellés exacts des champs, ordre dans le groupe, emplacement du repère dans le tiroir de l'article.
