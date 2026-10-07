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

---





## [2026-09-25 19:00] Module Maintenance (tâches récurrentes, borne d'atelier, traçabilité)
**Statut** : PENDING
**Commit** : 0322997 (spec) · de8e697 · 146420d · 39e0db1 · 689132b · 40068cc
**Contexte** : nouveau module opt-in générique (1er client : usine Bricafeu, nouvelle org). Unités → tâches à fréquence, borne TV + Raspberry Pi qui sert d'écran d'affichage ET de saisie (prénom + PIN), suivi responsable, e-mail du soir, registre PDF. Migrations 20260925_1 (répétée OK) et 20260925_2 (cron) NON appliquées en prod à la date du commit.
**Proposition** (nouvelle section « Module Maintenance → docs/superpowers/specs/2026-09-25-module-maintenance-taches-recurrentes-design.md ») :
- **Règle d'échéance = `src/lib/maintenance/echeances.js`**, seule définition de « dû / en retard » (borne, suivi, e-mail, PDF), copiée pour Deno par `sync:tournee-engine` (`_shared/maintenance/`). Échéance jamais stockée. Jours cochés : un retard ne s'empile pas ; intervalle : depuis la réalisation effective ; « pas pu faire » ⇒ J+1.
- **Borne = compte Supabase membre (option 1-B, choix Eric)** : voit ce que voit tout membre ⇒ création refusée si l'org a des clients (`BorneTab`). Org avec clients qui veut une borne ⇒ jeton d'appareil (option 1-A de la spec), jamais un compte membre.
- **PIN** : `pin_hash` illisible (privilèges colonne + vue sans la colonne + REVOKE `baikal_reader`, que les ACL par défaut du schéma `majordhome` servent en SELECT). `maint_record_completion` RETOURNE `{ok:false}` sur PIN faux au lieu de RAISE — un RAISE annulerait l'incrément `failed_attempts` et le blocage ne s'enclencherait jamais.
- **Journal `maint_task_logs` append-only** : aucune policy d'écriture + trigger anti UPDATE/DELETE ; horodatage `clock_timestamp()` (deux réalisations d'une même transaction restent ordonnées).
- **Modules activables par org depuis Baikal** (révisé 2026-09-26, commits eb6396b / 8cb28c4, spec `2026-09-26-baikal-admin-modules-majordhome-design.md`) : `CATALOGUE` de `src/lib/modules.js` (crm, entretiens, communication, solaire, thermique, maintenance ; `parDefaut`), `moduleActif` = drapeau booléen sinon défaut. Chaque route a son module (`moduleDeRoute`, testé contre routes.jsx) et passe par `ModuleGate` (App.jsx) ; sidebar et Paramètres filtrés. Écriture UNIQUEMENT par l'edge `baikal-admin` (`X-Baikal-Key` = `MDH_BAIKAL_KEY`, `requireHeaderSecret`) → RPC `org_set_modules` (service_role only, journal `majordhome.org_modules_journal`). Jamais d'`UPDATE` SQL à la main sur `settings.modules`. Compte borne (`settings.maintenance.kiosk_user_ids`) → `/maintenance/borne` ; org sans CRM → écran du premier module ouvert.
- **Vocabulaire** du module (`settings.maintenance.vocabulaire`, `src/lib/maintenance/vocabulaire.js`) : jamais « Maintenance » / « unité » en dur dans un nouvel écran du module, et pas d'adjectif accordé au mot choisi (« + Zone », pas « Nouvelle zone »).
- **E-mail du soir** : edge `maintenance-digest` (cron horaire :05, `MDH_CRON_SECRET`), part même si tout est à jour, expéditeur org sinon `MDH_PLATFORM_FROM_EMAIL` sinon `skipped:no_sender`, `maint_digest_mark_sent` (service_role only) après 2xx Resend.
---


