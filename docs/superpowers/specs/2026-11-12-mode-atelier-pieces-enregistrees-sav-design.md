# Mode atelier — lire le document en face de la liste des pièces, pièces enregistrées sur la fiche SAV

> Conception du 2026-11-12, issue de la recette d'Eric sur la visionneuse de documents (fiche client CLI-03753,
> poêle INVICTA BALHAM). Maquette retenue : option B (`.superpowers/brainstorm/…/visionneuse-dans-la-carte.html`).
> Ce qui vient d'Eric est marqué **(Eric)** ; mes choix sont marqués **(mon choix)**.

## 1. Intention

Aujourd'hui un document d'appareil (notice, fiche technique, procédure) et la vue éclatée s'ouvrent en plein écran sur
un fond sombre qui recouvre toute la page (`EquipmentDocumentViewer`, `ExplodedViewViewer`). Eric le vit comme « une
nouvelle fenêtre » : **il veut une visionneuse dans le logiciel (Eric)**, et **pouvoir lire le document de front avec
la liste des pièces (Eric)**.

Deux usages **(Eric)** : la **tablette** côté technicien, devant l'appareil, pour **identifier** la pièce ; le **PC**
au bureau pour **commander et clôturer le SAV**. D'où la seconde demande : **les pièces cochées doivent rester
enregistrées sur la fiche SAV (Eric)** — aujourd'hui les quantités cochées vivent dans l'état React et disparaissent à
la fermeture, le bureau ne voit rien de ce que le technicien a identifié.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Un « mode atelier » : le bloc « Pièces détachées » s'ouvre en grand DANS la page, document à gauche, liste à droite.
- Un lecteur PDF qui marche sur PC ET sur la tablette Android (le lecteur intégré du navigateur, utilisé aujourd'hui
  dans une `iframe`, n'affiche souvent rien sur Chrome Android).
- Une liste de pièces identifiées enregistrée sur la demande SAV, visible au bureau, point de départ du devis.

**Non-objectifs**
- Commander chez le fournisseur depuis l'outil (le statut « à commander / commandé / reçu » existant reste tel quel).
- Ajouter des pièces à un devis existant (toujours un nouveau devis, comme aujourd'hui).
- Les autres marques de pièces détachées, les caractéristiques pour le devis (chantiers distincts).

**Anti-objectifs (échec même si « ça marche »)**
- Un document qui recouvre la page (fond sombre plein écran) : c'est exactement ce qu'Eric refuse.
- Une notice qui ne s'affiche pas sur la tablette, ou qui part dans un autre onglet sans qu'on l'ait demandé.
- Une pièce cochée perdue en silence : écriture refusée = message à l'écran et case remise dans son état réel.
- Une sélection enregistrée qui se vide toute seule après un relevé Invicta (la nomenclature est remplacée en bloc à
  chaque relevé, ses ids changent — cf. § 4).
- Le technicien qui gagne d'autres gestes que « cocher des pièces » sur une demande SAV.

## 3. Le mode atelier (maquette B, Eric)

**Où** : partout où vit le bloc « Pièces détachées » (`EquipmentPartsSection`) — carte équipement de la fiche client
(`EquipmentList`) et fiche SAV (`SAVModelPartsSection` dans `EntretienSAVModal`).

**Comportement**
- Le bloc reste replié / compact comme aujourd'hui. Un bouton **« Lire avec la liste »** l'ouvre en mode atelier :
  le bloc prend la largeur disponible, **sans fond sombre, sans recouvrir la page** ; le reste de la fiche reste
  au-dessus et en dessous. **« Réduire »** revient à l'affichage normal.
- **À gauche, le document** ; **à droite, la liste** des pièces avec sa recherche (repère, référence ou mot) et ses
  + / − ; **une poignée au milieu** règle la part de chacun (Eric, maquette B). Proportion de départ ≈ 60 / 40
  (mon choix).
- **Onglets au-dessus du document** : Vue éclatée (une par vue s'il y en a plusieurs, ou précédente / suivante),
  Notice, Fiche technique, Procédures (N) — seuls les onglets qui ont un document s'affichent. Les documents sont
  ceux du modèle (`majordhome_equipment_model_files` / documents rangés par `rangerDocumentsModele`) et les vues de
  `useEquipmentModelImages`.
- La hauteur de la zone document suit la hauteur de l'écran (≈ hauteur visible moins l'en-tête, mon choix) ; la liste
  défile seule à côté, le document reste en place.
- **Fiche SAV** : la fiche est une fenêtre `max-w-4xl` (`EntretienSAVModal`) — trop étroite pour deux colonnes.
  En mode atelier, la fenêtre s'élargit à la largeur de l'écran (moins une marge), comme `EventModal` s'élargit
  quand le parcours apparaît ; elle reprend sa taille à « Réduire » (mon choix).
- **Téléphone** (`useDeviceClass().isPhone`) : document au-dessus, liste en dessous, pas de poignée (mon choix). La
  tablette est servie en 1 024 px forcés (`deviceViewport.js`) : le côte à côte y tient.
- **Fiche sans liste de pièces** (fiche web ou depuis un article, `listePiecesDisponible` faux) : le mode atelier
  montre le document seul, s'il y en a un ; les liens « Site du fabricant » restent tels quels (mon choix).
- **Vue éclatée tirée d'une notice** (`origine = 'notice'`, avec `page`) : l'avertissement actuel (« ses repères sont
  ceux de la notice ») reste affiché au-dessus du document (règle existante, ne pas la perdre).

**Le plein écran sombre disparaît partout (mon choix, proposé à Eric sans objection)** :
- rubrique « Documents » de la carte équipement (`EquipmentDocumentsSection`) : un clic sur un document ouvre le mode
  atelier du même équipement sur l'onglet de ce document ;
- fiche d'intervention (`EquipmentModelDocuments` dans `InterventionDetail`) et fiche « Appareil à contrôler » du
  tableau de bord (`AppareilAControlerFiche`) : pas de liste de pièces, le document s'ouvre dans la page, sous sa
  ligne, avec le même lecteur (document seul) ;
- `EquipmentDocumentViewer` et `ExplodedViewViewer` n'ont alors plus d'appelant : à supprimer (règle code mort).
- « Ouvrir dans un onglet » reste proposé discrètement dans la barre du lecteur (secours, téléchargement).

## 4. Pièces identifiées enregistrées sur la demande SAV (Eric)

**Où vit la liste** : sur la carte SAV (`majordhome.interventions`, type SAV), une ligne par pièce × équipement.
Nouvelle table `majordhome.sav_part_selections` (nom laissé au constructeur) :

| Colonne | Rôle |
|---|---|
| `org_id` | org de la carte (même convention que `interventions` : `COALESCE(client.org_id, contract.org_id)` si dérivé) |
| `intervention_id` | la carte SAV (FK, `ON DELETE CASCADE`) |
| `equipment_id` | l'appareil concerné (la fiche SAV permet de choisir parmi les équipements du client) |
| `equipment_model_id` | le modèle au moment du choix |
| `part_line_id` | ligne de nomenclature d'origine, **sans FK bloquante** (`ON DELETE SET NULL` ou pas de FK) : la nomenclature est remplacée en bloc à chaque relevé |
| `piece_reference`, `piece_name`, `repere`, `supplier_product_id` | **photo** de la pièce au choix — ce qui s'affiche et part au devis même si la ligne d'origine a disparu |
| `public_price_ht` | prix public HT de la pièce SUR CET APPAREIL au moment du choix (photo, cf. pièces « prix selon l'appareil ») |
| `quantity` | > 0 ; passer à 0 = supprimer la ligne |
| `added_by`, `added_at`, `updated_at` | qui l'a identifiée, quand (affiché au bureau) |

Unicité : une ligne par `(intervention_id, equipment_id, piece_reference, repere)` (mon choix : cocher deux fois la
même pièce = changer la quantité).

**Comportement sur la fiche SAV**
- Cocher une pièce ou changer sa quantité **l'enregistre aussitôt** (pas de bouton « Enregistrer ») ; la liste survit
  à la fermeture et se retrouve sur un autre appareil. Écriture refusée → toast + quantité remise à la valeur en base.
- **Au bureau** : la fiche SAV affiche en tête du bloc les **pièces identifiées** (référence, désignation, quantité,
  prix public, « par Prénom, le jj/mm »), retirables une à une.
- **« Créer un devis avec ces pièces »** part de cette liste enregistrée (même chaîne qu'aujourd'hui :
  `lignesDevisAvecPieces`, famille `sav`, chapitre PIÈCES, `CreateDevisModal` fléché vers la carte). **Créer le devis
  ne vide pas la liste (mon choix)** : elle reste la trace de ce qui a été identifié ; on retire une pièce à la main.
  **Prix au devis = chaîne d'aujourd'hui, inchangée (mon choix, après relecture)** : `ligneDevisDepuisPiece`
  (`prixVentePiece` — prix de vente de l'article, ajusté à la main compris —, `catalog_item_id`, `prixAchatPiece`
  pour la marge). On relit la ligne de nomenclature actuelle quand elle existe encore (`part_line_id`, sinon même
  modèle + référence + repère) ; sinon on reconstruit la ligne depuis la photo (référence, désignation,
  `supplier_product_id` → article et prix du catalogue ; pièce sans article = ligne libre au `public_price_ht` photo,
  comme une pièce « prix selon l'appareil » aujourd'hui). La photo sert à afficher et à survivre au relevé, pas à
  fixer le prix.
- **Qui coche sur la fiche SAV (mon choix, après relecture)** : ceux qui ont déjà les gestes de la fiche
  (`canEditSAV` = `sav.edit` ou `entretiens.edit`) + le technicien (ci-dessous). Le commercial n'y gagne rien.
  **La liste passe en lecture seule quand la carte est Réalisée** (le SAV est fait, les pièces sont une trace).
- **Fiche client → demande SAV (mon choix, après relecture)** : on range sur la demande ouverte du client
  (`getOpenSavCardId`, une demande ouverte par client — règle anti-doublon existante) même si elle porte sur un autre
  appareil : chaque pièce garde son `equipment_id`, la liste affiche l'appareil. Pièce déjà sur la demande (même
  appareil, référence, repère) : **la quantité de la fiche client remplace** celle enregistrée (on ne cumule pas,
  pour ne pas compter deux fois la même identification).

**Le technicien peut cocher (mon choix, déduit de la demande d'Eric)** : sur une demande SAV, il n'a aujourd'hui qu'un
geste, « Intervention faite » (`limiteALaCloture`, `src/lib/savCloture.js`). Il gagne « cocher / changer la quantité /
retirer une pièce identifiée » ; choisir le modèle fabricant, créer le devis, statut de commande, urgence, transitions
lui restent fermés. À porter dans `savCloture.js` (règle pure testée), jamais en dur dans le composant.

**Fiche client (Eric : oui)** : la sélection reste locale à l'écran tant qu'elle n'est pas rangée ; un bouton
**« Mettre sur la demande SAV »** range les pièces cochées dans la demande SAV ouverte du client
(`savService.getOpenSavCardId`), ou en crée une d'abord (`CreateSAVModal`, description pré-remplie par
`descriptionSavDepuisPieces`, appareil rattaché) — même enchaînement que `PartsToSavQuote` aujourd'hui, mais qui
s'arrête au rangement (pas de fenêtre de devis). Après
rangement : toast « 3 pièces mises sur la demande SAV » et la sélection locale se vide. Le bouton existant « Créer un
devis SAV » reste (mon choix) — il sert au bureau qui veut aller directement au devis.

**Le parcours du technicien sur la tablette (Eric : « en général le planning »)** : planning → RDV (`EventModal`) →
puce « Fiche » → fiche client → carte de l'équipement. C'est donc **sur la fiche client** qu'il identifie le plus
souvent. En conséquence :
- **« Mettre sur la demande SAV » est ouvert au technicien** sur la fiche client.
- **Le technicien peut créer la demande SAV en y rangeant ses pièces (Eric : « le technicien doit pouvoir créer une
  demande de SAV sur l'intervention qu'il est en train de faire ; d'ailleurs il le fait quand il déclare une anomalie
  dans son rapport »)**. Ce n'est PAS un `sav.create` général : seulement cette voie (fenêtre `CreateSAVModal`
  pré-remplie, comme la demande ouverte par un certificat « Devis à établir »). La base l'autorise déjà (écritures
  d'`interventions` sous `role_can(…, 'clients', 'edit')`, que le technicien a) ; la garde est d'écran, dans une règle
  pure testée.
- **RDV d'un SAV (mon choix)** : quand le RDV est rattaché à une carte SAV (`appointments.intervention_id`), une puce
  « SAV » à côté de « Fiche » dans `EventModal` ouvre la fiche SAV (`EntretienSAVModal`), son mode atelier et sa liste
  enregistrée.
- **À vérifier par le constructeur, sans rien changer sans l'accord d'Eric** : un technicien qui a déjà rangé des
  pièces sur une demande SAV puis signe un certificat « Devis à établir » ouvre aujourd'hui une SECONDE demande
  (`savService.createSAV({ sourceCertificatId })`, au plus une par certificat, mais rien ne regarde la demande déjà
  ouverte du client). Mesurer si `createSAV` reprend la demande ouverte ; sinon, le signaler à Eric.

**Droits et base** (charte multi-tenant du `CLAUDE.md`)
- RLS : lecture = membres de l'org ; écriture = `majordhome.role_can(org_id, 'clients', 'edit')` (le droit sous lequel
  vivent déjà les écritures d'`interventions` ; le technicien l'a par défaut). Le « seulement des pièces » du
  technicien est une garde d'ÉCRAN, comme le reste de `limiteALaCloture`.
