# Auto-RDV d'entretien mensuel — design

> Date : 2026-09-29 · Statut : à valider par Eric · Périmètre : module Entretiens / Tournées
> Précédents : `2026-09-12-planification-entretien-outils-machine-design.md` (contrat → créneaux),
> `2026-09-12-tournees-fenetres-et-consolidation-design.md` (souplesse),
> `2026-09-12-tournees-bloc-contrat-et-journee-pleine-design.md` (journée pleine, cron `tournees-figer`).

## 1. Le problème

Ce qui coûte du temps humain chez Mayer aujourd'hui, ce n'est pas l'optimisation des tournées, c'est **remplir les journées par téléphone** : appeler les clients dus, tomber sur un répondeur, rappeler, replanifier. Le module Tournées a réglé la question « dans quel ordre et à quel coût », pas la question « comment le client prend son rendez-vous sans qu'on l'appelle ».

En parallèle, l'app a accumulé six portes pour programmer un entretien (Kanban « À planifier », Programmation par grands secteurs, onglet Tournées, CTA fiche contrat, Planning, moteur d'appels en mock), et l'état d'une journée n'est visible nulle part : le cron de figeage écrit son rapport uniquement dans `net._http_response`, aucun écran ne dit « figée le 28 par le cron » ou « pleine mais impossible à figer ».

### Mesures (prod, 2026-09-29)

| Mesure | Valeur |
|---|---|
| Contrats dus (actifs, sans visite cette année, sans carte non terminale) | 184 |
| dont anniversaire (mois de `start_date`) en octobre / novembre | 33 / 24 |
| Clients géocodés parmi les dus | 182 sur 184 (2 au code postal seul, 0 sans rien) |
| Octobre 2026, Antoine (22 jours ouvrés) | 3 vides · 10 avec installation · 8 avec entretiens seuls · 1 autre |
| Octobre 2026, Ludovic (22 jours ouvrés) | 4 vides · 7 avec installation · 11 avec entretiens seuls |
| Mohammed | `include_in_routing = false`, 19 jours vides, 3 installations — installateur, hors entretien |

Lecture : le mois est déjà dense. Les places pour les entretiens sont **les dents creuses** — quelques journées vides et surtout les demi-journées restantes des journées qui portent déjà des entretiens. Trente-trois contrats à trois ou quatre par jour tiennent dans ce qui reste, à condition de regrouper par secteur.

## 2. Décisions d'Eric (2026-09-29), gravées

1. **Le client choisit une demi-journée**, jamais une heure. L'heure exacte lui parvient par SMS quand la journée est figée. Un contrat ne dépasse jamais une demi-journée.
2. **Plusieurs contrats par demi-journée.** Un seul contrat par demi-journée est économiquement impossible. La capacité réelle est calculée par le moteur (budget du technicien, trajets compris) ; cible indicative : quatre contrats par journée.
3. **Deux techniciens peuvent porter la même demi-journée** : ce sont deux créneaux distincts pour le client.
4. **Les installations sont posées à la main, un mois à l'avance.** On n'improvise pas. Les entretiens **complètent** les journées.
5. **Une journée est disponible par nature** : personne ne l'ouvre, c'est l'absence d'installation qui la laisse libre. L'humain n'ajoute pas de journées.
6. **Horizon = le mois en cours, borne dure.** Consommer une journée vierge du mois suivant pour un entretien est une erreur : elle appartient aux installations.
7. **Regroupement par secteur à la journée** (pas à la demi-journée) : une journée libre est dédiée à un grand secteur, le technicien n'en sort pas. Une journée qui porte déjà un entretien à Castres **est** une journée Castres : l'étiquette est déduite, la machine ne choisit un secteur que pour les journées entièrement vides.
8. **Tout automatique** : le 1ᵉʳ du mois la machine étiquette, envoie, et personne ne valide. Contrepartie exigée : **la page du client lit le planning en temps réel** ; le mail ne porte aucun créneau, seulement un lien.
9. Le client qui appelle avec une date imposée reste un geste humain dans le Planning, comme aujourd'hui ; ça fige de fait le secteur de la journée pour ce technicien.
10. Relance SMS aux non-répondants (« votre entretien approche, consultez vos mails »).

## 3. Les objets

### 3.1 `majordhome.journees_secteur` — l'étiquette de secteur d'une journée