## [2026-09-29 12:00] Module Fumisterie — tranche 2 G4 tubage (compléments à la section « Module Fumisterie »)
**Statut** : PENDING
**Commit** : 9ff11fa
**Contexte** : la section CLAUDE.md décrit la tranche 1 (G1 création intérieure). La tranche 2 ajoute le gabarit G4 tubage (CFG-34/26 flexible, CFG-35/27 rigide) et quatre mécanismes de moteur que les prochains gabarits (G5, POLYPERF, G3) réutiliseront.
**Proposition** : ajouter à la section « Module Fumisterie » les puces suivantes :
- **Gabarits G4 (flexible) / G4R (rigide PRH) = même géométrie** (`gabarits/g4.js`) : le code du gabarit dit si le conduit existant reçoit un flexible au ml (conduit + `flexible_marge_m`, arrondi à `flexible_arrondi_m`) ou des tuyaux PRH composés en `longueurs_prh_mm` (6/10, Ø ≥ 130) ou `longueurs_prh_5_10_mm` (5/10, Ø 80/100). Un gabarit n'affiche que les choix qui le concernent (le rigide n'a ni `raccord` ni `chapeau`) : un champ affiché mais ignoré est un piège silencieux.
- **Alternatives « ou » = `groupe_alternative` + `option`** sur `fum_config_composants` : le composant n'est retenu que si `releve[groupe] == option` (ex. `entree` plafond / mur, `raccord` émaillé 1,2 / 0,7 / acier peint, `kit_air`). Un groupe sans `option` (kit RT2012) reste un simple regroupement.
- **`par_longueur` itère la composition du tronçon**, pas la liste d'org (un tronçon PRH se compose en 330) ; **`par_longueur_ml:<tronçon>`** pour un article vendu au mètre (`tr.ml`, déjà arrondi par la géométrie).
- **Placeholder `{BOI}`** dans `motif_code` = indice de section de boisseau (1..6 : 20×20, 25×25, 30×30, 20×40, 40×40, 30×50) ; MODINOX numérote pareil kits de couronnement (`2DIVKCIRN{BOI}{D}`) et plaques ventilées (`2FLEPHV{BOI}N{D}NO`). Les plaques ventilées ont une gamme tarif PAR taille → 6 lignes de mapping à priorité, le motif écarte les mauvaises.
- **Un mapping dont le motif ne cite pas `{D}` désigne un article indépendant du Ø** (`motifDependDuDiametre`) : le résolveur ne filtre plus sur le Ø et `getArticles` charge la gamme entière (2ᵉ requête, pas de `.or()` : les noms de gammes portent parenthèses et virgules). Vécu : kit d'entrée d'air Ø100 sur un conduit Ø80 sortait « à chiffrer ».
- **Le seed remplace le mapping MODINOX par l'union des fichiers `data/*-mapping.json`** ; un composant partagé par plusieurs configurations (`kit_couronnement`) n'a qu'une définition. Tarif : trous honnêtes (chapeau plat Ø100, acier peint 2 mm Ø100, plaque ARP Ø80 en 5/10) → « à chiffrer », jamais un article approchant.
- **Recette 2026-09-28** : la qualification hérite de la famille du devis (`criteresDepuisFamille`), un brouillon restauré se dit (bandeau + « Repartir de zéro », le brouillon est par lead, pas par devis), et l'écran liste les configurations métrables quand la sélection n'en a aucune. **Prix jugé élevé par Eric** (tarif public sans remise) → remise par famille de pièces à cadrer avant la mise en main de Philippe.
---

