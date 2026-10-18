# Webshop — étape 2 : le process (déclencheurs, e-mails client, ordre colis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand une commande change de colonne ou qu'une tournée part / est livrée, les actions paramétrées dans Settings → Webshop → Process partent toutes seules (e-mail au client par envoi, ordre d'enlèvement au prestataire colis), sont tracées et rejouables.

**Architecture:** Une logique PURE (`src/lib/webshop/process.js` + gabarits par défaut `src/lib/webshop/emailTemplates.js` + réglages `process` dans `reglages.js`) décide quoi envoyer ; une edge function unique `webshop-process` exécute (statut, e-mails Resend, journal) ; la base trace chaque action dans `majordhome.webshop_order_actions` (idempotence par envoi). Les modules purs sont copiés pour Deno par `npm run sync:tournee-engine` et pour le site Mayer à la main (test de copie).

**Tech Stack:** React 18 / React Query (Majord'home), Supabase Postgres + edge functions Deno, `_shared/mail.ts` (Resend), Next.js (site), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-17-webshop-parametrage-livraison-process-design.md` § 4.4, 4.5, 5 (étape 2 de § 4.6).

## Global Constraints

- **Le client est prévenu PAR ENVOI** (Eric, 2026-10-17) : envoi **colis** = déclenché par les transitions de la commande réglées dans le Process, ignoré si la commande n'a pas de ligne colis ; envoi **palette** = déclenché par les événements de tournée « partie » / « livrée », pour tous les clients payés non annulés de la tournée ; chaque e-mail ne parle que des lignes de son envoi.
- Commande **100 % palette** : les événements de tournée font aussi avancer la carte (partie → `expediee`, livrée → `livree`) **sans** déclencher les actions de transition. Commande **mixte** : jamais déplacée automatiquement.
- Transitions couvertes : vers `confirmee`, `transmise_fournisseur`, `expediee`, `livree`. **Annulation hors périmètre.**
- Défauts du Process : `expediee` → e-mail client `webshop_expedition_colis` ; `livree` → e-mail client `webshop_livraison_colis` ; tournée partie → `webshop_expedition_palette` ; tournée livrée → `webshop_livraison_palette` ; **ordre colis : aucune transition par défaut** (Eric choisit).
- **Le statut est posé même si une action échoue** ; chaque action est tracée (`sent | failed | skipped`), l'échec s'affiche sur la carte et se rejoue. **Une action `sent` pour (commande, envoi, événement, action) ne repart jamais** (aller-retour de carte, double clic, tournée marquée deux fois).
- Toutes les transitions de statut passent par l'edge (retours en arrière compris, sans action) ; le front n'écrit plus `status` en direct. Droit = `requireOrgMembership` + `role_can(org,'pipeline','edit')` (même périmètre que la route `/webshop`).
- Gabarit absent ⇒ action `failed` code `template_missing` (rejouable après création), jamais un envoi muet ni un texte en dur côté edge. Pas de prestataire colis saisi ⇒ `ordre_colis` `failed` code `prestataire_missing`. Client sans e-mail ⇒ `skipped` code `no_email`.
- E-mails client webshop **non soumis au module Communication** (transactionnels de vente). Expéditeur = `settings.from_email` + nom de marque (`orgBranding`), envoi par `_shared/mail.ts::sendResendEmail`, trace `mailing_logs` (`campaign_name` = clé du gabarit).
- Ordre colis = **e-mail HTML** au prestataire (tableau des champs du futur ordre API : expéditeur = dépôt, destinataire, lignes colis avec poids, valeur, n° de commande). Ruling Claude : pas de PDF en étape 2 (le spec disait « bon PDF ») — même contenu, l'API de l'étape 3 reprendra les mêmes champs.
- Multi-tenant CLAUDE.md : RPC SECURITY DEFINER `REVOKE … FROM PUBLIC, anon` (+ `authenticated` si service_role only), garde positive, `GRANT SELECT … TO service_role` sur toute table lue par vue ; vue `security_invoker=true` ; nouvelle table RLS dès la création. Migrations répétées sur `scripts/migration-rehearsal/`.
- Org des tables webshop = org **CORE**. Pas de preview tools ; vérifs `node --test`, `npm run audit:quality`, `npx vite build`, `deno check` sur l'edge.

## Review Focus

1. **Double déclenchement** (double clic, carte remise en arrière puis en avant, tournée « partie » cliquée deux fois, rejeu d'une action déjà `sent`) → un seul e-mail : index unique partiel + test (Task 2 assert, Task 1 test de `cleAction`).
2. **Commande mixte** (palette + colis) qui passe « Expédiée » : seul l'e-mail colis part, avec les seules lignes colis ; la tournée partie envoie ensuite l'e-mail palette et **ne déplace pas** la carte → tests Task 1.
3. **Commande non payée / annulée** rattachée à une tournée marquée partie : aucun e-mail, aucun déplacement → test Task 1 (`actionsPourTournee` ignore `!paid_at` et `annulee`).
4. **Resend en échec ou gabarit supprimé** : statut posé, action `failed` avec le code, carte marquée, « Rejouer » renvoie et passe `sent` → test de l'edge Task 3 (fonction pure `issueAction`) + bouton Task 4.
5. **Retour en arrière** (Expédiée → Confirmée) : aucune action, et `shipped_at` n'est pas effacé → test Task 1 (`actionsPourTransition` sur une transition sans réglage renvoie `[]`) ; règle existante de `statusPatch`.

---

### Task 1: Logique pure du process + gabarits par défaut

**Files:**
- Modify: `src/lib/webshop/reglages.js` (+ défauts/coercition `process`), `scripts/webshop-reglages.test.mjs`
- Create: `src/lib/webshop/process.js`, `src/lib/webshop/emailTemplates.js`, `scripts/webshop-process.test.mjs`
- Modify: `scripts/sync-tournee-engine.mjs` (copier `orders.js`, `reglages.js`, `process.js`, `emailTemplates.js` vers `supabase/functions/_shared/webshop/`), `package.json` (`audit:quality` += `scripts/webshop-process.test.mjs`)

**Interfaces:**
- Produces:
  - `WEBSHOP_REGLAGES_DEFAUT.process` :
    ```js
    {
      transitions: {
        confirmee:             { email_client: null, ordre_colis: false },
        transmise_fournisseur: { email_client: null, ordre_colis: false },
        expediee:              { email_client: 'webshop_expedition_colis', ordre_colis: false },
        livree:                { email_client: 'webshop_livraison_colis', ordre_colis: false },
      },
      tournee: { partie: { email_client: 'webshop_expedition_palette' }, livree: { email_client: 'webshop_livraison_palette' } },
    }
    ```
    `buildWebshopConfig` : clé de gabarit inconnue de `WEBSHOP_EMAIL_KEYS` → `null` ; `ordre_colis` non booléen → `false`. Le SQL ne lit pas `process` (pas de régénération obligatoire, mais Task 2 régénère `webshop_reglages_defaut()` pour rester aligné).
  - `emailTemplates.js` : `WEBSHOP_EMAIL_KEYS` = `['webshop_confirmation','webshop_expedition_colis','webshop_livraison_colis','webshop_expedition_palette','webshop_livraison_palette','webshop_feuille_route','webshop_ordre_colis']` ; `WEBSHOP_EMAIL_DEFAULTS[key] = { key, label, subject, html_body, is_transactional: true, destinataire: 'client'|'transporteur'|'prestataire' }` (textes FR, mêmes conventions que `src/lib/invoiceEmailTemplate.js`, corps habillé par le squelette d'org) ; `WEBSHOP_EMAIL_PLACEHOLDERS[key]` = liste des `{{VAR}}` disponibles. Variables communes : `{{CLIENT_NAME}} {{ORDER_NUMBER}} {{ITEMS}} {{DELIVERY_DATE}} {{DELIVERY_ADDRESS}} {{PICKUP_POINT}} {{BRAND_NAME}} {{ORG_EMAIL}} {{ORG_PHONE}}` ; `webshop_ordre_colis` ajoute `{{DEPOT_NAME}} {{DEPOT_ADDRESS}} {{PARCELS_TABLE}} {{TOTAL_WEIGHT}} {{DECLARED_VALUE}} {{CLIENT_PHONE}} {{CLIENT_EMAIL}}` ; `webshop_feuille_route` reprend les variables du site (`{{TOURNEE_DATE}} {{SECTEUR}} {{NB_ARRETS}} {{ITINERAIRE_URL}} {{ALERTES}}`).
  - `process.js` (pur, aucun import hors `./orders.js`, `./reglages.js`) :
    - `envoisDeCommande(lines) -> { colis: Line[], palette: Line[] }` (lignes `shippingKind` `parcel` / `pallet` ; `null` = hors boutique, ignoré).
    - `actionsPourTransition(cfg, order, lines, to) -> Array<{ envoi: 'colis', evenement: to, action: 'email_client'|'ordre_colis', gabarit: string }>` — `[]` si pas de ligne colis ou transition sans réglage ; `ordre_colis` utilise le gabarit `webshop_ordre_colis`.
    - `actionsPourTournee(cfg, order, lines, event: 'partie'|'livree') -> { actions: Array<{ envoi: 'palette', evenement: 'tournee_'+event, action: 'email_client', gabarit }>, statutCible: 'expediee'|'livree'|null }` — rien si `!order.paid_at` ou `status==='annulee'` ; `statutCible` seulement si la commande n'a QUE des lignes palette et que `canMoveTo(order.status, cible)`.
    - `variablesCommande({ order, lines, envoi, company, slot, depot }) -> Record<string,string>` (montants via `formatCents`, date FR, `{{ITEMS}}` = liste HTML échappée des seules lignes de l'envoi).
    - `cleAction({ orderId, envoi, evenement, action }) -> string`.

- [ ] **Step 1:** Tests `scripts/webshop-process.test.mjs` :
  - colis seul, `to='expediee'` défaut → 1 action `email_client` gabarit `webshop_expedition_colis` ; `to='confirmee'` → `[]` ;
  - palette seule, `to='expediee'` → `[]` ;
  - mixte, `to='expediee'` → 1 action colis ; `variablesCommande(... envoi:'colis')['{{ITEMS}}']` ne contient pas le nom du produit palette ;
  - `ordre_colis: true` sur `transmise_fournisseur` → 2 actions possibles selon réglage, gabarit `webshop_ordre_colis` ;
  - tournée `partie` : commande palette payée `confirmee` → action `tournee_partie` + `statutCible: 'expediee'` ; mixte → action, `statutCible: null` ; non payée → `{ actions: [], statutCible: null }` ; annulée → idem ; palette déjà `livree` + `partie` → `statutCible: null` ;
  - `cleAction` stable et distincte pour envois/événements différents ;
  - `variablesCommande` échappe `<script>` dans un nom de produit.
  - Dans `scripts/webshop-reglages.test.mjs` : défaut `process` intact ; gabarit inconnu → `null` ; `ordre_colis: 'oui'` → `false`.
- [ ] **Step 2:** `node --test scripts/webshop-process.test.mjs scripts/webshop-reglages.test.mjs` → FAIL.
- [ ] **Step 3:** Implémenter ; étendre `sync-tournee-engine.mjs` (le test de synchro de `audit:quality` couvre les nouvelles copies) ; `npm run sync:tournee-engine`.
- [ ] **Step 4:** Tests verts, `npm run audit:quality` vert.
- [ ] **Step 5:** Commit — `feat(webshop): logique pure du process et gabarits d'e-mail par défaut`

---

### Task 2: Base — journal des actions et événements de tournée

**Files:**
- Create: `supabase/migrations/20261019_1_webshop_process.sql`, `scripts/migration-rehearsal/assert-webshop-process.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (si besoin)

**Interfaces:**
- Produces:
  - Table `majordhome.webshop_order_actions` : `id uuid pk`, `org_id uuid not null` (core), `order_id uuid not null → webshop_orders on delete cascade`, `envoi text check in ('colis','palette')`, `evenement text not null` (`confirmee|transmise_fournisseur|expediee|livree|tournee_partie|tournee_livree`), `action text check in ('email_client','ordre_colis')`, `gabarit text`, `status text check in ('sent','failed','skipped')`, `error_code text`, `error_message text`, `recipient text`, `slot_id uuid null`, `created_at`, `updated_at`. **Index unique partiel** `(order_id, envoi, evenement, action) WHERE status = 'sent'`. RLS : SELECT membres de l'org ; aucune écriture `authenticated`. `GRANT SELECT … TO service_role`.
  - Vue `public.majordhome_webshop_order_actions` (`security_invoker=true`, SELECT).
  - `public.webshop_order_action_record(p_org_id uuid, p_order_id uuid, p_envoi text, p_evenement text, p_action text, p_gabarit text, p_status text, p_error_code text, p_error_message text, p_recipient text, p_slot_id uuid) RETURNS uuid` — SECURITY DEFINER, **service_role only** (`REVOKE … FROM PUBLIC, anon, authenticated`) ; vérifie `order.org_id = p_org_id` ; si une ligne `failed`/`skipped` existe pour la même clé, la met à jour (rejeu) au lieu d'insérer ; conflit `sent` existant → `RAISE 'already_sent'`.
  - `public.webshop_order_action_already_sent(p_order_id uuid, p_envoi text, p_evenement text, p_action text) RETURNS boolean` — service_role only.
  - Colonnes `webshop_delivery_slots.departed_at timestamptz`, `delivered_at timestamptz` (pas de nouveau statut : la CHECK reste `open|closed|shipped|cancelled`), ajoutées **en fin** de la vue `majordhome_webshop_delivery_slots`.
  - `public.webshop_slot_mark_event(p_slot_id uuid, p_event text) RETURNS jsonb` — SECURITY DEFINER, garde `webshop_slot_guard` (team_leader+, comme 20261013_2) ; `partie` : exige `status='closed'` (`slot_not_closed`), pose `departed_at` si NULL ; `livree` : exige `departed_at` non NULL (`slot_not_departed`), pose `delivered_at` + `status='shipped'` ; idempotent ; retourne `{ slot_id, event, first_time: boolean }`.
  - Régénérer `majordhome.webshop_reglages_defaut()` (`node scripts/gen-webshop-reglages-sql.mjs`) dans la même migration.

- [ ] **Step 1:** Assert : RPC record refusée à `authenticated` ; `already_sent` empêche un 2ᵉ `sent` ; `failed` puis rejeu `sent` = 1 seule ligne ; mauvais org → refus ; `mark_event('partie')` sur une tournée `open` → `slot_not_closed` ; `livree` avant `partie` → `slot_not_departed` ; deux `partie` → `first_time` faux la 2ᵉ fois ; membre non team_leader → refus ; `has_function_privilege('anon', …)` faux partout ; vue `security_invoker`.
- [ ] **Step 2:** Harnais → FAIL. **Step 3:** migration. **Step 4:** harnais vert (avec 20261017_1, 20261017_2, 20261018_1 rejouées avant). **Ne pas appliquer en prod** (Task 7).
- [ ] **Step 5:** Commit — `feat(webshop): journal des actions du process et événements de tournée`

---

### Task 3: Edge function `webshop-process`

**Files:**
- Create: `supabase/functions/webshop-process/index.ts`, `supabase/functions/webshop-process/logic.ts` (fonctions pures testables : `issueAction`, `construireEmail`), `supabase/functions/webshop-process/logic.test.ts` (Deno test)
- Modify: `supabase/config.toml` (`[functions.webshop-process] verify_jwt = true`)

**Interfaces:**
- Consumes: `_shared/webshop/{process,reglages,emailTemplates,orders}.js` (Task 1), `_shared/auth.ts::requireOrgMembership`, `_shared/mail.ts::{sendResendEmail, applyPlaceholders, wrapWithSkeleton, orgBranding, brandingReplacements, insertMailingLog, escapeHtml}`, RPC Task 2.
- Produces (HTTP POST, JSON, `Authorization: Bearer <jwt utilisateur>`) :
  - `{ kind: 'transition', order_id, to }` → vérifie `role_can(org,'pipeline','edit')` (RPC existante ou requête équivalente — si aucune voie n'existe côté edge, utiliser `user_effective_role` + registre ; à vérifier, sinon `NEEDS_CONTEXT`) ; `canMoveTo` ; écrit `statusPatch` via la vue `majordhome_webshop_orders_write` (`.eq('org_id', org)`) ; exécute `actionsPourTransition` ; renvoie `{ order, actions: [{ id, action, envoi, status, error_code }] }`. Transition interdite → 409 `invalid_transition`.
  - `{ kind: 'tournee', slot_id, event }` → `webshop_slot_mark_event` (avec le JWT de l'utilisateur, la garde est en base) ; pour chaque commande payée non annulée du créneau : `actionsPourTournee` ; e-mails palette ; `statutCible` appliqué via `statusPatch` ; renvoie `{ slot, orders: [{ order_id, statut_applique, actions }] }`.
  - `{ kind: 'retry', action_id }` → relit l'action (org vérifiée), refuse `sent` (409 `already_sent`), rejoue, met à jour la même ligne.
  - Chaque e-mail : gabarit `majordhome_mail_campaigns` (`key`, `is_archived=false`, org) ; absent → action `failed`/`template_missing`. Destinataire : client = `order.email` ; ordre colis = `cfg.colis.prestataire.emails` (+ `cfg.emails.interne` en copie) ; vide → `failed`/`prestataire_missing`. Avant chaque envoi : `webshop_order_action_already_sent` → `skipped` sans envoyer si vrai. Trace `mailing_logs`.
  - Erreurs codées : `invalid_transition` 409, `not_found` 404, `forbidden` 403, `already_sent` 409. L'échec d'une action n'échoue jamais la requête (200 avec les actions `failed`).

- [ ] **Step 1:** `logic.test.ts` : `issueAction` (Resend OK → `sent` ; Resend erreur → `failed`/`resend_failed` ; gabarit null → `failed`/`template_missing` ; e-mail client vide → `skipped`/`no_email`) ; `construireEmail` remplace les variables et habille le corps.
- [ ] **Step 2:** `deno test supabase/functions/webshop-process/logic.test.ts` → FAIL. **Step 3:** implémenter. **Step 4:** `deno test` vert + `deno check supabase/functions/webshop-process/index.ts`.
- [ ] **Step 5:** Commit — `feat(webshop): edge webshop-process (transitions, tournées, rejeu)` — **pas de déploiement** (Task 7).

---

### Task 4: Commandes — transitions par l'edge, journal et rejeu

**Files:**
- Create: `src/shared/services/webshopProcess.service.js` (`transition(orderId, to)`, `tourneeEvent(slotId, event)`, `retry(actionId)`, `getActions(orgId, orderIds)` via la vue), `src/apps/artisan/components/webshop/orders/OrderActions.jsx` (journal + « Rejouer »)
- Modify: `src/shared/hooks/useWebshop.js` (mutation `transitionOrder` via `unwrapResult` ; query `useWebshopOrderActions(orderIds)` ; invalidations commandes + actions), `src/shared/hooks/cacheKeys.js` (`webshopKeys.actions(orgId, …)`), `OrdersTab.jsx` (drag → `transitionOrder`), `OrderDrawer.jsx` (`changeStatus` → `transitionOrder`, section `OrderActions`), `OrderCard.jsx` (pastille « Envoi échoué » si une action `failed`), `src/lib/webshop/orders.js` (`orderBadges` accepte `actions` optionnel), `scripts/webshop-orders.test.mjs`

**Interfaces:**
- Consumes: edge Task 3 (`supabase.functions.invoke('webshop-process', { body })`), vue Task 2.
- Après une transition, toast résumant les actions : « Commande Expédiée — e-mail client envoyé » / « … — e-mail client en échec (gabarit manquant) » (`toast.warning`) ; jamais « succès » si une action est `failed`. Libellés FR des codes dans un helper pur `libelleErreurAction(code)` de `orders.js` (`template_missing`, `prestataire_missing`, `no_email`, `resend_failed`, `already_sent`).
- `updateOrder` reste pour les autres champs (notes, …) ; **plus aucun appel avec `status`** (grep `statusPatch` hors edge et tests → seulement l'edge).

- [ ] **Step 1:** Tests `webshop-orders.test.mjs` : `orderBadges` avec une action `failed` → pastille `{ key: 'action_failed', tone: 'warning' }` ; `libelleErreurAction('template_missing')` FR ; code inconnu → code brut.
- [ ] **Step 2:** FAIL → implémenter → vert. **Step 3:** `npm run audit:quality`, `npx vite build`.
- [ ] **Step 4:** Commit — `feat(webshop): changement de colonne par le process, journal des envois et rejeu`

---

### Task 5: Tournées — « Marquer partie » / « Marquer livrée »

**Files:**
- Modify: `src/apps/artisan/components/webshop/tournees/TourneeDrawer.jsx`, `src/shared/hooks/useWebshopTournees.js` (mutation `markEvent` → `webshopProcessService.tourneeEvent`), `src/lib/webshop/tournees.js` (`slotStatusLabel` : « Partie le … » si `departed_at`, « Livrée le … » si `delivered_at`), `scripts/webshop-tournees.test.mjs`, `src/shared/services/webshopTournees.service.js` (`SLOT_COLS` += `departed_at, delivered_at`)

**Interfaces:**
- Boutons visibles `isTeamLeaderOrAbove` : « Marquer partie » si `status='closed'` et `departed_at` NULL ; « Marquer livrée » si `departed_at` et pas `delivered_at`. `ConfirmDialog` qui annonce combien de clients seront prévenus (commandes payées non annulées avec lignes palette). Toast = bilan `{ e-mails envoyés / en échec, cartes déplacées }`.

- [ ] **Step 1:** Test `slotStatusLabel` avec `departed_at` / `delivered_at`. **Step 2:** FAIL → vert. **Step 3:** `audit:quality`, `vite build`. **Step 4:** Commit — `feat(webshop): tournée partie / livrée, clients palette prévenus`

---

### Task 6: Settings → Webshop — onglets Process et E-mails

**Files:**
- Create: `src/apps/artisan/pages/settings/webshop/ProcessTab.jsx`, `src/apps/artisan/pages/settings/webshop/EmailsWebshopTab.jsx`
- Modify: `WebshopSettings.jsx` (2 onglets de plus), `src/lib/webshop/settingsForm.js` + `useWebshopReglagesForm.js` (champs `process`), `scripts/webshop-settings-form.test.mjs`

**Interfaces:**
- Process : un bloc par colonne (Confirmée, Transmise fournisseur, Expédiée, Livrée) — « E-mail au client (colis) » : sélecteur parmi les gabarits client + « Aucun » ; « Ordre d'enlèvement au prestataire colis » : case. Bloc « Tournées palette » : e-mail à « partie » / « livrée ». Sauvegarde = objet `webshop` complet (règle niveau 1). Une ligne d'aide : « Les palettes partent par la feuille de route ; le client palette est prévenu par les événements de tournée. »
- E-mails : liste des 7 gabarits (`WEBSHOP_EMAIL_DEFAULTS`) avec état « créé / à créer » lu dans `majordhome_mail_campaigns` (org), bouton « Créer » (insère le défaut, même voie que `EmailsTab.jsx` pour `facture_entretien` — la réutiliser, ne pas en écrire une 2ᵉ), lien « Modifier » vers Mailing → Éditeur, variables disponibles affichées. Avertissement si un gabarit référencé par le Process n'existe pas.

- [ ] **Step 1:** Tests `settingsForm` : aller-retour `process` form ↔ `webshop` ; gabarit « Aucun » → `null`. **Step 2:** FAIL → vert. **Step 3:** `audit:quality`, `vite build`. **Step 4:** Commit — `feat(settings): Webshop — onglets Process et E-mails`

---

### Task 7: Site Mayer — confirmation et feuille de route sur gabarits

**Files (dépôt `C:\Dev\Landing Page - Mayer`, branche `feat/webshop-process` depuis `origin/main`) :**
- Create: `lib/boutique/emailTemplates.js` (copie identique), `lib/boutique/gabarits.ts` (`getGabarit(key)` : lit `majordhome_mail_campaigns` en service_role pour `MAJORDHOME_ORG_ID`, cache 60 s ; `rendre(gabarit, variables)` = remplacement `{{VAR}}` comme `applyPlaceholders`)
- Modify: `lib/boutique/emails.ts` (confirmation client = gabarit `webshop_confirmation`, variables construites depuis la commande), `lib/boutique/livraison/emails-tournee.ts` (feuille de route = `webshop_feuille_route`) ; gabarit absent ou illisible → **défaut de `WEBSHOP_EMAIL_DEFAULTS`** (même texte que l'écran « Créer ») + alerte interne « gabarit X absent, texte par défaut utilisé » ; `scripts/reglages-copie.test.mjs` étendu à `emailTemplates.js` ; tests `livraison`/`boutique` adaptés.

- [ ] **Step 1:** Tests : rendu d'un gabarit avec variables ; repli défaut + alerte ; copie identique. **Step 2:** FAIL → vert ; `npm run build`. **Step 3:** Commit sur la branche — **pas de push** (Task 8).

---

### Task 8: Mise en production

- [ ] Appliquer `20261019_1_webshop_process.sql` (MCP `apply_migration`, sinon API de management + inscription `schema_migrations` comme le 2026-10-18) ; vérifier privilèges (`has_function_privilege('anon'|'authenticated', …)`), vue `security_invoker`.
- [ ] Déployer l'edge `webshop-process` (MCP `deploy_edge_function` avec `_shared/auth.ts`, `_shared/mail.ts`, `_shared/webshop/*` ; sinon `supabase functions deploy webshop-process --project-ref ejqqqwudmizqisdkxohw`) ; `verify_jwt=true`.
- [ ] Pousser Majord'home (`pull --rebase --autostash`, push), suivre Vercel jusqu'à READY.
- [ ] Site : push branche, PR, checks verts, merge squash, déploiement READY ; pages `/boutique`, `/commande` en 200.
- [ ] Mettre à jour la mémoire `project_webshop_parametrage_livraison.md` ; dire à Eric : créer les gabarits (Settings → Webshop → E-mails), choisir la transition de l'ordre colis quand le prestataire sera connu.
