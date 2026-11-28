# Recette — import d'une base d'articles depuis un fichier (novembre 2026)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : `4f08c1e3` (déploiement de production prêt, 2026-11-28).
- **Comptes** : celui d'Eric sur **Cimaj** (administrateur) pour tous les tests d'import ; celui d'Eric sur **Mayer Énergie** pour C208.
- **Légende** : `[x]` validé · `[!]` anomalie · `[-]` non testable ou écarté, avec la raison
- **Règle** : un test à la fois. Un point est coché après le retour d'Eric et la vérification.
- **Numéros** : cette recette commence à C201 pour ne pas croiser ceux des autres recettes de novembre.
- **Fichier d'essai fourni** : `docs/recette-fichiers/import-articles-essai.csv` (articles fictifs, marque « ESSAIMARQUE », 6 lignes). Passé par les règles réelles hors navigateur : **6 lignes lues = 4 importées + 0 doublon + 2 écartées**, 2 lignes fournisseur, 1 fournisseur à créer (« Fournisseur Essai Recette »).

## Déjà fait, vérifié le 2026-11-28

- **Migrations appliquées en production** : `20261129_2_catalog_import`, `20261129_3_catalog_import_retrait`, `20261129_4_rattachement_articles_sans_offre`, inscrites au registre (16:06 UTC, hors des passages de relevé).
- **Vérifié en base après application** : table `majordhome.catalog_imports` et vue `majordhome_catalog_imports` présentes (vue en `security_invoker`, aucun droit pour un visiteur sans compte) ; les cinq fonctions de l'import sont exécutables par un utilisateur connecté et pas par un visiteur ; les fonctions internes sont fermées à tout compte ; contrôle des droits (`permissions-coherence.mjs`) sans erreur.
- **Mesure avant mise en production** (lecture seule) : aucune fusion automatique nouvelle, aucune ligne à rattacher ; articles devenus rattachables : Mayer 41, Cimaj 7 000 (lignes DINAK / Invicta à 0 €).
- **Essai d'import en production sous le compte administrateur de Cimaj, annulé à la fin** : 200 articles dont 100 avec ligne fournisseur et un fournisseur créé, en 1,7 s. Après l'essai : aucun article, aucun fournisseur, aucun import ne reste.
- **Mise en ligne** : déploiement de production prêt pour `4f08c1e3` ; `https://majordhome.vercel.app/settings/suppliers/articles/import` répond 200.
- **Dépôt** : 2 397 tests, lint, contrôle du code mort et compilation au vert.
- **État de Cimaj avant la recette** : 10 274 articles vivants, 4 fournisseurs, aucun article ni fournisseur « essai recette ».
- **Non vérifiable par un agent** : tout ce qui demande une session connectée, donc chaque écran de la page d'import. Personne ne l'a encore vue. Rien n'est présumé validé.

## Tests

### Compte Cimaj

- [x] **C201. Le bouton « Importer » et la page.** 2026-11-28 — retour d'Eric : « tout est ok », recette passée par Grok dans son navigateur. Affichage seul.
  Où : Paramètres → Fournisseurs & catalogue → Articles, en haut à droite.
  Saisir : cliquer « Importer ».
  Attendu : une page d'import en étapes (fichier, colonnes, aperçu, résultat) avec une zone de dépôt et « Télécharger le fichier type ». Le bouton n'apparaît qu'à un administrateur.
  Vérification : rien (affichage seul).

- [x] **C202. Le fichier type.** 2026-11-28 — retour d'Eric : « tout est ok » (Grok). Affichage seul.
  Où : page d'import.
  Saisir : « Télécharger le fichier type », l'ouvrir dans le tableur.
  Attendu : une feuille « Articles » avec l'en-tête (18 colonnes) et une ligne d'exemple, une feuille « Aide » qui explique chaque colonne. Aucun nom d'entreprise.
  Vérification : rien (affichage seul).

- [x] **C203. Aperçu du fichier d'essai.** 2026-11-28 — retour d'Eric : « tout est ok » (Grok). Vérifié en base : le bilan enregistré par l'import vaut 6 lues, 0 doublon, 2 écartées, 2 lignes fournisseur.
  Où : page d'import.
  Saisir : déposer `docs/recette-fichiers/import-articles-essai.csv`, garder les colonnes proposées, passer à l'aperçu.
  Attendu : toutes les colonnes reconnues ; bilan **6 lignes lues = 4 à importer + 0 doublon + 2 écartées** (ligne sans désignation, ligne « Ouvrage ») ; **2 lignes fournisseur** ; « Fournisseur Essai Recette » proposé à créer, coché ; natures lues « Fourniture → Équipement », « MO → Main d'œuvre », « Ouvrage → Ne pas importer » ; unités « U → pièce », « ML → ml », « H → h », « Forfait → forfait » ; une mention des prix d'achat sans date (1).
  Vérification : rien tant que l'import n'est pas lancé.