- Vue publique `public.majordhome_sav_part_selections` `security_invoker=true`, miroir simple updatable ;
  `REVOKE ALL … FROM PUBLIC, anon` ; `GRANT SELECT … TO service_role` sur la table.
- Filtre `org_id` explicite sur toute mutation ; `{ error }` lu partout ; hook avec `unwrapResult`, cache key
  `…Keys.all(orgId)`-style dans `cacheKeys.js`.
- Migration versionnée, répétée d'abord sur `scripts/migration-rehearsal/` (étendre `snapshot.mjs` si besoin).
- Une suppression de carte SAV (hard delete org_admin) doit purger ces lignes : `ON DELETE CASCADE` suffit si la FK
  est posée ; vérifier `intervention_hard_delete` / `client_hard_delete` s'ils existent.

## 5. Le lecteur PDF (mon choix)

Bibliothèque **pdf.js de Mozilla** (`pdfjs-dist`), chargée **à la demande** (import dynamique au premier document
ouvert : rien dans le paquet principal). Rendu page par page en canvas + couche texte pour la recherche.
- Fonctions : page précédente / suivante, n° de page, ajuster à la largeur, zoom + / −, recherche dans le texte
  (surlignage, occurrence suivante), aller à une page (utile pour une vue éclatée tirée d'une notice : `page`).
- Les PDF sont lus par URL signée Storage (1 h, `equipmentDocumentsService.getSignedUrl`) — mêmes fichiers
  qu'aujourd'hui (299 PDF, `application/pdf` vérifié). Un document de la ligne fournisseur (`product_documents`) passe
  par le même lecteur.
- Image (vue éclatée, photo) : même zone, zoom ajusté / taille réelle / double et défilement, comme
  `ExplodedViewViewer` aujourd'hui (glisser au doigt sur la tablette).
- Échec de chargement : message dans la zone + « Ouvrir dans un onglet » — jamais une zone blanche muette.
- Worker pdf.js servi par Vite (`?url`) ; vérifier que le Service Worker PWA ne casse pas son chargement après
  déploiement.

## 6. Contraintes

`CLAUDE.md` en entier, en particulier : composants < 500 lignes (`EquipmentPartsSection` 288, `EquipmentList` 595 —
déjà au-dessus, ne pas l'alourdir : le mode atelier vit dans ses propres composants), aucun calcul dans le JSX (règles
de sélection dans `src/lib/catalogue/nomenclature.js` ou un module pur voisin, testés), `logger` et pas de `console`,
Tailwind seul, palette sans rouge / vert pour porter seul un état. Vérification : `npx vite build`, `npm run lint`,
`npm run audit:quality` ; pas d'outils de prévisualisation (Eric a son serveur de dev).

## 7. Laissé au constructeur

Nom de la table, de la vue, des composants et des hooks ; découpage en commits ; forme exacte de la poignée ;
version de `pdfjs-dist` (≥ deux semaines d'ancienneté) ; libellés secondaires ; ordre des onglets au-delà de
« Vue éclatée » en premier.
