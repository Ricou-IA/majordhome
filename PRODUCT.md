# Product

## Register

product

## Users

- **Techniciens** (Philippe et l'équipe terrain Mayer) : tablette durcie 8" (Oukitel RT3 Pro), dehors, parfois au soleil ou avec des gants. Ils consultent LEUR journée, ouvrent une fiche client ou une intervention, signent un certificat. Un geste par écran, lisible à bout de bras.
- **Commerciaux** : téléphone ou tablette en rendez-vous, PC à l'agence. Ils regardent leur planning du jour, la fiche du prospect, le pipeline.
- **Secrétariat / planification** (Mathis) et **admin** (Eric) : PC, grand écran, longues sessions. Densité, colonnes, raccourcis ; c'est là que se font le planning hebdomadaire, le mailing, les paramètres.
- Demain : d'autres artisans CVC onboardés sur la même instance (multi-tenant), avec leur propre branding.

## Product Purpose

Majord'home est l'outil métier d'un artisan CVC : CRM, planning, pipeline commercial piloté par Pennylane, contrats d'entretien et tournées, outil terrain, carte territoire. Il remplace des tableurs et de la mémoire orale. Succès = l'équipe retrouve l'information en un geste, ne ressaisit rien, et aucun RDV ni facture ne tombe dans un trou.

Un écran = une tâche en cours. Le logiciel doit disparaître derrière le travail.

## Brand Personality

Sobre, dense, fiable. Voix neutre et directe, en français, vocabulaire du métier (« Entretien », « Chantier », « Tournée »). Pas d'enthousiasme marketing, pas d'emoji décoratif. Référence de catégorie : Linear, Notion, Pennylane pour la familiarité et la densité maîtrisée.

## Anti-references

- Landing page SaaS : dégradés, texte en dégradé, glassmorphism, grosses cartes identiques avec icône + titre + texte.
- Dashboard « gros chiffre » : hero-metric avec accent coloré, cartes imbriquées.
- Interface « jouet » : animations d'entrée orchestrées, boutons sur-décorés, polices display dans les libellés.
- Mobile qui n'est qu'un desktop rétréci : texte illisible, cibles de 24 px, tableaux qui débordent.

## Strategic Design Principles

1. **Lisible à bout de bras, tapable au pouce** : 16 px minimum pour le texte courant sur téléphone, cibles 44 px, pas de hover obligatoire.
2. **Le contexte avant la liste** : sur appareil mobile, ouvrir sur MA journée, MON planning, pas sur la vue globale de l'équipe.
3. **Palette deutan** : jamais rouge/vert comme seul porteur d'information ; la couleur d'un RDV est celle de la personne, le violet est réservé au statut facturé.
4. **Retenue chromatique** : neutres teintés, un accent (primary) pour les actions et la sélection, rien de décoratif.
5. **Pas de branding en dur** : nom, logo, couleurs viennent de `core.organizations.settings` ; une org sans réglage voit du neutre.
6. **Échouer fort** : une erreur se voit (toast, bannière), jamais un succès annoncé sur un refus.

## Accessibility

- Contraste 4.5:1 sur le texte, 3:1 sur les contrôles.
- Boutons icône seuls : `aria-label`. Focus visible au clavier.
- `prefers-reduced-motion` respecté (les animations d'apparition sont décoratives, elles se coupent).
- Zone de sécurité iOS (`env(safe-area-inset-*)`) sur la coque mobile.
