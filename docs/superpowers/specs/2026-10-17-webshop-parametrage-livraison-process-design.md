# Webshop — paramétrage de la livraison et du process de commande

**Date** : 2026-10-17 · **Demandeur** : Eric · **Statut** : conception, à valider
**Dépôts concernés** : Majord'home (`C:\Dev\Frontend-Majordhome`) et site Mayer (`C:\Dev\Landing Page - Mayer`, qui écrit dans la même base — cf. mémoire « site vitrine second consommateur »).

## 1. Pourquoi

Aujourd'hui, une commande webshop payée arrive en « Nouvelle » et **il ne se passe plus rien** : les colonnes Confirmée → Transmise fournisseur → Expédiée → Livrée sont de simples étiquettes déplacées à la main, aucun transporteur n'est prévenu pour les colis, le client ne reçoit ni e-mail d'expédition ni de livraison. Eric : « c'est un mauvais service ».

Côté palettes, l'envoi de la feuille de route existe, mais tout son paramétrage est invisible : e-mail du transporteur et adresse du dépôt en variables Vercel du site, règles des tournées codées en dur à plusieurs endroits.

**Principe directeur (Eric)** : « un usage sur Majord'home = une zone de paramétrage des variables pour éviter le codage en dur ». On met en paramètre tout ce qui est réglable, avec une valeur par défaut égale au comportement actuel, et on ajuste à l'usage.

## 2. Objectifs

1. Une tuile **Settings → Webshop** qui porte tous les réglages du webshop : livraison palette, colis, process, e-mails.
2. Le site et la base **lisent ces réglages** au lieu de leurs valeurs en dur / variables d'env.
3. Un **process de commande découpé** : à chaque passage de colonne, des actions paramétrables (ordre au transporteur, e-mail au client, rien).
4. Envoyer les **ordres de transport** : feuille de route aux transporteurs palette (existe, à paramétrer), ordre d'enlèvement au prestataire colis (nouveau, e-mail d'abord, API ensuite).

### Non-objectifs
- Plusieurs transporteurs palette ou plusieurs prestataires colis actifs en même temps (un de chaque, remplaçable).
- Colonnes du kanban configurables : les 7 statuts restent ceux du code (CHECK SQL) ; on y attache des actions.
- Cotation transport en temps réel au panier.
- Intégration API d'un transporteur palette.
- Paiement : clés Stripe, version d'API, expirations de session restent techniques (variables d'env / code) — ce ne sont pas des paramètres métier.

### Anti-objectifs (ce qui ferait échouer le projet même s'il « marche »)
- Une valeur métier qui reste en dur sans écran pour la changer, ou un réglage dont l'écran existe mais que le code n'utilise pas (échec silencieux).
- Un changement de statut qui annonce un succès alors que l'e-mail ou l'ordre de transport n'est pas parti.
- Un e-mail envoyé deux fois au client pour la même étape.

## 3. État des lieux (mesuré le 2026-10-17)

**Ce qui fait bouger une commande** : seul le paiement (webhook Stripe du site → RPC qui pose `status='nouvelle'`, `paid_at`). Tout le reste = glisser-déposer dans Majord'home (`src/lib/webshop/orders.js::statusPatch`, pose `shipped_at` / `delivered_at`). Triggers DB sur `webshop_orders` : recalcul des places de tournée + `updated_at`, rien d'autre.

**E-mails envoyés par le site** : confirmation client + e-mail interne au paiement ; feuille de route PDF (transporteur + interne) par le cron ; alertes internes du cron. Aucun e-mail d'expédition / livraison / annulation.