## [2026-09-29 16:00] Module Fumisterie — tranche 3 (toutes les configurations) — compléments CLAUDE.md
**Statut** : PENDING
**Commit** : 8169343
**Contexte** : les 19 configurations du catalogue MODINOX sont métrables (10 gabarits). Quatre règles de moteur et un piège de résolution méritent d'être gravés pour les prochaines évolutions (ATRINOX, zones 2/3, DINAK).
**Proposition** : ajouter à la section « Module Fumisterie » :
- **10 gabarits pour 19 configurations** (`GABARIT_PAR_CODE` dans `seed-configurations.mjs`, source unique) : `G1` création intérieure (PTR30, Polytoit, PLA, MFI), `G3`/`G3P` façade (zone 1 depuis l'égout, `sortieMinimale`), `G4`/`G4R`/`G4P`/`G4K`/`G4F` tubages (flexible, rigide, POLYPERF, kit PLA, foyer), `G5` raccordement seul (conduit non métré), `G6` ventouse (zone 3 **non vérifiée**, alerte warn). Les variantes G4P/G4K/G4F/G5 réutilisent `geometrieG4` avec des paramètres forcés dans `index.js` — ne pas dupliquer la géométrie.
- **Règles de quantité** (`nomenclature.js`) : `unitaire`, `par_longueur:<t>` (longueurs de la composition), `par_longueur_ml:<t>` (au mètre), `kit_longueur:<t>` (kit de N m, `{ML}`), `par_emboitement:<t>`, `par_plancher`, `par_intervalle:<t>` (réglage `supports_muraux_tous_les_m`), `coudes:<t>`. Placeholders de motif : `{D}`, `{D±n}`, `{LG}`, `{A}`, `{BOI}`, `{BOI4}`, `{ML}`.
- **La pente ne départage que les mappings de type `solin` / `souche`** ; une pièce sans plage (collerette PLA) n'est pas écartée.
- **Un motif sans `{D}` = article dont le Ø nominal n'est pas celui du relevé** (kit d'air, `{D+60}` seul pour un support mural au Ø extérieur, solin MFI) : ni le service ni le résolveur ne filtrent sur le Ø, le motif tranche. Le service charge aussi les articles **sans Ø parsé** (plaque de propreté MFI « MFI 130 »). Un article « D XXX » est sur mesure → à chiffrer, jamais approché.
- **Toutes les règles de la tranche 3 sont provisoires** (choix listés dans `TESTS_MANUELS_tranche1.md`) ; les tests `tranche3-tarif-reel.test.mjs` pinnent 14 cas et les « à chiffrer » voulus (adaptateurs PLA sur mesure, support de départ Ø80/100, solin PLA Ø100, kit MFI par appareil). Prochaine étape décidée : règle de prix (remise par famille) puis bloc B Pennylane.
---

## [2026-09-29 23:00] Auto-RDV tranche 1 « Voir » — état de journée, journal des crons, figeage partagé
**Statut** : PENDING
**Commit** : e93a05e..640344f
**Contexte** : Spec `docs/superpowers/specs/2026-09-29-auto-rdv-entretien-mensuel-design.md` (décisions Eric : demi-journée, journée de secteur, tout automatique, page client temps réel, mois en cours = borne dure). Tranche 1 livrée : module pur `etat.js`, tables `journees_secteur` + `planification_runs`, RPC `tournees_figer_journee_user`, puces d'état dans le Planning, journal dans le Dashboard entretiens. Détail : `docs/MODULE_TOURNEES.md` § « État de journée ».
**Proposition** (à ajouter dans CLAUDE.md § Module Tournées, « règles qui mordent ») :
- **État d'une journée = `src/lib/tournee/etat.js::etatJournee`** (vide · ouverte · pleine · figée · à arbitrer), dérivé à la lecture, jamais stocké ni recopié. Une journée est **disponible par nature** (l'absence d'installation la laisse libre) ; l'étiquette `journees_secteur` dit seulement à quel secteur elle est dédiée (déduite des RDV posés, sinon posée par la machine) — l'humain n'ouvre pas de journée. **Horizon entretien = mois en cours, borne dure** : une journée vierge du mois suivant appartient aux installations.
- **Figeage = une seule fonction** `majordhome.figer_journee` (cron `tournees_figer_journee` service_role ; bouton `tournees_figer_journee_user` authenticated) — tout ou rien, trace `figee_at`/`figee_par`. Ne jamais réintroduire une boucle `updateAppointment` pour figer.
- **Tout cron de planification écrit `majordhome.planification_runs`**, même en échec ; un cron sans ligne dans le journal ne tourne pas.
---

