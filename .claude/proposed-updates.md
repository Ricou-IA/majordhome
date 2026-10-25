# Propositions de mise à jour CLAUDE.md — file vivante

> **Ce fichier ne contient QUE les propositions OUVERTES.**
> Dès qu'une proposition est intégrée au CLAUDE.md (RESOLU) ou écartée (REJETE), on la **retire d'ici** — git + l'archive gardent la trace.
> Snapshot historique complet au 2026-06-18 (110 entrées, 93 RESOLU + 5 REJETE + 12 PENDING d'alors) : `.claude/proposed-updates-archive.md`.
> **Discipline anti-drift** : une session qui intègre une entrée dans CLAUDE.md la **supprime** de ce fichier dans la foulée. Sinon la doc est à jour mais l'entrée traîne en PENDING (cause exacte du tas qu'on vient de nettoyer : 6 entrées étaient déjà dans CLAUDE.md sans avoir été fermées ici).
> Revue du 2026-09-16 : 6 entrées intégrées (SMS, référentiel équipements, paramétrage par module, Pennylane sans création de lead, MT-LT = vue, RDV toujours assigné) — commit `docs(claude): revue des propositions`.
> Revue du 2026-09-20 : 1 entrée intégrée (contrat unique des mutations React Query — `unwrapResult`, § Conventions qualité → Hooks).
> Revue du 2026-09-20 (soir) : 1 entrée intégrée (gotcha « un fichier `sql/*.sql` n'est pas une migration appliquée », § Gotchas DB + correction des vues `majordhome_prospects` / `_prospect_interactions`, § Vues publiques principales).
> Revue du 2026-09-21 : 2 entrées intégrées (facturation d'entretien → Pennylane, condensée en 4 puces § Module Pennylane + remise exceptionnelle § Module Contrats ; `create-user` : écritures `core` + lecture de `{ error }`, § Edge functions).
> Revue du 2026-09-22 : 2 entrées intégrées (plan comptable de gestion par métier § Module Pennylane + icônes des tuiles § Paramétrage par module ; commande « personnes × jours » § Module Planning + gotchas `update_majordhome_lead` / harnais de répétition § Gotchas DB). Hub de facturation phase 1 gardé PENDING en attendant la phase 2 (import Pennylane livré le soir même, à documenter d'un bloc).
> Revue du 2026-09-30 : 1 entrée intégrée (droits app-level phases 4-6 livrées le jour même — § Rôles & Permissions réécrit, `org_seed_permissions` retirée) ; entrée Fumisterie tranche 1 (déjà RESOLU) retirée.
> Revue du 2026-10-01 : 3 entrées intégrées en une section « Module Facturation (hub) » (phases 1-3 + gabarits par catégorie + envoi e-mail Resend), après confirmation par Eric de l'avoir total unique et de la refacturation.
> Revue du 2026-10-24 : 23 entrées intégrées d'un bloc (Auto-RDV tranches 1-4 + état de journée + départ/retour → § Module Tournées ; refus, certificat un geste, anomalie → § Module Entretiens ; Fumisterie tranches 2-3 ; profils maison → § Rôles ; synchro client bidirectionnelle → § Module Pennylane ; activation des modules → § Paramétrage ; nouvelles sections Chantiers, Catalogue fournisseur, Climatisation, Devis, Maintenance (base NON appliquée en prod, vérifié), Webshop) — commit `docs(claude): revue des 23 propositions`.

> Revue du 2026-10-25 : 1 entrée intégrée (articles Majord'home, matrice org × fournisseur, condensée en 3 puces § Module Catalogue fournisseur, avec l'import d'offre et les prix publics). Le fichier était corrompu (un `$` non échappé dans la regex d'EAN avait recopié tout le fichier au milieu de l'entrée) : remis à zéro.

---
