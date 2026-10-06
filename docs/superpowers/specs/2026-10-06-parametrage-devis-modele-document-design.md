# Paramétrage des devis — familles, squelettes, modèle de document avec aperçu cliquable

**Date** : 2026-10-06 · **Statut** : validé par Eric (chat), implémentation lancée le jour même.
**Référence d'usage** : l'éditeur « Modification du modèle » de Pennylane : réglages à gauche en accordéons, le document
rendu à droite, un clic sur une zone du document surligne le réglage correspondant.

## 1. Objectif

Chaque entreprise configure ses devis sans toucher au code : les familles d'installation proposées, le squelette
(titres de chapitre) de chaque famille, et toutes les mentions du document (titre, introduction, acompte, conditions,
mention spéciale, paiement, pied de page, signature) ainsi que les options d'affichage. Les valeurs d'aujourd'hui,
codées en dur, deviennent les défauts : Mayer ne voit aucun changement tant qu'il n'édite rien.

## 2. Données : `settings.devis` (JSONB, merge niveau 1 ⇒ sauver l'objet COMPLET)

```
devis: {
  familles: [{ key, label, actif, categorie, sections: ['POÊLE', …] }],   // ordre = ordre d'affichage
  document: { titre, intro, acompte, conditions, mention_speciale, validite_jours, pied_de_page, signature },
  paiement: { afficher, etablissement, texte },     // IBAN / BIC lus dans settings.invoicing (Facturation)
  affichage: { logo, references, prix_unitaires, tva_par_ligne, detail_lignes },
}
```
- `key` d'une famille = identifiant immuable (slug) ; `label` modifiable. Les devis et devis types existants portent
  le label (`quotes.family`, `quote_templates.family`) : la résolution se fait par key OU label.
- `categorie` = catégorie produit du picker (`poele` / `climatisation` / `chauffage` / `fumisterie` / null = tous).
- Défauts et validation : module PUR `src/lib/devisConfig.js` (`DEFAULTS_DEVIS`, `buildDevisConfig(settings)`,
  `famillesActives`, `familleDe`, `sectionsParDefaut`, `categoriePourSection`).
- Pas de migration : rien hors des settings de l'org.

## 3. Une seule source de vérité du document

`src/lib/devisDocumentModel.js` (PUR, testé) : `buildDevisDocumentModel({ quote, lines, totals, company, config, invoicing })`
renvoie toutes les ZONES du document, formatées PDF-safe (espaces ordinaires, virgule décimale) :
en-tête, émetteur, client, objet, intro, acompte, tableau (colonnes visibles, chapitres, lignes ou sous-totaux),
totaux, validité, conditions, mention spéciale, paiement, signature, pied de page. Chaque zone porte son `id`.
- `DevisPDF.jsx` (react-pdf) et l'aperçu HTML de la page de réglages consomment ce modèle sans rien calculer ni
  formater : ce que montre l'aperçu est ce que le PDF imprime.
- `exempleDevis(config)` fournit un devis fictif pour l'aperçu (sections de la première famille active, lignes
  d'exemple) ; les totaux sont calculés par `computeQuoteTotals` du service, pas par le modèle.

## 4. Consommateurs branchés

- `CreateDevisModal` / `DevisEntete` : familles actives depuis la config ; `buildDefaultSections(famille, config)`.
- `DevisStepLines` : catégorie du picker = `categoriePourSection(config, section, famille)`.
- `DevisConditions` : conditions et validité par défaut depuis la config (plus de texte en dur).
- `DevisModal` → `generateDevisPdfBlob(model)` avec le modèle construit depuis la config de l'org.

## 5. Écran `/settings/devis` (tuile « Devis » du socle, org_admin)

Deux colonnes. Gauche : accordéons « Familles et chapitres », « Émetteur » (lecture, lien Organisation),
« Contenu », « Paiement », « Affichage », bouton « Enregistrer le modèle » (objet complet) et « PDF d'exemple ».
Droite : `ApercuDevis` rend le modèle sur le devis d'exemple ; chaque zone est cliquable → l'accordéon s'ouvre, le
champ est surligné 1,5 s et reçoit le focus ; le focus d'un champ encadre la zone dans l'aperçu. Correspondance
zone ↔ champ dans un seul tableau (`ZONES`), partagé par le panneau et l'aperçu.

## 6. Hors périmètre

Gestion des devis types enregistrés (ils se créent toujours depuis un devis), numérotation (générée en base),
mise en page libre (positions, polices). Les zones sont celles du gabarit, dans l'ordre du gabarit.
