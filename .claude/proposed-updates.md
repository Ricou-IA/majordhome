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

> Revue du 2026-10-27 : 2 entrées intégrées en version condensée (plan Devis du 26/10 → § Module Devis + § Module Catalogue + § Rôles & Permissions ; durcissement des droits d’article → § Module Catalogue, gotchas du harnais → `scripts/migration-rehearsal/README.md`) — commit `docs(claude): revue des propositions`.
---



## [2026-10-27 22:30] anon n'a plus aucun privilège sur majordhome.* ni sur les vues public.majordhome_* (migration 20261029_1)
**Statut** : RESOLU
**Commit** : 9584f4ee — migration `20261029_1_anon_revoke_majordhome.sql` (prod, `schema_migrations` 20261027210723), `assert-anon-revoke-majordhome.sql`, bootstrap du harnais aligné, `permissions-coherence.mjs` § 6
**Contexte** : point 3 de la relecture du plan Devis du 26/10, décidé par Eric le 27/10. L'ACL par défaut du schéma majordhome accordait arwd à anon sur toute table créée ; 92 tables, 7 vues internes, 2 séquences et 102 des 143 vues public.majordhome_* le portaient encore. Rien ne fuyait (aucune policy anon, vues security_invoker, schéma non exposé) : la RLS était la seule serrure.
**Proposition** : ajouter à CLAUDE.md § Multi-tenant & sécurité, sous la règle « REVOKE EXECUTE FROM PUBLIC, anon » :
- **`anon` n'a plus aucun privilège sur `majordhome.*`** (tables, vues, séquences, ACL par défaut du schéma — migration `20261029_1`, 2026-10-27) **ni sur les vues `public.majordhome_*`**. Une table `majordhome` naît désormais sans `anon` ; une vue `public.majordhome_*` reçoit encore l'ACL par défaut du schéma `public` (partagé avec les apps cohabitantes, non touché) → **toujours `REVOKE ALL ON public.majordhome_<vue> FROM PUBLIC, anon` à la création**. Mesure : `node scripts/permissions-coherence.mjs --env .env.local` § 6 (échoue sur toute relation ou séquence majordhome, ou vue `majordhome_*`, encore ouverte à anon). Les voies publiques (site vitrine, `/rdv/:token`, `/gaillac/:token`, unsubscribe, webhooks) passent par `service_role` ou des RPC SECURITY DEFINER. **Reste à auditer** : ~40 RPC Majord'home SECURITY DEFINER encore exécutables par `anon` (`mail_segment_*`, `create_majordhome_lead`, `promote_lead_to_gagne`, pellets…, certaines légitimes pour le site vitrine — audit avec ses appelants ouverts à côté), le bucket public `product-images` (objets d'article sans garde `articles.edit`), les tables `_backup_20260805` (couvertes par le REVOKE, à supprimer).
- Gotcha harnais : les ACL **par objet** ne sont pas photographiées par `snapshot.mjs` (seules les ACL par défaut le sont, dans `bootstrap-pre/post.sql`) — une assertion qui dépend d'un GRANT/REVOKE d'une migration passée doit rejouer cette migration dans la chaîne ; le stub `storage.objects` a RLS et `foldername` mais pas les policies de `20260809_2` (une assertion fonctionnelle recrée `product_documents_org_select` si elle manque, sinon `DELETE … WHERE` touche 0 ligne pour tout le monde) ; un snapshot pris APRÈS la mise en prod d'une migration exige ses nouvelles fonctions dans `FUNCTIONS`.
---

## [2026-10-27 18:30] Devis → Pennylane : chapitre à prix masqués envoyé en une ligne
**Statut** : RESOLU
**Commit** : 08b5a253
**Contexte** : Pennylane n'a pas de « prix masqués » par chapitre. Avant, un chapitre masqué partait ligne à ligne avec tous les prix ; Eric veut une ligne au montant du chapitre avec le détail en description (2026-10-27). Règle portée par le module pur `src/lib/pennylaneQuotePayload.js`, testée.
**Proposition** : ajouter au § Module Devis (colonnes d'affichage figées), après « Pennylane : description de ligne = description + caractéristiques » : « **Chapitre à prix masqués → UNE ligne Pennylane** (`regrouperChapitresPrixMasques`, POST et PUT) : libellé = titre du chapitre, quantité 1, total HT du chapitre remises de ligne comprises, articles en description “qté × désignation · fournisseur · référence” sans les mentions du métré ; une ligne par taux de TVA ; compte de vente repris s'il est unanime. Le titre du chapitre est donc le libellé que lit le client dans Pennylane. »
---