**Déjà en base mais sans écran** : `webshop_sectors` (9 secteurs, récurrence jsonb `[{week 1-4, weekday 1-5}]` sur cycle de 4 semaines, prix d'emplacement, plafonds arrêts/km/minutes), `webshop_sector_postcodes` (765 lignes), `webshop_shipping_rates` (grille colis au poids), `webshop_pickup_points` (Gaillac, Castanet). `settings.webshop.site_url` existe (écran `SiteUrlSetting`) mais n'est encore renseigné pour aucune org et n'est lu ni par le site ni par le SQL.

**Valeurs en dur à remonter** (inventaire complet fait le 2026-10-17, principaux) :

| Valeur | Où | Devient |
|---|---|---|
| `TRANSPORTEUR_EMAIL`, `BOUTIQUE_NOTIF_EMAIL`, `DEPOT_ADDRESS` | env Vercel du site | réglages |
| Libellé/adresse dépôt « Castanet-Tolosan » | site `feuille-de-route.ts`, MDH `src/lib/webshop/tournees.js::DEPOTS` | réglage `depots` |
| Fermeture J-2 | site `disponibilites.ts` + 3 fonctions SQL | réglage |
| Cron feuilles de route `0 17 * * *` (UTC, donc 18/19 h Paris) | pg_cron | réglage heure de Paris |
| Génération créneaux hebdo, horizon 12 semaines, ancre de cycle 2026-01-05 | site `creneaux.ts`, SQL | réglages |
| Capacité camion 10 emplacements | site `pricing.ts`, `creneaux.ts`, SQL, défaut de colonne | réglage |
| Prix emplacement : défaut colonne 4500 vs repli code 5500 (les 9 secteurs valent 5500) | SQL / site | défaut = réglage, prix réel = par secteur |
| TVA transport palette 10 %, port colis 20 %, max 20 colis/ligne, max 10 emplacements/panier | site `pricing.ts` | réglages |
| URL `https://www.mayer-energie.fr/api/boutique/cron/tournees` | fonctions SQL `webshop_run_daily_tours`, `webshop_slot_send_now` | `settings.webshop.site_url` |
| Expéditeur `Mayer Energie <contact@mayer-energie.fr>`, textes des e-mails, téléphone dans les messages d'erreur | site | réglages / gabarits |

## 4. Ce qui est décidé

### 4.1 La zone de paramétrage
- Route `/settings/webshop`, tuile dans le **socle** (le commerce est dans le socle, décision 2026-09-13), `adminOnly`, déclarée dans `src/lib/modules.js` (tuile + `ROUTES_PAR_MODULE.socle`), page sur le gabarit `pages/settings/SettingsPage.jsx`. Icône ajoutée à `ICONS` de `pages/Settings.jsx`.
- 4 onglets : **Livraison palette**, **Colis**, **Process**, **E-mails**.
- Le réglage existant « Site boutique » (`SiteUrlSetting`, aujourd'hui en tête de l'onglet Produits & tarifs) déménage dans cette zone.

### 4.2 Livraison palette
- **Transporteur** : nom, e-mail(s) destinataire(s) de la feuille de route, e-mail en copie interne, note libre (contact, horaires d'enlèvement).
- **Dépôts** : liste `{ code, libellé, adresse }` ; un secteur pointe un dépôt par son code (la colonne `webshop_sectors.depot` existe déjà). Remplace `DEPOTS` en dur côté MDH et `DEPOT_ADDRESS` côté site.
- **Règles des tournées** : délai de fermeture (J-n), envoi automatique de la feuille de route (oui/non) et son heure (heure de Paris), horizon de génération des créneaux (semaines), ancre du cycle de 4 semaines, capacité d'un camion (emplacements), prix d'emplacement par défaut d'un nouveau secteur, TVA transport palette, max emplacements par panier.
- **Secteurs** : écran d'édition des secteurs existants (libellé, dépôt, jours de passage dans le cycle, plafonds arrêts/km/minutes, prix, actif) et de leurs codes postaux.
- Le bouton « Envoyer au transporteur » de l'onglet Tournées reste le geste manuel ; il envoie au transporteur paramétré, et l'écran affiche à qui la feuille partira.

### 4.3 Colis
- **Prestataire** : nom, **mode d'envoi** `email` (fonctionne dès la livraison du projet) ou `api` (étape 3), e-mail destinataire des ordres, note (créneau d'enlèvement au dépôt).
- Grille de port au poids (`webshop_shipping_rates`), points de retrait (`webshop_pickup_points`), TVA du port, quantité max par ligne : éditables ici.
- Recherche faite le 2026-10-17 : prestataire API recommandé pour démarrer = **Boxtal** (sans abonnement, multi-transporteurs, webhooks signés) ; Sendcloud au-delà de ~50 colis/mois. Point dur : colis > 30 kg (Colissimo/Chronopost plafonnent à 30 kg). Eric doit choisir et ouvrir le compte ; rien de l'étape 3 ne démarre avant.

### 4.4 Process (déclencheurs)
- Pour chaque transition vers `confirmee`, `transmise_fournisseur`, `expediee`, `livree`, une liste d'actions activables :
  - **Ordre au prestataire colis** (n'a de sens que si la commande contient des colis) ;
  - **E-mail au client** (avec un gabarit choisi) ;
  - aucune.
- Les palettes ne passent pas par ces actions par commande : leur ordre de transport est la **feuille de route par tournée** (§ 4.2).
- **Le client est prévenu par envoi, pas par commande** (Eric, 2026-10-17) : « le client est prévenu quand la tournée palette part et quand elle est livrée ; pour une commande mixte, chaque envoi (colis puis palette) prévient le client séparément ». Une commande a donc jusqu'à deux envois — **colis** et **palette** — qui ont chacun leurs e-mails « expédié » / « livré », avec un contenu limité à leurs lignes :
  - **envoi colis** : déclenché par les transitions de la commande réglées dans le Process (le kanban suit le colis) ; ignoré si la commande n'a pas de ligne colis ;
  - **envoi palette** : déclenché par les **événements de la tournée** — « Tournée partie » et « Tournée livrée » — qui préviennent tous les clients payés de la tournée ; l'onglet Process règle ces deux événements comme les autres (gabarit, oui/non).
  - Pour une commande **100 % palette**, les événements de tournée font aussi avancer la carte (partie → Expédiée, livrée → Livrée) sans renvoyer d'e-mail. Une commande **mixte** n'est jamais déplacée automatiquement : sa carte suit le colis, la palette ne fait qu'envoyer ses e-mails.
- Valeurs par défaut proposées (supposition, ajustables à l'écran) : `expediee` → e-mail client « expédition » ; `livree` → e-mail client « livraison » ; `transmise_fournisseur` → ordre colis ; le reste → rien.

### 4.5 E-mails
- Expéditeur, adresse de réponse et adresse interne de notification : réglages (remplacent le FROM en dur et `BOUTIQUE_NOTIF_EMAIL`).
- Gabarits client (confirmation, expédition, livraison) et gabarit de la feuille de route : **gabarits transactionnels `mail_campaigns`** (`is_transactional=true`), créés d'un clic depuis l'onglet et édités dans Mailing → Éditeur — même mécanique que `facture_entretien`.
- Le téléphone et les liens (CGV, charte) des e-mails et messages d'erreur du site viennent de l'identité de l'org (`buildCompanyInfo`), pas d'un texte en dur.

### 4.6 Livraison en 3 étapes
1. **Zone de paramétrage + livraison palette** (§ 4.1, 4.2, partie réglages de 4.3 et adresses de 4.5) ; le site et le SQL lisent les réglages ; suppression des variables `TRANSPORTEUR_EMAIL` / `DEPOT_ADDRESS` / `BOUTIQUE_NOTIF_EMAIL` une fois les valeurs saisies.
2. **Process** : déclencheurs, e-mails client, ordre colis par e-mail, journal des actions (§ 4.4, gabarits de 4.5).
3. **API colis** : branchement du prestataire choisi (Boxtal a priori), étiquette + suivi en retour.

Chaque étape est livrable et utilisable seule.

## 5. Choix pris par Claude (à relire par Eric)

- **Stockage** : les réglages scalaires vont dans `core.organizations.settings.webshop` (un sous-objet par onglet), lus/écrits via `useOrgSettings()` ; toujours sauver l'objet `webshop` **complet** (merge JSONB niveau 1). Les listes ont déjà leurs tables (secteurs, codes postaux, tarifs colis, points de retrait) et y restent. Les dépôts, le transporteur palette et le prestataire colis sont dans `settings.webshop` (un de chaque, pas de table).
- **Défauts = comportement actuel** : chaque réglage absent retombe sur la valeur aujourd'hui en dur (J-2, 10 emplacements, 12 semaines, 10 % / 20 %…), définie une seule fois dans un module PUR `src/lib/webshop/reglages.js` (`buildWebshopConfig(settings)`, testé), sur le modèle de `buildPvConfig` / `reglages.js` des tournées d'entretien. Le site en a une copie (même contrat que le moteur clim / tournées : copie synchronisée, jamais éditée à la main).
- **Côté SQL** : un helper `majordhome.webshop_setting(p_org_id, p_path text[], p_default jsonb)` lu par les fonctions de fermeture J-n / génération / envoi ; l'URL du site vient de `settings.webshop.site_url` et l'envoi **échoue fort** (`site_url_missing`) si elle est vide, au lieu de viser mayer-energie.fr.
- **Heure d'envoi** : le job pg_cron devient horaire et n'agit que pour les orgs dont l'heure de Paris courante = l'heure réglée (gère l'heure d'été).
- **Changement de secteur** : s'applique aux créneaux générés ensuite ; les créneaux déjà générés qui portent des commandes ne bougent jamais. Un bouton « Régénérer les créneaux à venir sans commande » applique tout de suite.
- **Expéditeur des colis = le dépôt** (Eric : le prestataire « vient au dépôt et fait son job »). Pas de défaut pour l'action « ordre colis » : Eric choisit à l'écran la transition qui la déclenche (le moment où le colis est prêt au dépôt).
- **Événements de tournée = gestes manuels** « Marquer partie » / « Marquer livrée » dans le tiroir de la tournée (le statut `shipped` existe déjà côté tournée ; « partie » est à ajouter). Pas de passage automatique au jour de livraison : un camion qui ne part pas ne doit pas annoncer une livraison.
- **Idempotence par envoi** : le journal des actions est indexé (commande, envoi `colis|palette`, événement, action) — un même e-mail d'envoi ne part qu'une fois, même si la carte fait un aller-retour ou si la tournée est marquée deux fois.
- **Annulation hors périmètre** : `annulee` n'est pas une colonne du kanban et aucun geste d'annulation n'existe (seulement la suppression). Le process ne couvre que confirmee / transmise_fournisseur / expediee / livree ; un geste « Annuler » (remboursement, libération de place, e-mail) est un sujet à part.
- **Gabarits côté site (étape 2)** : la confirmation au paiement et la feuille de route, envoyées par le site, lisent leur gabarit `mail_campaigns` (rendu en TypeScript avec la même substitution `{{VAR}}` que Majord'home). Gabarit absent → le site envoie le texte actuel en repli **et le signale dans l'e-mail interne** ; jamais d'envoi sauté en silence.
- **Toutes les transitions de statut passent par l'edge**, retours en arrière compris (ils n'exécutent aucune action). Le front n'écrit plus `status` en direct (`statusPatch` déménage dans l'edge) ; les autres champs de la commande (notes…) gardent l'écriture actuelle. Droit requis = celui d'aujourd'hui (`RouteGuard resource="pipeline"`), vérifié côté edge par `requireOrgMembership` + `role_can(org, 'pipeline', 'edit')` — personne ne perd un geste.
- **Exécution du process** : le passage de colonne passe par une edge function `webshop-order-transition` qui pose le statut puis exécute les actions réglées. **Le statut est posé même si une action échoue** ; chaque action est tracée dans une table `majordhome.webshop_order_actions` (commande, transition, action, statut `sent|failed|skipped`, erreur, horodatage), l'échec s'affiche sur la carte et l'action est **rejouable**. Idempotence : une action déjà `sent` pour (commande, transition, action) n'est pas renvoyée — un aller-retour de carte ne renvoie pas l'e-mail.
- **E-mails client webshop non soumis au module Communication** : ce sont des e-mails transactionnels de vente (comme la confirmation déjà envoyée au paiement), pas de la prospection. Envoi via `_shared/mail.ts` / Resend comme `invoice-send`.
- **Ordre colis par e-mail** : un bon d'expédition PDF par commande (expéditeur = dépôt, destinataire, colis : poids, dimensions si connues, contenu, valeur), au format des champs qu'exigera l'API (§ 4.3), pour que l'étape 3 ne change pas le modèle.
- **Prix d'emplacement** : la valeur réelle reste par secteur ; le défaut de colonne (4500) est aligné sur le réglage « prix par défaut » au moment de la création d'un secteur depuis l'écran, et le repli 5500 du site est supprimé.

## 6. Contraintes

- Règles multi-tenant de CLAUDE.md : filtres `org_id`, RPC SECURITY DEFINER avec `REVOKE FROM PUBLIC, anon`, nouvelles tables avec RLS + `GRANT SELECT … TO service_role` si lues via vue, migrations versionnées répétées sur `scripts/migration-rehearsal/` (étendre le snapshot aux tables/fonctions webshop si absentes).
- **Le site est un second consommateur** : toute fonction SQL modifiée doit garder sa signature ou être déployée en coordination avec le site ; vérifier ses appelants dans `Landing Page - Mayer` avant tout changement.
- Le site lit les réglages en service_role sur `core.organizations` (org = `MAJORDHOME_ORG_ID`). Pendant la transition, il garde la variable d'env en repli **et le signale dans l'alerte interne** ; la variable est retirée quand le réglage est saisi.
- Écritures de réglages : `org_admin` (RPC `org_update_settings`). Écritures des tables secteurs / codes postaux / tarifs / points de retrait : `org_admin`, via vues writable ou RPC (jamais `.schema('majordhome')`).
- Pas de secret dans `settings` (lisible par les membres) : la clé API du prestataire colis (étape 3) ira dans Vault par org.
- PDF : formatters PDF-safe (gotcha Helvetica de CLAUDE.md).

## 7. Laissé au builder
- Découpage exact des composants et des sous-objets de `settings.webshop`.
- UI d'édition des 765 codes postaux (liste filtrable par secteur, ajout/retrait) et de la récurrence (grille semaines 1-4 × jours).
- Format du bon d'expédition PDF.
- Forme exacte des colonnes de `webshop_order_actions` et du rejeu.

## 8. Ouvert
- Choix du prestataire colis et ouverture du compte (Eric) — conditionne l'étape 3.
- Colis > 30 kg : transporteur à trouver chez le prestataire retenu.
- Les « Inscriptions » (campagnes) restent dans l'onglet Webshop pour l'instant ; leur place est à revoir hors de ce projet.
