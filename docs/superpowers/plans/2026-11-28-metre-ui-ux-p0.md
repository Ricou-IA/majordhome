# Métré assisté — correctifs UI/UX P0 (recette Grok du 2026-11-28)

> Exécution : en natif dans la session (préférence d'Eric : pas d'agents en série). Cases `- [ ]` à cocher au fil de l'eau.

**Objectif :** rendre le métré fiable à la saisie et honnête avant d'écrire dans le devis : décimales justes, une erreur par champ, brouillon maîtrisé, récapitulatif avant « Ajouter au devis », minimum de sortie expliqué.

**Architecture :** règles pures dans `src/lib/fumisterie/` (testées par `node --test`), écrans dans `src/apps/artisan/components/devis/metre/`. Aucune formule du moteur n'est modifiée, aucune migration, aucune nouvelle bibliothèque.

**Source :** `C:\Users\epude\Downloads\brief-claude-code-metre-ui-ux-et-correctifs.md` (§ 5 P0, § 6 C-01/C-02/C-05/C-06/C-07/C-10), et `analyse-code-metre.md` à côté. Le dossier de captures `majordhome-metre-recette-2026-11-28/` n'est pas sur ce poste : les constats ont été vérifiés dans le code, pas sur les images.

## Contraintes globales

- DA « atelier chaleureux » : cuivre `primary-600` pour une action seulement ; statut = `StatusPill` + `toneFor` ; boîte `src/components/ui/` (`Button`, `ConfirmDialog`, `InfoTip`, `StatusPill`, `LignesSquelette`) ; aucun texte sous 12 px ; aucune couleur codée en dur.
- `node --test scripts/fumisterie/*.test.mjs` vert (142 aujourd'hui, + les nouveaux) ; `npm run build`, `npm run lint:errors`, `npm run audit:quality` verts ; `scripts/audit-ui.mjs` ne monte pas. Tout nouveau test s'ajoute à la liste de `audit:quality` (`package.json`).
- Messages courts, à l'impératif ; pas de fenêtre intermédiaire quand le geste est évident.
- Pas de donnée client dans les tests ni les commits. Rien poussé sans le oui d'Eric. Un commit par lot, seulement les fichiers du lot.

## Écarts entre le brief et le code de `main` (à savoir avant de coder)

| Point du brief | Code réel | Conséquence |
|---|---|---|
| Rédigé sur `a932cba6` | Depuis, un seul commit (aspirateur) ; le métré est inchangé | Les numéros de ligne cités sont justes |
| `analyse-code-metre.md` : « saveMetre ne fait qu'un INSERT », « brouillon effacé à l'injection », « clé sans-lead » | Corrigés par `1be9b037` (UPDATE du métré du devis, brouillon effacé après `saveMetre`, plus de clé commune) | Ces trois P0 de l'analyse sont déjà faits |
| U-02 : « exposer minReglementaire, minSaisie, surlongueurInterieure dans g1.js / g3.js » | `geometrie` porte déjà `minSortie`, `hAct`, `troncons.conduit_interieur.composition.surlongueur` (G1) et `troncons.sortie_toit.composition.total` ; `sortieMinimale()` donne la valeur appliquée | **Aucune modification de `g1.js` / `g3.js`** : un helper pur lit ces valeurs |
| U-05 § 4 : colonne `note_interne` / `a_chiffrer` sur `quote_lines` | `quote_lines` n'a aucune note de ligne ; « à chiffrer » se dérive déjà de `line_type = 'product'` et prix 0 (`DevisModal.jsx` L77, L396) | **Pas de migration** : l'état « à chiffrer » reste dérivé du prix |
| U-05 § 5 : garde-fou à l'envoi | `DevisModal.jsx` L491 bloque déjà l'envoi Pennylane et nomme les lignes à 0 € | Rien à ajouter côté Pennylane ; reste le PDF Majord'home (voir lot 4) |
| E7/U-04 : bannière « CFG-27 » | Confirmé (`MetreFumisterie.jsx` L127-135) | — |
| C-01 TVA (code P0, hors de la liste d'Eric) | Confirmé : `versLignesDevis` pose `l.tva` (20 % par défaut) et la TVA du devis suit le taux majoritaire des lignes | Petit correctif rangé dans le lot 4, même fichier |

## Points à surveiller (non couverts par les tests existants)

1. Saisie « 1, » en cours : le champ garde le texte, le relevé ne reçoit rien tant que ce n'est pas un nombre, et le brouillon ne s'écrit pas une valeur fausse.
2. Valeur hors plage puis corrigée : le message disparaît et « Continuer » se rouvre sans recharger.
3. Brouillon d'un ancien format (sans `version`, sans `modifies`) : il se reprend toujours, sans planter.
4. Un devis à 5,5 % qui reçoit un métré : TVA du devis inchangée.
5. Fermer pendant la fenêtre de confirmation des alertes : une seule fenêtre à la fois (Radix), Échap ne ferme que celle du dessus.

---

## Lot 1 — U-01 Saisie décimale (+ C-06)

**Fichiers :**
- Créer : `src/lib/fumisterie/saisie.js`, `scripts/fumisterie/saisie.test.mjs`, `src/apps/artisan/components/devis/metre/ChampMesure.jsx`
- Modifier : `metre/ReleveForm.jsx` (L32), `metre/ComplementsForm.jsx` (L86), `package.json` (`audit:quality`)

**Interfaces produites :**
- `parseNombre(texte: string): { valeur: number|null, etat: 'vide'|'en_cours'|'ok'|'invalide' }` — accepte `,` et `.`, espaces ordinaires et insécables entre groupes de trois chiffres (« 1 050 »), signe `-` / `−` ; « 1, » ou « 1. » = `en_cours` ; tout autre caractère = `invalide`.
- `formaterSaisie(n: number|null): string` — virgule décimale, sans séparateur de milliers ni zéro inutile (`1.05` → « 1,05 », `2` → « 2 »).
- `<ChampMesure id cle valeur unite pas min max onChange(n|'' ) erreurId? invalide? />` — `type="text" inputMode="decimal" enterKeyHint="next" autoComplete="off"`, état local texte, `onChange` reçoit le nombre (ou `''` si vidé) à chaque saisie `ok`, rien en `en_cours`/`invalide` ; au `blur` le texte est reformaté depuis la valeur. Classe `inputClass` de `FormFields.jsx`, unité en suffixe, `aria-invalid` / `aria-describedby` quand le lot 2 les passe.

- [ ] **Test** `saisie.test.mjs` : `parseNombre('1,05').valeur === 1.05` ; `'1.05'` → 1.05 ; `'1,5'` → 1.5 (jamais 15) ; `'1 050'` et `'1\u00a0050'` → 1050 ; `'1 05'` → `invalide` ; `'1,'` → `en_cours`, valeur null ; `''` → `vide` ; `'abc'` → `invalide` ; `'−0,5'` → -0.5 ; `'1,2,3'` → `invalide` ; `formaterSaisie(1.05) === '1,05'` ; `formaterSaisie(null) === ''`.
- [ ] Lancer `node --test scripts/fumisterie/saisie.test.mjs` → échec (module absent).
- [ ] Écrire `saisie.js`, puis relancer → vert.
- [ ] `ChampMesure.jsx` ; remplacer les deux `<input type="number">` (relevé et compléments). Le texte reste resynchronisé quand la valeur change de l'extérieur (bouton « Ajuster », brouillon) sans écraser une saisie en cours.
- [ ] `rg "Number\(e.target.value\)" src/apps/artisan/components/devis/metre` → 0.
- [ ] Build + tests fumisterie + lint ; commit `fix(metre): saisie décimale à la virgule, quelle que soit la langue du navigateur`.

## Lot 2 — U-03 Une erreur par champ (+ C-07, C-10 n°5-6)

**Fichiers :**
- Modifier : `src/lib/fumisterie/index.js` (`validerReleve`), `scripts/fumisterie/releve.test.mjs`, `metre/ReleveForm.jsx`, `metre/ComplementsForm.jsx` (passage des props), `metre/MetreFumisterie.jsx`, `metre/ReleveStep.jsx`, `metre/ComparaisonFabricants.jsx`, `src/apps/artisan/components/FormFields.jsx` (erreur en `text-st-alerte` au lieu de `red-*`, en-tête de fichier)
- Créer : `src/lib/fumisterie/messagesReleve.js` (texte des erreurs, pur)

**Interfaces :**
- `validerReleve` rend en plus `erreursChamps: Array<{ cle, libelle, code: 'vide'|'hors_plage'|'choix', min?, max?, valeur?, unite? }>` ; `erreurs: string[]` et le `throw` de `calculerMetre` inchangés (tests existants).
- `messageChamp(e): string` — « Hauteur de buse : à renseigner. » / « Hauteur de buse : entre 0,3 et 2 m. Vous avez saisi 105 m. » / « Diamètre : choisissez une valeur. »
- `MetreFumisterie` calcule `validerReleve(bundle.gabarit, releve)` (déjà importable) et passe `erreursParCle` à `ReleveForm`.

- [ ] **Test** `releve.test.mjs` : relevé avec `hBuse = 105` → `erreursChamps` contient `{ cle: 'hBuse', code: 'hors_plage', min: 0.3, max: 2, valeur: 105 }` ; champ vidé → `code: 'vide'` ; option absente du tronçon `options` → aucune entrée ; `messageChamp` rend les trois phrases ci-dessus (virgule décimale).
- [ ] Rouge, puis implémentation, puis vert.
- [ ] Sous chaque champ fautif : le message (`id="fum-<cle>-erreur"`), `aria-invalid="true"`, `aria-describedby`.
- [ ] En haut du relevé, **un seul** bandeau `role="alert"` : « 2 champs à corriger » + un lien par champ (clic = `focusChamp(cle)`). Supprimer pour ce cas le `Blocage` « Métré non calculable », la ligne `moteur` des contrôles (`resultatEnErreur` ne pose plus d'alerte `moteur` ; l'erreur reste dans `resultat.erreur`) et « Calcul impossible : … » des cartes fabricant (remplacé par « Relevé à corriger »).
- [ ] Bouton du pied désactivé avec la raison en `title` (« Corrigez 2 champs ») ; retirer la branche inatteignable de `valider()`.
- [ ] Erreur de chargement : « Le catalogue n'a pas pu être chargé. Vérifiez la connexion puis réessayez. » + `Button` « Réessayer » (`refetch` des requêtes) ; détail dans `logger.error`. Chargement : `LignesSquelette libelle="Chargement des configurations"` à la place du spinner (E10, même fichier).
- [ ] `rg -n "moteur" src/apps/artisan/components/devis/metre/*.jsx` → plus aucun texte affiché.
- [ ] Build + tests + lint ; commit `fix(metre): une erreur par champ, sous le champ, au lieu de trois messages identiques`.

## Lot 3 — U-04 Brouillon (+ C-05, C-10 n°1-2)

**Fichiers :**
- Créer : `src/lib/fumisterie/brouillon.js`, `scripts/fumisterie/metre-brouillon.test.mjs`
- Modifier : `metre/useMetreDraft.js`, `metre/MetreFumisterie.jsx`, `CreateDevisModal.jsx` (L76), `package.json`

**Interfaces (pur, `brouillon.js`) :**
- `brouillonValide(d, maintenant = Date.now()): boolean` — faux si absent, sans `releve`, ou `savedAt` de plus de 30 jours ; un brouillon sans `version` (ancien format) reste valide.
- `nouveauBrouillon({ etape, criteres, configurationId, configLibelle, releve, modifies }, maintenant): object` — `{ version: 1, savedAt, … }`.
- `ajouterModifie(modifies: string[], cle): string[]` (sans doublon).
- `resumeBrouillon(d): string` — « Conduit isolé PTR30 neuf, à travers la maison · Ø150 » ; jamais un code `CFG-…` (lit `configLibelle`, sinon « Relevé en cours »).
- `contradictionFamille(d, famille, criteresFamille): string|null` — « Ce relevé est prévu pour le bois, le devis est en granulés. »

**Règles d'écran :**
- Le brouillon ne s'écrit **qu'après une première saisie** (`modifies` non vide) : cliquer une carte n'écrit rien. Revenir en arrière (« Changer de solution ») met à jour `etape`.
- À l'ouverture avec un brouillon valide : `ConfirmDialog` « Reprendre le relevé du 28 nov. à 12:46 ? », description `resumeBrouillon` (+ contradiction le cas échéant), « Reprendre » / « Recommencer ». Plus de bannière permanente.
- Fermer (croix, Échap) avec une saisie non ajoutée : `ConfirmDialog` « Garder en brouillon » / « Supprimer le brouillon » (danger) / « Continuer le relevé ». `ConfirmDialog` n'a que deux boutons : la 3ᵉ issue (« Continuer ») = fermer la fenêtre de confirmation (Annuler/Échap). Sans saisie : fermeture directe, sans toast.
- « Supprimer le brouillon » aussi dans un `MenuActions` « … » de l'en-tête.
- Clé du dossier (`CreateDevisModal` L76) : `devis-<id>` en premier quand on modifie un devis, puis lead, puis carte SAV.

- [ ] **Test** `metre-brouillon.test.mjs` : 31 jours ⇒ invalide, 29 ⇒ valide ; ancien format sans `version` ⇒ valide ; `resumeBrouillon` ne contient jamais `CFG-` ; `contradictionFamille` pellets ↔ « Poêle à Bois » rend la phrase, familles concordantes ⇒ `null` ; `ajouterModifie(['a'], 'a')` = `['a']`.
- [ ] Rouge → implémentation → vert.
- [ ] Écran comme ci-dessus ; « Supprimer » vide la clé `localStorage` et le brouillon ne revient pas à la réouverture.
- [ ] Build + tests + lint ; commit `fix(metre): brouillon écrit après une saisie, reprise demandée, fermeture confirmée`.

## Lot 4 — U-05 « Ajouter au devis » + récapitulatif (+ C-01, C-02)

**Fichiers :**
- Créer : `metre/RecapMetre.jsx`
- Modifier : `metre/metreModel.js` (`versLignesDevis`), `scripts/fumisterie/metre-reinjection.test.mjs`, `metre/MetreFumisterie.jsx`, `metre/ComparaisonFabricants.jsx` (« Injecté » → « Sélectionné »), `DevisStepLines.jsx` (L237-248 : passe `tvaDevis`), `DevisLineRow.jsx` (pastille), `DevisModal.jsx` (téléchargement du PDF)

**Interfaces :**
- `versLignesDevis(lignes, supplierId, supplierName, tvaDevis = null)` — `tva_rate = tvaDevis ?? l.tva` ; `description = l.sous_libelle || ''` (plus jamais « À CHIFFRER » ni « quantité provisoire »). L'état « à chiffrer » reste dérivé du prix 0 (pas de colonne).
- `MetreFumisterie` reçoit `tvaDevis` (prop) pour l'afficher au récapitulatif.

**Parcours :** le pied a deux étapes au relevé : « Continuer » ouvre le **récapitulatif** (étape 2 de l'état existant, aucune écriture) ; seul le récapitulatif porte « Ajouter au devis » (bouton primaire unique, à droite). `RecapMetre` : solution, Ø, fabricant, N pièces, total HT vente, « TVA du devis : 5,5 % », liste des pièces sans prix, liste des quantités à valider (`statut === 'provisoire'`), alertes restantes. Pièces sans prix ⇒ « Ajouter au devis » ouvre `ConfirmDialog` « 2 pièces seront ajoutées à 0 € : … » / « Ajouter quand même » / « Revenir ». Les alertes `warn` passent dans la même confirmation (une seule fenêtre, pas deux à la suite).

- [ ] **Test** `metre-reinjection.test.mjs` : une ligne sans `article_id` ⇒ prix 0 et `description` sans « CHIFFRER » ; ligne `provisoire` ⇒ `description` sans « provisoire » ; `versLignesDevis(l, s, n, 5.5)` ⇒ toutes les lignes à 5,5 ; sans taux ⇒ `l.tva`.
- [ ] Rouge → implémentation → vert.
- [ ] `DevisLineRow` : `StatusPill tone="attente"` « À chiffrer » sur une ligne produit à 0 € (`toneFor` si le domaine existe, sinon ton `attente` direct comme la DA le prévoit).
- [ ] `DevisModal` : « Télécharger le PDF » avec une ligne produit à 0 € ⇒ `ConfirmDialog` « Une ligne n'est pas chiffrée. Télécharger quand même ? » (l'envoi Pennylane est déjà bloqué, L491).
- [ ] Renommer à l'écran « Injecter dans le devis » → « Ajouter au devis », « Injecté » → « Sélectionné » ; `rg "Inject" src/apps/artisan/components/devis/metre/*.jsx` → rien d'affiché.
- [ ] Build + tests + lint ; commit `feat(metre): récapitulatif avant « Ajouter au devis », TVA du devis suivie, rien d'interne sur le PDF client`.

## Lot 5 — U-02 « Ajuster » expliqué

**Fichiers :**
- Créer : `src/lib/fumisterie/explicationSortie.js`, test dans `scripts/fumisterie/g1.test.mjs` (et `g3-g5-g6.test.mjs`)
- Modifier : `metre/ReleveForm.jsx` (L38-42), `metre/ReleveStep.jsx`, `metre/CoupeCotee.jsx` (info-bulle de la cote de sortie réelle)

**Interface :** `explicationSortie(gabaritCode, geometrie, valeurAppliquee, hSortieSaisie): { minReglementaire, dejaCouvert, aViser, hauteurReelle, elementsStandard } | null` — lecture seule : `minReglementaire = geometrie.minSortie`, `dejaCouvert = surlongueur intérieure / 1000` (G1 ; 0 en G3), `aViser = valeurAppliquee` (rendu par `sortieMinimale`, inchangé), `hauteurReelle = geometrie.hAct`, `elementsStandard = sortie_toit.composition.total / 1000 − hSortieSaisie`. `null` pour un gabarit sans sortie de toit.

- [ ] **Test** sur le relevé de la maquette G1 (`g1.test.mjs`) : `minReglementaire ≈ 1,52`, `dejaCouvert ≈ 0,193`, `aViser = sortieMinimale(...)`, `aViser ≥ minReglementaire − dejaCouvert`, `hauteurReelle ≈ 1,943` ; G4 ⇒ `null`.
- [ ] Rouge → implémentation → vert.
- [ ] Sous le bouton : « À viser : 1,35 m (hauteur réglementaire 1,52 m − 0,19 m déjà couverts par le conduit intérieur). » ; bouton « Mettre à 1,35 m » (valeur dynamique, `Button variant="secondary"`). En G3 la phrase sans la soustraction. `InfoTip` sur la cote de hauteur réelle : « Hauteur réelle : 1,60 m saisis + 0,15 m d'éléments standard + 0,19 m de conduit intérieur. » Formats par `formaterSaisie` (lot 1).
- [ ] Build + tests + lint ; commit `fix(metre): le minimum de sortie dit d'où vient la valeur appliquée`.

## Clôture

- [ ] `node --test scripts/fumisterie/*.test.mjs`, `npm run build`, `npm run lint:errors`, `npm run audit:quality` : verts, `audit-ui` stable ou en baisse.
- [ ] Rapport : fait / reste (P1, P2, C-03 migration d'unicité, captures) / jamais vu à l'écran.

## Hors de ce plan (lots suivants du brief)

P1 : U-06 cotes HTML, U-07 étapes + récap collant, U-08 comparaison, U-09 liste de pièces et marges masquées, U-10, U-11, U-12, U-13 habillage DA, U-14 glossaire, C-08 à C-10 restants. Données : C-03 (index unique `quote_id` + suppression du doublon `DEV-2026-0065`, **sur décision d'Eric**). Décisions d'Eric : taux de TVA des fournitures de fumisterie (C-01 suit le devis, ne choisit pas), règle « Recommandée » (U-15), photos (U-16, migration).
