# SAV : un écran à part, trois sorties

Date : 2026-11-25 · Demande d'Eric · Statut : tranches 1 et 2 livrées, jamais vues dans un navigateur

## Pourquoi

Le suivi des entretiens et celui du SAV partageaient un seul kanban (81 cartes SAV mêlées aux
entretiens) : « ça devient trop fouillis ». Et le SAV n'est pas une petite intervention de plus :
c'est une **porte d'entrée**. Une demande SAV peut finir en dépannage, en entretien (voire en
contrat d'entretien) ou en remplacement de l'appareil, donc en installation.

## Ce qu'on veut

- Une entrée « SAV » dans le menu, avec son kanban. « Entretiens » ne garde que les entretiens.
- Trois sorties d'une demande SAV :
  1. **Intervention** : traitée jusqu'au bout dans le kanban SAV (Demande, Devis envoyé,
     À planifier, Planifié, Réalisé, Encaissé).
  2. **Entretien** : « Ajouter l'entretien » fait passer la carte dans le kanban Entretiens.
  3. **Chantier** : un devis de remplacement accepté devient un chantier.

Ce qu'on ne veut pas : deux cartes pour un même passage ; un chantier (commandes, PV de
réception) pour une pièce à 80 € ; changer ce que font déjà la planification, la clôture
« Intervention faite », le rapport d'intervention ou les pièces identifiées.

## Approches considérées

1. **Deux composants de kanban recopiés.** Écarté : toute règle (transitions, technicien,
   planification) serait à tenir en double.
2. **Un nouveau type de carte ou de statut en base.** Écarté pour la tranche 1 : rien à stocker,
   la séparation est une question d'affichage.
3. **Retenue : un seul composant, deux zones.** `EntretienSAVKanban zone="sav" | "entretien"` ;
   quelle carte va où et dans quelle colonne se décide dans le module pur
   `src/lib/kanbanEntretienSav.js` (`zoneDeCarte`, `COLONNES_PAR_ZONE`, `colonneDeCarte`).
   Aucune migration, aucun statut nouveau.

## Tranche 1 (livrée) : deux écrans, bascule vers Entretiens

- Page `/sav` (`pages/Sav.jsx`), entrée de menu « SAV » (groupe Terrain, droit `sav.view`,
  module Entretiens & Contrats comme avant). Sous-titre : ce qui attend (`resumeSav`).
- Kanban SAV : cartes SAV sans entretien. Kanban Entretiens : entretiens, et cartes SAV avec
  entretien (`includes_entretien`).
- « Ajouter l'entretien » (fiche SAV) s'enregistre au clic. La carte passe côté Entretiens ; une
  demande pas encore traitée y arrive « À planifier » (`statutApresAjoutEntretien`). Client sans
  contrat : le message propose « Créer le contrat » (onglet Contrat de la fiche client). Re-cliquer
  remet la carte dans le SAV.
- Côté Entretiens, une carte SAV encore en « Devis envoyé » est rangée dans « À planifier » et se
  planifie quand même (`planifiableAvecEntretien`).
- Le montant du contrat n'est plus ajouté au montant du devis au clic : la carte l'additionnait
  déjà à l'affichage (double compte).

Décisions prises par Claude, à corriger si besoin : la page SAV reste dans le module
« Entretiens & Contrats » (une entreprise sans ce module n'a pas de SAV, comme avant) ; la
campagne d'appels reste côté Entretiens ; les repères SAV du Dashboard des entretiens ne sont pas
déplacés.

## Tranche 2 (livrée) : « Devis de remplacement », la demande devient un projet

### Ce qui a changé par rapport à la première idée

Eric avait d'abord retenu « la famille du devis décide, à l'acceptation ». L'instruction a montré
que cette règle n'avait rien sur quoi s'appuyer :

- aucun devis SAV n'est fait dans Majord'home (zéro devis relié à une carte SAV en base) : ils
  sont faits dans Pennylane ;
- la famille n'est enregistrée sur aucun devis, natif ou Pennylane ; elle n'existe que sur le lead ;
- un chantier ne naît que d'un devis **Pennylane** rattaché à un lead et accepté (trigger
  `chantier_ensure_for_quote` sur `lead_pennylane_quotes`).