| Colonne | Sens |
|---|---|
| `id`, `org_id` (org **core**), `created_at`, `updated_at` | |
| `date` | jour |
| `team_member_id` | technicien (org majordhome, comme `appointments`) |
| `grand_secteur` | même clé que `appointments.grand_secteur` (photo de `getGrandSecteurMaps`, org core) |
| `origine` | `deduite` (RDV déjà posé dans ce secteur) · `machine` (journée vide étiquetée par le cron) · `humain` (étiquette corrigée dans le Planning) |
| `figee_at`, `figee_par` | posés par `tournees_figer_journee` (`cron` ou `user:<uuid>`) — trace du figeage qui manque aujourd'hui |

Contraintes : `UNIQUE (org_id, team_member_id, date)` ; RLS scopée org, SELECT membres, écriture `org_admin` / `team_leader` via RPC, `GRANT SELECT TO service_role` ; vue publique `majordhome_journees_secteur` en `security_invoker`.

**L'état d'une journée n'est pas stocké**, il est dérivé à la lecture par `verdictJournee` (déjà partagé par le cron et le tableau de bord) : `vide` (aucun RDV, aucune étiquette) · `ouverte` (étiquetée, place restante) · `pleine` (reste utile < seuil) · `figee` (`figee_at` non NULL) · `a_arbitrer` (pleine mais impossible à séquencer). Une seule fonction, une seule définition, affichée partout pareil.

Ce que l'humain peut faire sur une étiquette : changer le secteur ou le technicien, la supprimer si la journée est encore vide. **Jamais en créer sur une journée hors du mois en cours.** Bloquer une journée = absence dans Settings → Équipe (`default_availability`), comme aujourd'hui.

### 3.2 `majordhome.auto_rdv_invitations` — le suivi d'une invitation

| Colonne | Sens |
|---|---|
| `id`, `org_id` (core), `contract_id`, `client_id`, `mois` (1ᵉʳ du mois) | `UNIQUE (org_id, contract_id, mois)` |
| `sent_at`, `email_to`, `mailing_log_id` | envoi du mail |
| `opened_at` | première ouverture de la page (pas du mail) |
| `booked_at`, `appointment_id`, `intervention_id` | pose réussie |
| `sms_relance_at` | relance J+7 |
| `escalade_appel_at` | passage en liste d'appels J+15 |
| `outcome` | `booked` · `no_slot` (page ouverte, aucune demi-journée possible) · `expired` (fin de mois sans pose) · `phone` (posé à la main après escalade) |

Le jeton n'est pas stocké : il est **signé HMAC, sans état**, comme celui de `mailing-unsubscribe` (`<type>.<contract_id>.<exp>.<sig>`, secret dédié `MDH_AUTO_RDV_SECRET`, expiration = dernier jour du mois 23 h 59). Le même jeton reste valable pour la relance SMS et pour l'opérateur au téléphone.

### 3.3 `majordhome.planification_runs` — le journal des crons

`org_id`, `job` (`tournees-figer` · `auto-rdv-ouverture` · `auto-rdv-relances`), `ran_at`, `dry_run`, `rapport jsonb` (ce qui a été fait, ce qui a été refusé et pourquoi), `duree_ms`, `erreur text`. Écrit par chaque edge à la fin de son passage, **même en cas d'échec**. Lu par le Dashboard entretiens. `tournees-figer` y écrit dès la tranche 1 : c'est ce qui rend son travail vérifiable.

## 4. Le cycle mensuel

### 4.1 Le 1ᵉʳ du mois, 6 h — `auto-rdv-cron` mode `ouverture`

Edge `verify_jwt:false` + `requireSharedSecret(MDH_CRON_SECRET)`, une entrée `cron.job` versionnée par migration (vérifiable par `SELECT jobname, schedule FROM cron.job`). Pour chaque org qui a `settings.tournees.auto_rdv.enabled = true` :

