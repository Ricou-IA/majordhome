# SAV : un écran à part, trois sorties

Date : 2026-11-25 · Demande d'Eric · Statut : tranche 1 livrée, tranche 2 à faire

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

## Tranche 2 (à faire) : devis accepté, chantier selon la famille

Décision d'Eric (2026-11-25) : **la famille du devis décide**.

- Famille Dépannage / SAV ou Pièces : la carte reste dans le SAV (pièces à commander, à
  planifier, réalisé), comme aujourd'hui.
- Toute autre famille (poêle, PAC, climatisation…) : le devis accepté devient un **chantier**, et
  la carte SAV est close avec la mention du chantier.
- Devis fait hors de l'outil (cas Sontag : deux cartes SAV, aucun devis dans Majord'home) : un
  geste « Passer en chantier » sur la fiche SAV.

Conséquences à tenir :

- Un chantier est accroché à un lead (`chantiers.lead_id` obligatoire). Passer en chantier crée
  donc un lead gagné pour le client : la règle du 2026-11-09 (« un devis SAV ne crée aucun lead et
  n'entre jamais dans le pipeline ») ne vaut plus que pour les familles SAV et Pièces. La vente
  compte dans le CA signé du pipeline.
- Création du lead par un geste d'écran, jamais par un flux serveur ; filet anti-doublon
  `findPotentialDuplicates` ; gain par la voie unique existante, sans recopier sa logique.
- La carte SAV close ne doit plus apparaître « à traiter » ; la fiche client doit montrer d'où
  vient le chantier.

Reste à instruire avant d'écrire : la voie exacte de création du chantier pour un devis natif
(sans devis Pennylane rattaché), et l'état de clôture d'une carte SAV devenue chantier.