Cas Sontag : deux devis Pennylane en attente (2 964,50 € et 3 396,50 € HT du 18 novembre),
rattachés à aucun lead, et deux cartes SAV sans lien avec eux.

Décision d'Eric (2026-11-25, « Oui, dès le devis ») : la demande SAV devient un **projet** dès
que le devis de remplacement existe. C'est un geste humain qui décide (le bouton), pas la famille.
Un devis de dépannage ou de pièces reste dans le SAV : personne ne clique.

### Approches considérées

1. **Chantier créé à l'acceptation par une nouvelle fonction en base** (lead gagné + chantier en
   un geste). Écarté : recopie la logique de gain et de création de chantier, et contourne le
   suivi commercial du devis (relances, Perdu).
2. **Nouveau statut « passé en chantier » sur la carte SAV**, posé par un trigger. Écarté : une
   migration et un statut de plus à faire connaître à tous les lecteurs, pour une information
   qui se lit déjà dans le pipeline.
3. **Retenue : relier la carte au lead, lire le reste.** Aucune migration.

### Ce qui est livré

- Bouton **« Devis de remplacement »** sur la fiche SAV (bureau, entreprise avec Pennylane). Il
  compte les devis Pennylane du client rattachés à aucun lead, lus dans le miroir local :
  customer ponté à la fiche, sinon même nom (`propositionRemplacement`).
- Le clic ouvre la fenêtre « Créer le lead » de l'écran Devis (`CreateLeadFromQuoteModal` :
  contact Pennylane, filet anti-doublon, rattachement des devis). Le lead naît en « Nouveau » et
  le rattachement le pousse en « Devis envoyé ».
- La carte SAV est reliée au lead par `interventions.lead_id` (colonne et clé étrangère
  existantes, suivies par `lead_merge`). Une demande passe en « Devis envoyé ».
- Si les devis du client sont déjà sur un lead (créé depuis l'écran Devis), le bouton devient
  « Relier au projet en cours ».
- Ensuite rien n'est écrit sur la carte : sa place se **lit** sur le projet (`etatProjet`,
  `colonneDeCarte`) — devis en attente : « Devis envoyé », pastille « Projet » ; devis refusé :
  retour en « Demande », pastille « Devis refusé » ; chantier créé : la carte sort du kanban SAV.
  Lecture inconnue : la carte reste visible en « Devis envoyé », on ne conclut rien.
- « Délier » sur la fiche : la carte redevient une demande ordinaire, le lead reste dans Leads.

### Limites connues

- Entreprise sans Pennylane : pas de bouton (aucun miroir de devis). Le passage en chantier s'y
  fait encore par le pipeline, sans lien avec la carte SAV.
- Un devis fait dans Majord'home depuis la fiche SAV (devis fléché) n'est pas repris par le
  bouton : il reste sur la carte.
- La carte passée en chantier disparaît du kanban SAV mais garde son statut en base : elle
  compte encore dans les repères SAV du Dashboard des entretiens, et l'onglet Interventions de la
  fiche client l'affiche « Devis envoyé ».
- Rapprochement par le nom quand le client n'est pas ponté à Pennylane : deux mots au moins,
  identiques ; un homonyme exact serait proposé à tort (la fenêtre montre les devis avant de créer).
- Jamais vu dans un navigateur à la livraison.

## Correctif livré le même jour : « pièces reçues » sur une carte planifiée

Vécu LENDRIN : RDV posé, pièce notée « Reçu », la carte repartait en « À planifier » (date
effacée, RDV resté au planning). Les transitions automatiques de la fiche SAV ne jouent plus que
depuis un statut d'attente (`statutApresPiecesRecues`, `effetDevisSurCarte`).