1. **Contrats à inviter** = contrats dus au sens de `getContratsDus` (actifs, `current_year_visit_status IS NULL`, sans carte d'entretien non terminale, un par client) dont l'anniversaire tombe dans le mois **ou est déjà passé sans visite** (retardataires, `retardStatus` du moteur). Sans les retardataires, un contrat de septembre non fait ne recevrait jamais de mail. Exclus : clients sans e-mail (ils vont directement en liste d'appels, `outcome = phone`, sans invitation), clients désinscrits du mailing, contrats sans adresse géocodable.
2. **Journées déduites** : pour chaque journée ouvrée du mois, par technicien inclus dans le routage, les RDV `maintenance` / `service` déjà posés donnent le grand secteur (photo `appointments.grand_secteur`, sinon résolu depuis le client). Une journée avec des entretiens de deux secteurs prend le secteur majoritaire. Étiquette `deduite`, réécrite à chaque passage tant que la journée n'est pas figée.
3. **Journées à étiqueter** : par secteur, `ceil(contrats_dus_secteur / capacite_cible)` journées, moins les journées déduites du secteur qui ont encore de la place, plus la marge `marge_pct`. Candidates = journées **vides** du mois (aucun RDV, aucune absence) d'un technicien **compétent** (`team_member_skills`, rôle `entretien`) pour les types d'équipement du secteur, à partir de `delai_min_jours` (2) après aujourd'hui. Choix : les plus proches dans le mois d'abord, en alternant les techniciens. Étiquette `machine`. Un secteur dont les dus tiennent dans les journées déduites n'en reçoit aucune. **Aucune journée hors du mois n'est jamais étiquetée.**
4. **Invitations** : une ligne par contrat, jeton signé, mail envoyé via Resend depuis l'edge (pattern `invoice-send`), gabarit `auto_rdv` éditable dans Settings → Communication → Emails, loggé dans `mailing_logs` (`campaign_name = 'auto_rdv'`, `is_transactional = true`, donc exclu du broadcast). Le mail contient : le prénom, l'équipement à entretenir, un bouton vers `APP_PORTAL_URL/rdv/<jeton>`, et le numéro de téléphone de l'org pour ceux qui préfèrent appeler.
5. **Journal** dans `planification_runs`.

Ce mode tourne aussi **chaque jour à 6 h en mode `relances`** (§ 6), qui ré-étiquette une journée vide supplémentaire dans un secteur dès que ses journées ouvertes dépassent `seuil_reouverture_pct` (75 %) de leur capacité — c'est ce qui évite d'étiqueter tout le mois d'un coup et de disperser les tournées.

### 4.2 Le lien — page publique `/rdv/:token`

Route publique de l'app (hors `ProtectedRoute`, comme `/login`), rendu React minimal, brandé par `buildCompanyInfo(settings)` de l'org du contrat. Elle parle à une seule edge, `auto-rdv` (`verify_jwt:false`, jeton obligatoire, limite 60 requêtes par jeton et par heure) :

- **`GET /auto-rdv?token=`** → `{ client: { prenom }, equipements: [...], creneaux: [...] }`. Les créneaux sont calculés **à l'instant de l'appel** : candidates = journées étiquetées du mois (secteur du contrat d'abord, puis les autres), fenêtre = matin ou après-midi (`demi_journee` des réglages), et pour chacune le moteur (`placerCandidat`, copie Deno de `src/lib/tournee/`) vérifie qu'il peut encore insérer ce contrat (durée barème) sans dépasser le budget ni `trajet_max_entre_clients_minutes`. On renvoie au plus `max_creneaux` (6), triés : secteur du contrat, puis date, puis coût. Chaque créneau porte la date, la demi-journée et le prénom du technicien. Aucune journée hors du mois, aucune journée figée, aucune journée avant `delai_min_jours`. Marque `opened_at` à la première ouverture.
- **`POST /auto-rdv`** `{ token, journee_secteur_id, demi }` → recalcul du placement pour ce créneau précis, puis **RPC `auto_rdv_poser`** (SECURITY DEFINER, `service_role` only, `REVOKE FROM PUBLIC, anon, authenticated`) qui, dans une transaction : relit les RDV de la journée et refuse (`journee_modifiee`) si leur nombre ou leur dernier `updated_at` a changé depuis le calcul (même mécanique tout-ou-rien que `tournees_figer_journee`), crée ou rattache la carte d'entretien (équivalent SQL de `ensureEntretienCard`), crée le RDV `maintenance` avec la souplesse demi-journée (`time_flex_minutes = 240`, `announced_start` = début de la demi-journée, durée barème), le technicien dans `appointment_technicians`, le `grand_secteur`, et met à jour l'invitation (`booked_at`, `outcome = booked`). Refus → la page recharge les créneaux et dit « cette demi-journée vient de se remplir ». Succès → écran de confirmation + mail de confirmation (gabarit `auto_rdv_confirmation`).
- Aucun créneau possible → la page affiche le téléphone de l'org, `outcome = no_slot`, le contrat passe **immédiatement** en liste d'appels (§ 6), sans attendre J+15.

Le client ne voit jamais : les autres clients, les adresses, le nom de famille du technicien, l'org_id. L'URL ne porte que le jeton.

### 4.3 Remplissage, figeage, heure de passage

Rien de nouveau dans le moteur. Une demi-journée pleine cesse d'être proposée (le `GET` ne la renvoie plus). Le cron `tournees-figer` existant fige la journée pleine à partir du lendemain, écrit `figee_at` / `figee_par` sur l'étiquette et son rapport dans `planification_runs`. Le SMS `heure_de_passage` part au figeage : **`figer_sms` passe à `true` dans cette livraison**, après vérification que le gabarit existe dans `settings.sms.templates` (il n'y est pas aujourd'hui, `campaign_template_missing` serait une information silencieuse, pas une erreur).

## 5. Ce que voient Philippe et Eric

- **Planning** : chaque journée porte un bandeau d'état (`vide` · `ouverte — secteur Gaillac-Nord, Lucas, 2 places` · `pleine` · `figée le 28/09 06:20 par le cron` · `à arbitrer`), calculé par `verdictJournee`. Clic sur le bandeau : corriger l'étiquette, « Remplir cette journée » (l'actuel `RemplirJourneePanel`, déplacé ici), « Figer ». C'est la **seule** porte de programmation au fil de l'eau.
- **Dashboard entretiens** : les journées à arbitrer (`JourneesAArbitrer`, déplacé ici), le journal des crons (dernier passage, ce qu'il a fait, ce qu'il a refusé), et le tableau de bord du mois : invitations envoyées / pages ouvertes / RDV pris / sans créneau / en liste d'appels.
- **Kanban « À planifier »** : une carte porte un badge « invité le 1ᵉʳ, page ouverte le 3 » ou « relancé par SMS le 8 », et un bouton « Copier le lien » pour poser par téléphone en réutilisant la même page. Les cartes escaladées (J+15, sans e-mail, sans créneau) sont **la** liste d'appels.
- **Fiche contrat** : le CTA « Trouver le créneau » reste (geste unitaire), mais ses propositions se limitent au mois en cours pour un entretien, comme la page client.

## 6. Relances et non-répondants — `auto-rdv-cron` mode `relances`, chaque jour 6 h

| Quand | Quoi |
|---|---|
| J+7 sans `booked_at` | SMS `auto_rdv_relance` (« Votre entretien approche, consultez vos mails ») via `sendCampaignSms` (`_shared/sms.ts`), une seule fois, si `settings.sms.enabled` |
| J+15 sans `booked_at` | `escalade_appel_at`, la carte apparaît en liste d'appels |
| Fin de mois sans `booked_at` | `outcome = expired` ; le contrat est **reconduit** le mois suivant (il est toujours dû) avec un compteur `relances` visible sur la carte |
| Sans e-mail dès le 1ᵉʳ | `outcome = phone` immédiat |
| Page ouverte, aucun créneau | `outcome = no_slot`, liste d'appels immédiate |

Le mode `relances` fait aussi le ré-étiquetage progressif (§ 4.1) et réécrit les étiquettes `deduite` des journées non figées.

## 7. Réglages — `settings.tournees.auto_rdv` (Settings → Entretiens → Tournées)

| Clé | Défaut | Sens |
|---|---|---|
| `enabled` | `false` | active le cycle mensuel pour l'org |
| `capacite_cible` | 4 | contrats par journée pour dimensionner l'étiquetage (la capacité réelle reste au moteur) |
| `marge_pct` | 20 | journées étiquetées en plus du strict besoin |
| `seuil_reouverture_pct` | 75 | remplissage à partir duquel une journée vide supplémentaire est étiquetée dans le secteur |
| `delai_min_jours` | 2 | pas de créneau avant J+2 |
| `max_creneaux` | 6 | créneaux affichés au client |
| `relance_sms_jours` / `escalade_appel_jours` | 7 / 15 | |
| `inclure_retardataires` | `true` | contrats dont l'anniversaire est passé sans visite |

Règle du projet : pas de réglage sans UI, l'onglet Tournées de Settings renvoie l'objet `tournees` complet (merge JSONB niveau 1). Gabarits : `auto_rdv`, `auto_rdv_confirmation` (Emails) ; `auto_rdv_relance`, `heure_de_passage` (SMS, registre `smsCampaigns.js` + `sync:tournee-engine`).

## 8. Sécurité multi-tenant

- L'org est **toujours dérivée du contrat porté par le jeton**, jamais du payload. Toutes les lectures et écritures filtrent `org_id`.
- `auto_rdv_poser` : SECURITY DEFINER, `SET search_path = majordhome, public`, `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, `GRANT TO service_role` ; audit via `has_function_privilege`. Gardes positives (`IS NOT TRUE`), jamais négatives.
- Jeton : HMAC-SHA256, comparaison timing-safe, expiration, secret dédié `MDH_AUTO_RDV_SECRET` (ne pas réutiliser `MDH_CRON_SECRET`, qui ouvre les crons).
- Edge `auto-rdv` : CORS restreint à `FRONTEND_ORIGINS`, réponses via `sanitizeError`, limite de débit par jeton en mémoire + refus au-delà.
- `journees_secteur`, `auto_rdv_invitations`, `planification_runs` : RLS dès la création, `GRANT SELECT TO service_role`, vues `majordhome_*` en `security_invoker=true`.
- Toute écriture d'edge lit `{ error }` et répond 5xx explicite.

## 9. Ce qui change dans l'UI existante (ménage)

- L'onglet **Tournées** de la page Entretiens disparaît. `RemplirJourneePanel` va dans le Planning (action de journée), `JourneesAArbitrer` et `AlertesTournees` dans le Dashboard entretiens. `TourneesTab.jsx` est supprimé (audit dead-code).
- Entretiens garde : Kanban, Contrats, Programmation, Dashboard, Clos.
- `SouplesseDialog` n'est plus proposé à la pose depuis l'auto-RDV (la souplesse est demi-journée par construction) ; il reste dans `EventModal` pour les poses à la main.
- Rien n'est retiré du moteur `src/lib/tournee/`.

## 10. Tests

- **Modules purs, testés en Node** (`node --test "scripts/tournee/*.test.mjs"`, dans `audit:quality`) : `src/lib/tournee/etiquetage.js` (journées déduites depuis des RDV, secteur majoritaire, nombre de journées à ouvrir, choix des journées vides, ré-étiquetage progressif, borne du mois) ; `src/lib/tournee/auto-rdv.js` (contrats à inviter pour un mois, créneaux proposables depuis un état de planning, tri, `max_creneaux`, calendrier des relances). Copiés pour Deno par `sync:tournee-engine` ; toute signature exportée documentée en JSDoc (`deno check`).
- **Migration** répétée sur `scripts/migration-rehearsal/` (étendre `snapshot.mjs` aux nouvelles tables et à `tournees_figer_journee`).
- **RPC `auto_rdv_poser`** : test SQL de la garde `journee_modifiee` (deux poses concurrentes sur la dernière place, une seule passe).
- **Edges** : `dry_run` sur les deux modes du cron, rapport dans `planification_runs` ; `auto-rdv` testée avec un jeton forgé (signature fausse → 401, expiré → 410, valide → créneaux).
- **Parcours de bout en bout, à faire par Eric sur un contrat de test** : mail reçu → page → pose → RDV dans le Planning et le Kanban → journée pleine figée par le cron → SMS heure de passage.

## 11. Hors périmètre

- **VROOM** (`VROOM-Project/vroom`, ou l'API Optimization d'openrouteservice) : remplacerait `sequence.js` / `creneaux.js` / la matrice Mapbox, pas les règles métier. Spike séparé quand le volume (800 contrats, 3ᵉ technicien) le demandera.
- Le moteur d'appels sortants (`PhoningPanel`, mock) : la liste d'appels de ce design est sa future file, mais le branchement téléphonie n'est pas ici.
- Préférence de technicien par client.
- Choix d'une heure précise par le client.
- Portail client authentifié (Sprint 8) : la page `/rdv/:token` est volontairement sans compte.

## 12. Découpage en tranches

1. **Voir** — `journees_secteur` (déduites seulement), `planification_runs`, `tournees-figer` écrit `figee_at` et son rapport, `verdictJournee` unifié, bandeau d'état dans le Planning, journal dans le Dashboard. Aucun envoi. Livrable seul, règle le « je ne sais pas si le cron l'a fait ».
2. **Proposer et poser** — `etiquetage.js` + `auto-rdv.js` (purs, testés), RPC `auto_rdv_poser`, edge `auto-rdv`, page `/rdv/:token`, bouton « Copier le lien » sur la carte Kanban. Testable en interne avant tout mail : l'opérateur ouvre la page du client et pose.
3. **Inviter et relancer** — edge `auto-rdv-cron` (ouverture + relances), invitations, gabarits mail et SMS, réglages `auto_rdv` dans Settings, `figer_sms = true` avec gabarit `heure_de_passage`, tableau de bord du mois. Activation `enabled = true` pour Mayer sur un mois test.
4. **Ranger** — suppression de l'onglet Tournées, déplacements dans Planning et Dashboard, CTA fiche contrat borné au mois.
