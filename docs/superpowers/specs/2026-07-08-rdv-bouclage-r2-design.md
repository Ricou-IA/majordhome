# RDV Bouclage R2 — Design

> Date : 2026-07-08
> Statut : validé (Eric)
> Contexte : `CLAUDE.md` → Module Planning / RDV ↔ Kanban, mémoire `project_refonte_rdv_kanban_bloc_a.md`

## Problème

Poser un RDV depuis le planning pour un client dont le lead a **déjà un devis**
crée un **second lead doublon**.

Cause : [`resolveCardForAppointment`](../../../src/shared/services/appointmentActivation.service.js)
pour une Visite Technique dédup uniquement les leads **actifs** du client
(`.not('status_id', 'in', (Gagné, Perdu))`). Un lead avec devis accepté (→ Gagné)
ou refusé (→ Perdu) est terminal → la dédup l'ignore → un nouveau lead est créé.

Cas réels observés en base (avant la dédup Bloc A du 2026-06-03) :
- SOULA : 2 leads (l'un porte 3 devis), les deux « Perdu »
- CAPPAROS : lead « Gagné » (2 devis) + doublon « Perdu » créé 3 min après

## Décision produit

Un 2ᵉ RDV sur une affaire existante n'est **pas** une Visite Technique (prospection) :
c'est un **bouclage** (valider des options, signer, caler la suite). On introduit un
motif explicite plutôt que de réutiliser silencieusement la VT.

- `rdv_technical` → renommé **« Visite Technique R1 »** (label seul)
- Nouveau `rdv_closing` → **« RDV Bouclage R2 »**

Le côté intervention/chantier (`installation`, `maintenance`, `service`) n'est **pas** touché :
un bouclage est souvent une visite commerciale, pas une prépa de chantier.

## Comportement

### R2 = sélection stricte d'une carte existante
Quand le type est **RDV Bouclage R2**, le sélecteur passe en **mode lead-only** :
- La recherche ne remonte que des **cartes existantes du pipeline** (leads, tous statuts —
  Gagné / Perdu / Devis envoyé inclus).
- **Ni saisie client libre, ni saisie manuelle** (nom/tél/adresse masqués).
- Le bouton « Créer le RDV » reste **désactivé tant qu'aucune carte n'est sélectionnée**.

→ Impossible de créer un R2 orphelin. L'edge case « client sans lead » **n'existe plus**.

### Rattachement (jamais de doublon)
- R2 : le lead sélectionné est passé en **passthrough** → rattachement direct,
  **jamais de nouveau lead**. Garde-fou côté service : la branche R2 refuse toute création.
- Le chemin « walk-in prospect » de l'EventModal est **restreint au R1** (un R2 ne peut
  jamais fabriquer un prospect).
- **R1 : strictement inchangé** (dédup lead actif, sinon crée).

### Statut de carte (forward-only)
R2 rangé avec les types VT pour `syncCardStateOnCreate` → règle **forward-only** :
sur un lead « Devis envoyé » ou « Gagné », le statut **ne bouge pas**, le RDV R2
s'affiche simplement sur la carte. Aucune régression.

### Catégorie / assignation / couleur
- `rdv_closing` ∈ `COMMERCIAL_TYPES` → bucket commercial, colonnes commerciaux dans
  l'assistant de créneaux, filtres planning : tout devient automatique.
- **Pas de couleur propre au type** : les couleurs restent par intervenant (violet si
  facturé). Le champ `color` de `APPOINTMENT_TYPES` ne sert que l'icône de la modale →
  valeur neutre.

## Périmètre technique

Aucune migration DB : `appointment_type` est un `text` libre (pas de contrainte CHECK),
la vue `majordhome_appointments` est un miroir simple.

Fichiers touchés :
- `src/shared/services/appointments.service.js` — `APPOINTMENT_TYPES` (+`rdv_closing`,
  rename label R1) ; ranger `rdv_closing` avec les VT pour `syncCardStateOnCreate`.
- `src/lib/planningEvents.js` — `COMMERCIAL_TYPES += 'rdv_closing'`.
- `src/apps/artisan/components/planning/EventModal.jsx` — `availableTypes += 'rdv_closing'` ;
  validation R2 (lead requis) ; walk-in restreint au R1.
- `src/apps/artisan/components/planning/EventFormSections.jsx` — `SectionClient` : prop
  `leadOnly` (recherche lead uniquement, masque résultats clients + saisie manuelle).
- `src/shared/services/appointmentActivation.service.js` — branche R2 (garde-fou anti-création).

Cohérence :
- Grep des références au libellé « Visite Technique » (légende planning, badges, docs).
- Le rename R1 s'affiche partout, y compris sur les VT historiques (effet voulu).

## Hors périmètre (YAGNI)
- Bouton « Prendre RDV » depuis les cartes du kanban pipeline (chemin `attachContext`,
  fonctionne déjà par passthrough pour tout type — non recâblé ici).
- Restriction de la recherche R2 aux seuls leads porteurs d'un devis (on remonte toutes
  les cartes existantes ; un bouclage peut porter sur une affaire sans devis encore émis).
