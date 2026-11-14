# Documents d'un équipement en trois tiroirs (marque · modèle · cet appareil) — conception courte

Date : 2026-11-14. Demande d'Eric pendant la recette du mode atelier.

## Intention

Aujourd'hui, un document déposé sur une carte équipement est rangé par marque + modèle : il apparaît sur tous les
appareils identiques de l'organisation. Eric veut choisir, au dépôt, à qui le document s'applique :

- **Marque** : tous les appareils de cette marque (ex. documentation commune INVICTA, cartes électroniques) ;
- **Modèle** : tous les appareils de ce modèle (comportement actuel) ;
- **Cet appareil** : seulement l'appareil de ce client — « quelque chose de particulier » : une photo de
  l'installation, une façon de le faire fonctionner s'il y a une spécificité (Eric 2026-11-14).

La carte équipement affiche les documents en trois tiroirs.

## Non-objectifs

- La photo de la plaque signalétique garde sa place (`equipments.nameplate_photo_path`), elle n'entre pas dans un tiroir.
- Pas de reprise de données : 0 document déposé à la main en prod au 2026-11-14 (les 972 lignes sont relevées).
- L'import du Drive Interstove est un chantier à part ; il utilisera les tiroirs Marque et Modèle.

## Anti-objectif

Un document propre à un client qui s'affiche sur tout le parc par mégarde.

## Approches (choisie : 1, Eric 2026-11-14 « ok on fait la première »)

1. **Une seule table `majordhome.equipment_documents` avec une portée** (`scope` ∈ `marque` | `modele` | `appareil`,
   `equipment_id` pour `appareil`). Un bouton, un lecteur, une règle de droits, une vue. **Retenue.**
2. Table à part pour les documents d'un appareil : deux dépôts, deux règles de retrait, deux listes à fusionner.
3. Documents de la fiche client : le lien à l'appareil se perd (poêle + PAC mélangés).

## Conception

- **Base** (migration versionnée, répétée sur le harnais) : `equipment_documents.scope text NOT NULL DEFAULT 'modele'`
  CHECK (`marque`, `modele`, `appareil`) ; `equipment_id uuid NULL` → `equipments(id) ON DELETE CASCADE` ; contraintes
  `appareil ⇔ equipment_id IS NOT NULL` et `marque ⇒ model_key IS NULL` ; un document relevé (`equipment_model_id`
  non nul) est toujours `modele`. Un document `appareil` ne pointe que vers un équipement de sa propre org (même garde
  que `tr_equipments_check_model_org`).
- **Vue `majordhome_equipment_model_documents`** : ajoute les branches marque (`brand_key` seul) et appareil
  (`equipment_id = e.id`) ; colonne `scope` ajoutée EN FIN de liste (`CREATE OR REPLACE VIEW`).
- **Clé de modèle inchangée** : `equipment_model_key()` neutralise déjà casse et espaces (« Lp9 » = « LP9 »).
- **Écran — dépôt** : choix en trois positions dans la fenêtre « Déposer », libellés concrets (« Cet appareil (ce
  client seulement) », « Tous les LP9 », « Toute la marque INVICTA »). Un équipement sans marque ni modèle peut
  désormais déposer, en « Cet appareil » seulement.
- **Écran — affichage** : trois tiroirs sur la carte, dans l'ordre Cet appareil · Modèle · Marque, avec leur nombre ;
  les documents du fabricant et la documentation de la ligne fournisseur vont dans Modèle ; un tiroir vide ne
  s'affiche pas. Le mode atelier propose les documents des trois tiroirs. Règles de rangement dans un module pur
  testé (pas dans le composant).

## Mes choix (à vérifier par Eric en relisant)

- **« Cet appareil » présélectionné au dépôt** : l'erreur « trop partagé » est celle qu'on veut éviter ; « trop étroit »
  ne coûte presque rien.
- **Retrait** : un document `appareil` se retire avec `clients.edit` (comme modifier la fiche) ; `marque` / `modele`
  restent `clients.delete` (org_admin), comme aujourd'hui, puisqu'ils touchent tout le parc. Dépôt : `clients.edit`
  pour les trois portées (inchangé).
- Objets Storage d'un document `appareil` rangés sous `product-documents/${org}/equipments/${equipment_id}/…`.
  Aucune policy Storage nouvelle : le bucket est déjà ouvert aux membres de l'org hors dossier `articles` (existant,
  vérifié en prod le 2026-11-14) ; le garde est la ligne (le fichier n'est retiré qu'après un retrait de ligne réussi).
- Équipement supprimé : ses documents `appareil` partent avec lui (cascade), leurs fichiers restent dans le bucket
  (même limite que les autres objets orphelins déjà signalés).
- Changer la portée d'un document déjà déposé : non livré (on retire et on redépose).

## Laissé au constructeur

Nom exact des contraintes, forme du choix (boutons segmentés ou boutons radio), icônes des tiroirs.
