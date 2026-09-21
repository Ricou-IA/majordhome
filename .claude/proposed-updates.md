# Propositions de mise à jour CLAUDE.md — file vivante

> **Ce fichier ne contient QUE les propositions OUVERTES.**
> Dès qu'une proposition est intégrée au CLAUDE.md (RESOLU) ou écartée (REJETE), on la **retire d'ici** — git + l'archive gardent la trace.
> Snapshot historique complet au 2026-06-18 (110 entrées, 93 RESOLU + 5 REJETE + 12 PENDING d'alors) : `.claude/proposed-updates-archive.md`.
> **Discipline anti-drift** : une session qui intègre une entrée dans CLAUDE.md la **supprime** de ce fichier dans la foulée. Sinon la doc est à jour mais l'entrée traîne en PENDING (cause exacte du tas qu'on vient de nettoyer : 6 entrées étaient déjà dans CLAUDE.md sans avoir été fermées ici).
> Revue du 2026-09-16 : 6 entrées intégrées (SMS, référentiel équipements, paramétrage par module, Pennylane sans création de lead, MT-LT = vue, RDV toujours assigné) — commit `docs(claude): revue des propositions`.
> Revue du 2026-09-20 : 1 entrée intégrée (contrat unique des mutations React Query — `unwrapResult`, § Conventions qualité → Hooks).
> Revue du 2026-09-20 (soir) : 1 entrée intégrée (gotcha « un fichier `sql/*.sql` n'est pas une migration appliquée », § Gotchas DB + correction des vues `majordhome_prospects` / `_prospect_interactions`, § Vues publiques principales).

---

## [DROITS APP-LEVEL] Modèle de permissions canonical — Phases 4-6 à graver
**Statut** : PENDING (volontairement différé — fusionne 4 anciennes entrées du 2026-06-02 : spec 01:22 / registre 01:39 / socle DB 01:55 / Phase 3 RLS 02:21)
**Commits** : cc9ac2b · 74a9e00 · 4285f82 · ed671ec
**État** : Phases 1-3 livrées en prod (registre `src/lib/permissionsRegistry.js` ; table `majordhome.app_role_permissions` + fonctions `user_effective_role`/`role_can` ; écritures `equipments`+`interventions` gouvernées par `role_can(project_org_id(...), 'clients', …)`). Garde-fou déjà présent dans CLAUDE.md § Rôles & Permissions (ne pas éditer `app_role_permissions` à la main ; ne pas brancher de policy RLS sur `role_can` avant Phase 4).
**Reste (avec Eric, prod partagée)** : policies `clients`/`contracts`/`leads`, branchement front `can()`, retrait du seed Mayer `org_seed_permissions`.
**À faire** : graver la doc complète dans CLAUDE.md § Rôles & Permissions quand Phases 4-6 atterrissent. Spec : `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md`.

*Confirmé PENDING le 2026-08-09 : rien à graver tant que les phases ne sont pas livrées. Reconfirmé le 2026-09-16.*
---

## [2026-09-21 16:30] Facturation d'un entretien : push Majord'home → Pennylane
**Statut** : PENDING
**Commit** : (session du 2026-09-21, feat(entretiens): bouton « Facturer » → facture Pennylane)
**Contexte** : Il n'a jamais existé de chaînage facture Pennylane → carte entretien (seul le bouton manuel posait `invoiced_at` ; 41/50 cartes Réalisé marquées à la main, 0 mapping facture). Livré : bouton « Facturer » sur la carte entretien Réalisé qui crée la facture via `POST /customer_invoices` (proxy, path exact) et marque la carte (`invoice_id` + `invoiced_at`), modèle pur `src/lib/entretienInvoiceModel.js` (testé), réglages `settings.pennylane.invoice` (Settings → Socle → Facturation Pennylane, qui porte enfin le toggle `enabled`).
**Proposition** (§ Module Pennylane, « Règles qui mordent ») :
- **Facturer un entretien = bouton « Facturer » de la carte** (`FacturerEntretienDialog` → `useCreateEntretienInvoice` → `pennylaneService.createInvoiceFromEntretien`), spec `docs/superpowers/specs/2026-09-21-facturation-entretien-pennylane-push-design.md`. **1 ligne par équipement au prix grille, calcul IDENTIQUE au contrat signé** (`computeContractLines` de `src/lib/contractPricing.js`, module PUR sorti de `pricing.service.js` et ré-exporté pour ContractSign / ContractPdfSection / ContractPricingSection — toute nouvelle surface qui chiffre un contrat passe par là, jamais par `contract_pricing_items`, vides sur la plupart des contrats). **La remise s'applique** : écart Σ grille − `contract.amount` = remise relative par ligne d'équipement (dégressivité + remise commerciale), jamais sur les pièces ; forçage à la hausse = lignes majorées au prorata. TVA = `equipment_categories.default_vat_rate` (absente → 20 % + avertissement affiché), pièces non offertes sur la même facture, HT = TTC / (1 + taux) à 10 décimales. Modèle PUR `src/lib/entretienInvoiceModel.js` (`node --test scripts/entretien-invoice-model.test.mjs`, dans `audit:quality`) — jamais dans le composant.
- **Idempotence = mapping `pennylane_sync` type `invoice`** (`local_id` = intervention, `external_reference` = intervention) relu AVANT tout POST : un second clic ne recrée rien et ré-applique `invoice_id`/`invoiced_at`. `interventions.invoice_id` posé ⇒ bouton inerte « Facturée », marquage manuel masqué. **Bouton one shot** : « Facturer » disparaît dès que la carte est facturée, y compris par le marquage manuel (`invoiced_at`) — avoir / facture différente = geste Pennylane, jamais une re-génération depuis la carte.
- **Lignes libres, jamais d'articles PL ; la famille comptable = compte de vente paramétré** : `settings.pennylane.invoice.ledger_accounts = { by_category: { [categoryId]: id }, parts }` (comptes 706* lus dans PL via `useLedgerAccounts`, Settings → Facturation Pennylane), transmis en `ledger_account_id` par ligne ; absent → défaut PL + avertissement `compte_manquant`. Même mécanisme à réutiliser pour les travaux.
- **Remise exceptionnelle du contrat** (`contracts.exceptional_discount`, migration `20260921_1`) : après la dégressivité, `calculateContractTotal(items, discounts, exceptionalDiscount)` (module PUR `src/lib/contractPricing.js`), reprise PDF / signature / facture. § Module Contrats : total = sous-total − dégressivité − remise exceptionnelle ; l'ancien forçage global `amount_forced` reste le filet legacy (« Remise commerciale »).
- **`apiCall` Pennylane remonte le message PL** (`error.context.json()`) ; `getLedgerAccounts` = pagination + filtre local (la syntaxe `filter[number][start_with]` renvoie 400).
- **Mode `settings.pennylane.invoice.mode` = `draft` par défaut** (brouillon à finaliser/envoyer depuis PL), `final` quand le mapping est jugé fiable ; échéance `deadline_days` (30). Toujours sauver l'objet `pennylane` COMPLET (merge JSONB niveau 1). Le proxy n'autorise `POST` que sur `/customer_invoices` exact : `finalize` / `send_by_email` restent bloqués tant que l'envoi reste manuel (décision Eric 2026-09-21).
- Périmètre V1 : entretiens uniquement (SAV = devis PL). Hors périmètre : lien vers la facture sur la carte, rattrapage des factures saisies à la main dans PL.
---