## [2026-09-30 00:30] Auto-RDV tranche 2 — page client, lien signé, RPC de pose
**Statut** : PENDING
**Commit** : 0a51355..bbd6216
**Contexte** : Page publique `/rdv/:token` + edge `auto-rdv` + RPC `auto_rdv_poser` + bouton « Copier le lien ». Détail : `docs/MODULE_TOURNEES.md` § « Auto-RDV ».
**Proposition** (CLAUDE.md § Module Tournées) :
- **Auto-RDV : l'offre est calculée à l'instant, jamais figée dans un mail** (`src/lib/tournee/auto-rdv.js`, edge `auto-rdv`) ; horizon = mois en cours ; une journée vide sans étiquette n'est pas proposée ; la page ne déplace jamais un voisin. **`empreinteJournee` (JS) et le `string_agg` de `auto_rdv_poser` (SQL) sont la même formule** : modifier l'une sans l'autre refuse toute pose en `journee_modifiee`.
- **Lien = jeton HMAC `MDH_AUTO_RDV_SECRET`** (edge env), org toujours dérivée du contrat du jeton ; « Copier le lien » sur la carte À planifier pour tester ou poser par téléphone.
---

## [2026-09-30 09:00] Auto-RDV tranche 3 + règles moteur du 30/09 (souplesse, demi-journée, pause, retour dépôt)
**Statut** : PENDING
**Commit** : 11b5bf4..HEAD
**Contexte** : Cron `auto-rdv-cron` (invitations mensuelles, étiquetage des journées vides, relances), table `auto_rdv_invitations`, réglages `settings.tournees.auto_rdv`. Décisions d'Eric du 30/09 sur le moteur. Détail : `docs/MODULE_TOURNEES.md`.
**Proposition** (CLAUDE.md § Module Tournées, règles qui mordent) :
- **La souplesse est une variable du MOTEUR, pas une promesse au client** : au client on annonce un rang dans sa demi-journée (« 1er passage du matin »), sauf RDV figé (heure imposée). Défaut d'org = demi-journée (`souplesse_defaut_minutes = 240`). **La demi-journée est un engagement de DÉBUT** avec au moins la moitié du travail dedans (90 min → dernier début 11 h 15) ; l'amplitude borne la fin ; la pause (entière dans `pause_fenetre`) glisse, prise sur la route ; le retour au dépôt peut déborder l'amplitude de `tolerance_retour_depot_minutes`. Trajet max = DÉTOUR ajouté, pas tronçon brut.
- **L'auto-RDV réordonnance la journée entière** (`placerParSequencement`) et écrit les décalages des voisins avec le RDV (`auto_rdv_poser(..., p_decalages)`), tout ou rien. Le moteur ne change jamais un RDV de demi-journée ni de jour de lui-même.
- **Cron `auto-rdv-cron` gouverné par `settings.tournees.auto_rdv.enabled`** ; gabarit absent ou client sans e-mail ⇒ invitation `phone` (liste d'appels), journalisé ; filtres `in` par lots de 100 côté edge.
---

## [2026-09-30 14:00] Auto-RDV tranche 4 « Ranger » — onglet Tournées supprimé, journée ouverte depuis le Planning
**Statut** : PENDING
**Commit** : a4ebe70
**Contexte** : Spec auto-RDV § 9. `TourneesTab.jsx` (page Entretiens) supprimé ; `RemplirJourneePanel` monté par `Planning.jsx` au clic sur une puce d'état ; `JourneesAArbitrer` + `AlertesTournees` dans le Dashboard des entretiens ; CTA fiche contrat borné au mois. Détail : `docs/MODULE_TOURNEES.md` § « Auto-RDV : ranger ».
**Proposition** (CLAUDE.md § Module Tournées — deux phrases existantes deviennent fausses) :
- Remplacer « Pleine mais impossible → **tableau de bord de l'admin** (`JourneesAArbitrer`), pas l'onglet Tournées » par : « Pleine mais impossible → **Dashboard des entretiens** (`JourneesAArbitrer`, avec les filets `AlertesTournees`) ».
- Ajouter : **Remplir / figer une journée = sa puce d'état dans le Planning** (`RemplirJourneePanel`, seule porte de programmation au fil de l'eau ; l'onglet Tournées de la page Entretiens n'existe plus). Lien direct `/planning?journee=&tech=` via `lienJourneePlanning` (`tourneesPanelUtils.js`), jamais une URL recopiée. La journée affichée est dérivée en direct de `useEtatsJournees().journees`, jamais un objet capturé au clic.
- Ajouter : **CTA « Trouver le créneau » borné au mois par l'appelant** (`constraints.date_to` = `bornesMois(…, { delaiMinJours: 0 }).fin`) ; l'edge `slots-propose` appelée sans `date_to` (Hermes / MCP) propose encore au-delà — à borner côté edge avant de la brancher sur une machine.
---