- [x] **C204. Import du fichier d'essai.** 2026-11-28 — retour d'Eric : « tout est ok » (Grok). Vérifié en base : import `86bc6a3f` du fichier `import-articles-essai.csv` (Cimaj, 17:09 UTC) clos avec 4 importés et 2 lignes fournisseur ; « Fournisseur Essai Recette » créé à la même seconde. _Non relu_ : prix, TVA, nature et dates des 4 articles, retirés en C207 avant ma vérification.
  Où : aperçu de C203.
  Saisir : « Importer ».
  Attendu : résultat « 4 articles importés », 2 lignes fournisseur, téléchargement possible des 2 lignes écartées avec leur raison ; l'import apparaît dans « Imports précédents ».
  Vérification : en base, 4 articles Cimaj `RECETTE-001/004/005/006` en `origin = 'manuel'` avec `import_id` ; `RECETTE-001` à 1 234,50 € HT ; `RECETTE-006` TVA 5,5 et nature main d'œuvre ; fournisseur « Fournisseur Essai Recette » créé ; 2 lignes fournisseur (`FER-1001` à 845 € daté du 15/10/2026, `FER-1004` à 27,50 € sans date) rattachées à leur article, source `import`.

- [x] **C205. Fiche d'un article importé.** 2026-11-28 — retour d'Eric : « tout est ok » (Grok). Affichage seul.
  Où : Articles → « Poêle à granulés essai recette 8 kW », puis « Tubage inox essai recette Ø80 ».
  Saisir : ouvrir les deux fiches.
  Attendu : l'offre du fournisseur d'essai apparaît, avec la source « import » ; le prix d'achat du tubage est en « date inconnue ».
  Vérification : rien (affichage seul) — le prix et la date sont vérifiés en C204.

- [x] **C206. Réimporter le même fichier.** 2026-11-28 — retour d'Eric : « tout est ok » (Grok). Vérifié en base : un seul import existe, aucun second import n'a été lancé.
  Où : page d'import.
  Saisir : redéposer le même fichier jusqu'à l'aperçu, sans importer.
  Attendu : les 4 articles sont des doublons forts, écartés par défaut ; « RECETTE-00x » non recochable (référence déjà prise) ; aucun fournisseur à créer ; 0 à importer.
  Vérification : aucun article nouveau en base si l'import n'est pas lancé.

- [x] **C207. Retirer l'import.** 2026-11-28 — retour d'Eric : « tout est ok » (Grok). Vérifié en base : import passé à `retire` à 17:25 UTC avec 4 retirés et 0 conservé ; aucun article `RECETTE-%` ni `ESSAIMARQUE`, aucune ligne `FER-%`, aucun article portant un `import_id` ; Cimaj revenu à 10 274 articles vivants ; « Fournisseur Essai Recette » toujours présent, comme prévu, puis supprimé à la main sur l'accord d'Eric le 2026-11-28 (aucune ligne rattachée ; Cimaj revenu à 4 fournisseurs).
  Où : page d'import → Imports précédents → l'import du fichier d'essai.
  Saisir : « Retirer cet import », lire le texte, saisir le nom du fichier pour confirmer.
  Attendu : 4 articles retirés, 0 conservé ; l'import passe à « Retiré ».
  Vérification : en base, plus aucun article `RECETTE-%` ni ligne fournisseur `FER-%` ; le fournisseur « Fournisseur Essai Recette » existe toujours (jamais supprimé par un retrait) — à supprimer à la main ensuite si Eric le souhaite.

### Compte Mayer (non-régression)

- [x] **C208. Le catalogue et le devis marchent toujours chez Mayer.** 2026-11-28 — retour d'Eric : « tout est ok » (Grok). Affichage seul.
  Où : compte Mayer → Articles, puis un devis → « + » d'un chapitre.
  Saisir : chercher un article connu ; dans le devis, ajouter un article depuis le sélecteur, sans enregistrer.
  Attendu : recherche et sélecteur comme d'habitude ; le bouton « Importer » est visible (Eric est administrateur de Mayer).
  Vérification : rien (affichage seul).

## Anomalies

_(aucune pour l'instant)_

## Retest des corrections

_(aucun pour l'instant)_