## [2026-09-30 16:00] État d'une journée : budget du jour, journée sans adaptable, secteur du premier RDV
**Statut** : PENDING
**Commit** : 3e48be4
**Contexte** : Vendredi 16/10 lu dans le Planning avec Eric : journée figée et pleine affichée « Ouverte », vendredi jamais « plein », secteur tiré à l'alphabet. Détail : `docs/MODULE_TOURNEES.md` § « Lecture de l'état d'une journée ».
**Proposition** (CLAUDE.md § Module Tournées, règles qui mordent) :
- Compléter « **Budget** = `team_members.daily_work_minutes` » par : **plafonné chaque jour par l'amplitude moins la pause** (`budgetDuJour` dans `loaders.js`, source unique — ne jamais relire `daily_work_minutes` ailleurs dans le moteur) ; un vendredi 8 h – 16 h vaut 7 h.
- Ajouter : **une journée sans RDV adaptable n'est pas « ouverte » par défaut** — pleine + toutes les heures d'entretien communiquées ⇒ figée, pleine sinon ; `verdictJournee` renvoie le remplissage même en `sans_adaptable` (le cron, lui, n'y touche pas).
- Ajouter : **le premier entretien posé sur une journée vierge fixe son secteur** (`deduireSecteur`, `created_at`) ; plus de « secteur majoritaire ».
---

## [2026-09-30 17:30] Entretien refusé par le client ≠ « à faire »
**Statut** : PENDING
**Commit** : d7f9355
**Contexte** : 13 contrats actifs avec un refus 2026 (visite `cancelled`) restaient « À faire » dans Programmation (bouton Planifier, bulle SMS) et dans le compteur « Entretiens à faire ». Détail : `docs/MODULE_ENTRETIENS.md` § « Entretien de l'année refusé par le client ».
**Proposition** (CLAUDE.md § Module Entretiens, règles qui mordent) :
- **Un contrat dont le client a refusé l'entretien de l'année n'est pas « à faire »** : lecture unique `statutVisiteAnnee` / `compterVisitesAnnee` (`src/lib/entretienVisitStatus.js`) — jamais un test `current_year_visit_status === 'completed'` recopié dans un écran ou un compteur (tout le reste y devient « à faire », refus compris). Ni Planifier, ni SMS de rappel, ni CA à faire sur un refus.
---

## [2026-09-30 22:00] Module Chantiers — entité par devis (2026-09-30)
**Statut** : PENDING
**Commit** : 44321e4
**Contexte** : un chantier n'est plus une colonne du lead mais une ligne de `majordhome.chantiers` (1 lead → N chantiers, 1 devis validé → 1 chantier) : un lead qui signe deux devis (ex. PAC + poêle) a deux cartes, deux plannings d'installation, deux PV. Migrations `20260930_16..18` (à appliquer en prod, dans l'ordre), harnais `scripts/migration-rehearsal/assert-chantiers.sql`. Spec : `docs/superpowers/specs/2026-09-30-chantier-entite-par-devis-design.md` ; schéma : `docs/DATABASE.md` § majordhome.chantiers.
**Proposition** (CLAUDE.md, nouvelle section « Module Chantiers — entité par devis » + gotcha DB) :
- **Un chantier = une ligne de `majordhome.chantiers`, son `id` ≠ l'id du lead** : `majordhome_chantiers.id` est l'id du chantier, le lead est `lead_id`. Toute clé de cache, tout appel de mutation et toute jointure prennent l'id du chantier.
- **Un devis validé sans chantier en crée un** (trigger `chantier_ensure_for_quote`, sur la transition vers « validé ») ; un devis refusé ou éjecté ne supprime pas son chantier (carte ambre « aucun devis validé », suppression à la main via `chantier_delete`, refusée s'il reste devis validé / RDV / PV).
- **Les RDV d'installation portent `chantier_id`** (`appointments.chantier_id`, `lead_id` reste renseigné) ; `target_invoiced` (violet) se calcule par chantier, jamais par lead.
- **Écrire un chantier via `majordhome_chantiers_write`** (miroir simple updatable, `.eq('id', chantierId).eq('org_id', orgId)`, lire `{ error }`), **jamais via `update_majordhome_lead`** : les colonnes chantier de `leads` sont legacy (plus écrites, contraction à venir).
- **Grouper / détacher / supprimer = RPC** `chantier_group` / `chantier_detach` / `chantier_delete` (org_admin, team_leader via `role_can(…, 'chantiers', 'edit')`) ; aperçus par le module pur `src/lib/chantierSplit.js`. Ne jamais recopier l'allowlist des statuts de devis : `majordhome.chantier_quote_stats` (via `quote_status_bucket()`) est la seule définition de « devis validé » d'un chantier.
---
## [2026-10-01 10:30] Kanban chantiers — pose provisoire, appros qualifiées, date de réalisation figée
**Statut** : PENDING
**Commit** : a21d1b6, 211149f, 537fc81, 79bf5e4
**Contexte** : Eric programme souvent la pose avant d'avoir commandé. Le champ « Date estimative de réalisation » n'était pas utilisé ; le RDV d'installation le remplace. Les colonnes du kanban gardent le sens « ce qu'il reste à faire ». La colonne Réceptionné doit montrer la date de réalisation, figée.
**Proposition** (à ajouter à la section « Module Chantiers » quand elle sera intégrée) :
- **Pose provisoire = règle unique `poseProvisoire` / `approsRecues`** (`src/lib/installOrder.js`, testé) : une installation posée au planning est provisoire tant qu'Équipement et Matériaux ne sont pas en Reçu ou **N/A qualifié** (N/A = « rien à recevoir, prestation », c'est une réponse ; une case jamais renseignée = NULL = on ne sait pas, donc provisoire — ne jamais présélectionner N/A). Planning : bloc hachuré 45° (`mdh-provisional`, ⏳), appros chargées en 2ᵉ requête mergée en mémoire (`useAppointments`, la vue `majordhome_appointments` reste un miroir simple). Un chantier réceptionné/facturé n'est jamais provisoire.
- **Tout RDV d'installation posé place la carte en Planification, provisoire ou non** (règle inversée le 2026-10-07, Eric : « sinon c'est illisible » ; `syncCardStateOnCreate` sans garde `poseProvisoire`, reprise `20261007_1` des 6 chantiers datés restés en amont). Provisoire ne garde que la puce / le bloc hachurés. `updateOrderStatus` reste le filet : Commande à faire → Planification si un RDV existe, sinon À planifier. Planification possible dès Gagné. Re-cliquer un statut d'appro actif l'efface (retour à NULL).
- **Date de carte = `getChantierCardDate`** (`chantiers.service.js`) : réalisation figée si réceptionné/facturé, sinon RDV d'installation actif, sinon signature ; tri des colonnes sur cette date, décroissant. Le champ `estimated_date` n'est plus affiché ni écrit (colonne DB à retirer à la contraction).
- **`chantiers.realized_date` figée par trigger `chantiers_freeze_realized_date`** (20261001_2) au passage en realise/facture = dernier jour d'installation actif, écrite une seule fois (un PV signé 6 mois après ou un RDV déplacé ne la changent pas). Vue : `COALESCE(figée, dernier RDV posé)`, repli pour les chantiers nés réceptionnés sans RDV (NULL → la carte retombe sur la signature).
- **Harnais** : `majordhome.chantiers`, `chantier_quote_stats`, `majordhome_chantiers_write`, `chantier_ensure_for_quote()` sont dans les listes de `snapshot.mjs` depuis 20261001_2 (le trigger de prod cassait le chargement du schéma) ; la chaîne fixture + 20260930_16..18 ne se rejoue plus sur une photo récente (la table existe déjà, le trigger crée les chantiers à la fixture) — `assert-chantiers.sql` est figé sur la prod du 2026-09-30.
---

## [2026-10-01 14:30] Certificat d'entretien : la signature clôture en un geste, « Réalisé » avant le PDF
**Statut** : PENDING
**Commit** : (non commité — CertificatWizard.jsx, StepSignature.jsx)
**Contexte** : 7 certificats signés par Antoine (25/09 et 01/10) sans PDF ni bascule « Réalisé » : la clôture attendait un 2ᵉ bouton « Valider et générer le certificat PDF » jamais pressé après le toast « Signature enregistrée ». Preuve : syncEquipmentBack (1ʳᵉ instruction du bouton) n'avait jamais écrit marque/modèle alors que l'UPDATE passe pour son rôle. Depuis, « Valider la signature » enchaîne tout, et markRealise précède la génération du PDF.
**Proposition** : ajouter sous « Module Entretiens » : « **Certificat = un seul geste** : `CertificatWizard.handleSign` → `finaliser()` enchaîne signature → `markRealise` → PDF → Storage. `markRealise` passe TOUJOURS avant le rendu react-pdf (la carte du kanban ne dépend jamais d'un rendu réussi côté navigateur) ; sans ligne `certificats` en base, pas de clôture. Le bouton « Valider et générer » ne sert qu'à reprendre un certificat signé sans PDF. Ne jamais réintroduire une étape de validation après la signature. »
---

## [2026-10-06 14:00] Profils « maison » par organisation (tranches 1-2 livrées)
**Statut** : PENDING
**Commit** : cda54c9 → 4758b85 + tranche 2 (PermissionsEditor, TeamManagement)
**Contexte** : une org cliente a ses métiers (secrétaire, assistant commercial…). Un profil maison = libellé + MODÈLE standard (team_leader | commercial | technicien) ; seule la grille Droits d'accès le distingue de son modèle. Spec `docs/superpowers/specs/2026-10-06-profils-maison-par-org-design.md`, plans `2026-10-06-profils-maison-tranche-1-base.md` / `-tranche-2-ecrans.md`. Migrations `20261006_1_org_roles`, `20261006_2_org_roles_rpc` appliquées en prod le 2026-10-06.
**Proposition** (CLAUDE.md, section « Rôles & Permissions », après « Droits app-level ») :
- **Profils maison** : `majordhome.org_roles` (libellé + `base_role` ∈ team_leader|commercial|technicien, code immuable) et `member_org_roles` (au plus un par membre). **Le modèle est le rôle vu par tout le code en dur** (`user_effective_role`, `effectiveRole` front, edges `requiredRole`, rôle planning) ; `member_set_org_role` réaligne les champs `core` sur le modèle. Seule la grille distingue le profil : `role_can` consulte `role_permissions(org, code maison)` avant la chaîne modèle → défaut ; `resolvePermission(…, orgRoleCode)` reproduit la chaîne côté front (`useAuth().orgRole`, `useCanAccess().can`). `role_permissions.role` = standard OU code maison de la même org (trigger). Profil désactivé ⇒ `user_org_role_code` NULL ⇒ verdict du modèle. Changer de modèle = recréer (jamais d'UPDATE de `base_role`). Mesure : `permissions-coherence.mjs` section 4 ; tests `scripts/org-roles.test.mjs`, `scripts/permissions-resolve.test.mjs`. Non livré : « réinitialiser au modèle » (aucune RPC de suppression de surcharge).
---

## [2026-10-06 18:00] Module Climatisation — catalogue Solipac, moteur de dimensionnement, page /clim
**Statut** : PENDING
**Commit** : (non commité en fin de session)
**Contexte** : Import du tarif Solipac (60 articles Hitachi airHome / Airzone / liaisons) dans `supplier_products`, moteur pur `src/lib/clim/` testé sur le tarif réel, page `/clim` qui crée le devis d'un lead, réglages `settings.clim`. Le site Mayer copie le moteur (brief dans son dépôt).
**Proposition** : nouvelle section CLAUDE.md « Module Climatisation (dimensionnement → devis) » :
- **Catalogue Solipac** = `scripts/clim/import-tarif-solipac.mjs` ← `scripts/clim/data/solipac-2026-10.json` (fournisseur « SOLIPAC », `category='climatisation'`, `specs.canonical` porte type / kW / sorties / diamètres). Règles Eric 2026-10-06 : prix « par 3 / lot de 3 » = prix unitaire ; `purchase_price_ht` = net + DEEE ; **`selling_price_ht` saisi à la main dans Settings → Fournisseurs, jamais écrit par l'import** (nouvel article à 0 = « À CHIFFRER » sur le devis). CET 1,5 % = frais de commande, hors article.
- **Moteur PUR `src/lib/clim/`** (`config.js` + `dimensionnement.js`, `ENGINE_VERSION`), point d'entrée `dimensionner(releve, produits, cfg)`, testé `node --test scripts/clim/dimensionnement.test.mjs` (dans `audit:quality`) sur le tarif réel. **Copié tel quel par le site Mayer** (`C:\Dev\Landing Page - Mayer`, brief `docs/superpowers/specs/2026-10-06-simulateur-clim-design.md`) : toute modif de règle = ici + test + `ENGINE_VERSION`, puis recopie. Côté site, catalogue VIDE (besoins en kW, jamais de marque ni de prix).
- Règles chiffrées et « provisoires » dans `settings.clim` (Settings → Socle → Climatisation), jamais en dur. Le chauffage n'est pas calculé (module Thermique).
- Page `/clim` (`resource=devis`, module CRM) ; `?lead=<id>` → `CreateDevisModal` avec `initialLines` / `initialFamily` (section ÉQUIPEMENT = unités / groupe, ACCESSOIRES = liaisons). Lien « Dimensionner une climatisation » dans la section devis du lead.
- Gotcha : le jeton `SUPABASE_ACCESS_TOKEN` de `.env.local` était périmé (401) → import appliqué via le connecteur MCP `execute_sql` (un DO block de 22 Ko passe en un appel).
---

## [2026-10-06 21:00] Paramétrage des devis par entreprise (Settings → Socle → Devis)
**Statut** : PENDING
**Commit** : (voir git log « feat(devis): paramétrage des devis par entreprise »)
**Contexte** : Les familles d'installation, les chapitres de chaque famille et toutes les mentions du devis (titre, intro, acompte, conditions, mention spéciale, validité, signature, pied, bloc paiement, colonnes affichées) sont maintenant dans `settings.devis`, édités dans un écran à aperçu cliquable calqué sur l'éditeur de modèle Pennylane.
**Proposition** : section CLAUDE.md « Module Devis — paramétrage et modèle de document » :
- **`settings.devis` = source unique** (défauts = ancien code en dur) via `buildDevisConfig(settings)` (`src/lib/devisConfig.js`). `QUOTE_TEMPLATE_FAMILIES` / `FAMILY_DEFAULT_SECTIONS` de `devis.service` ne sont plus que les DÉFAUTS : tout écran passe la config (`buildDefaultSections(famille, config)`, `productCategoryForSection(section, famille, config)`, `famillesActives`). Une famille = `{ key immuable, label, actif, categorie produit du picker, sections }` ; les devis existants portent le label (`familleDe` résout key OU label).
- **Le picker du « + » d'une section** prend la catégorie de la SECTION si c'en est une (POÊLE, FUMISTERIE), sinon celle de la FAMILLE. Avant, « ÉQUIPEMENT » cherchait un fournisseur « equipement » : picker vide en silence (vécu clim 2026-10-06).
- **Modèle de document unique `src/lib/devisDocumentModel.js`** (`buildDevisDocumentModel`, `ZONES`, `exempleDevis`, testé dans `audit:quality`) : le PDF (`DevisPDF.jsx`) et l'aperçu (`settings/devis/ApercuDevis.jsx`) ne calculent ni ne formatent rien. Ajouter une zone = modèle + ZONES + PDF + aperçu. `generateDevisPdfBlob(model)` prend le modèle, plus `(data, company)`.
- Gotcha outillage (déjà en mémoire feedback_bash_heredoc_backslashes) : le Bash tool divise par deux les barres obliques inverses même dans un heredoc quoté ; un script Python inline qui veut écrire une apostrophe échappée produit une apostrophe nue (parse error vécu dans modules.js). Tout script contenant des barres obliques inverses passe par un fichier écrit avec Write.
---
