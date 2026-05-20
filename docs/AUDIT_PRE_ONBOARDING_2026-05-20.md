# Audit pré-onboarding multi-tenant — Majord'home

**Date** : 2026-05-20 (Phase 1 + Phase 2 DB)
**Auteur** : Eric Pudebat (avec assistance audit auto)
**Périmètre Phase 1** : Repo `Frontend-Majordhome` (branche `main`, commit `5c70d71`), edge functions Supabase versionnées localement, workflows N8n versionnés dans `docs/n8n/workflows/`
**Périmètre Phase 2** : RLS Postgres (policies + tables sans RLS), RPCs `SECURITY DEFINER` (grants + code source via pg_proc), vues `public.majordhome_*`, storage policies, Supabase Security Advisor — voir **Annexe E**.

> ⚠️ **Mise à jour 2026-05-20** : la Phase 2 a révélé que **la couche DB est bien plus défaillante que le codebase**. Plusieurs bombes structurelles (vues SECURITY DEFINER massives, `exec_sql` exécutable par `authenticated`, 24 RPCs sensibles exposées à `anon`, storage `contracts/certificats` ouvert). **Le plan P0 initial est insuffisant — voir Annexe E pour la Semaine 0 de hardening DB ajoutée.**

---

## 1. Contexte et objectif

Le SaaS Majord'home tourne aujourd'hui pour **un client unique** (Mayer Énergie, Gaillac). Une **2ème entreprise sans lien capitalistique** doit rejoindre la **même instance Supabase** sous moins d'un mois. L'isolation entre les deux orgs repose actuellement sur :

1. La colonne `org_id` présente partout en DB
2. Les filtres `org_id` explicites côté services applicatifs
3. Les Row Level Security (RLS) policies côté Postgres (non auditées dans ce rapport — Phase 2)

**Objectif de l'audit** : identifier tous les points de rupture d'isolation, les failles de sécurité critiques exposées sur Internet, et la dette technique qui empêche d'opérer durablement à 2 clients.

**Décisions prises** :
- **Approche A** : hardening big bang, 3-4 semaines de consolidation avant ouverture
- Phase 2 audit DB à lancer dans une session séparée (Supabase MCP)
- Roadmap fonctionnelle en pause durant la consolidation

---

## 2. Méthodologie

Trois audits READ-ONLY parallèles ont été exécutés sur le repo :

1. **Audit isolation multi-tenant** — recherche exhaustive d'org_ids hardcodés, services sans filtre `org_id`, cache keys React Query, storage paths, hooks d'auth, webhooks N8n, branding hardcodé
2. **Audit sécurité edge functions** — verify_jwt, auth alternative (Svix, HMAC), validation inputs, CORS, secrets, SQL injection, autorisation par org, rate limiting, leak d'erreurs, service role usage, idempotence
3. **Audit sécurité front + dette technique** — XSS, secrets en clair, auth bypass, RBAC, logs sensibles, localStorage, deps vulnérables, env vars, fichiers > 500 LOC, TODO/FIXME, console.*, tests, eslint, vite config

Chaque finding est référencé par `fichier:ligne` et catégorisé `CRITICAL` / `HIGH` / `MEDIUM` / `LOW`.

---

## 3. Synthèse exécutive

### 3.1 Scoring global

#### Phase 1 — Codebase
| Axe | CRITICAL | HIGH | MEDIUM | LOW | Total |
|---|---:|---:|---:|---:|---:|
| Isolation multi-tenant (codebase) | 6 | 10 | 18 | 6 | 40 |
| Sécurité edge functions | 4 | 5 | 11 | 8 | 28 |
| Sécurité front + dette tech | 3 | 6 | 6 | 8 | 23 |
| Sous-total Phase 1 | 13 | 21 | 35 | 22 | 91 |

#### Phase 2 — Couche DB (Supabase Advisor + audits SQL)
| Axe | CRITICAL | HIGH | MEDIUM | LOW | Total |
|---|---:|---:|---:|---:|---:|
| Vues SECURITY DEFINER (RLS bypass) | 1 (×112) | — | — | — | 112 |
| Tables sans RLS exposées PostgREST | 19 | — | — | — | 19 |
| Policies RLS permissives `USING (true)` | 9 | — | — | — | 9 |
| RPCs SECURITY DEFINER granted `anon` | 24 | — | — | — | 24 |
| RPCs SECURITY DEFINER granted `authenticated` (à auditer) | — | 195 | — | — | 195 |
| Storage policies trop ouvertes | 3 | — | — | — | 3 |
| `exec_sql` accessible authenticated (lecture totale DB) | 1 | — | — | — | 1 |
| `function_search_path_mutable` | — | — | 183 | — | 183 |
| HaveIBeenPwned auth disabled | — | 1 | — | — | 1 |
| Sous-total Phase 2 | **~30 distincts** | **~20** | **~50** | **~5** | **725 lints** |

#### TOTAL agrégé
| Sévérité | Phase 1 | Phase 2 | **TOTAL** |
|---|---:|---:|---:|
| CRITICAL | 13 | ~30 | **~43** |
| HIGH | 21 | ~20 | ~41 |
| MEDIUM | 35 | ~50 | ~85 |
| LOW | 22 | ~5 | ~27 |

### 3.2 Verdict

**L'instance Supabase actuelle ne peut absolument pas accueillir une 2ème entreprise en l'état.** L'isolation multi-tenant est dans un état **bien plus dégradé** que ce que le codebase laissait deviner.

Phase 1 avait identifié 2 classes de problèmes graves :

1. **Plusieurs points de fuite cross-org effectifs** (codebase) : SQL libre côté client, cache keys sans `org_id`, storage paths sans préfixe org, `pennylane-proxy` ouvert post-auth, branding Mayer hardcodé partout.
2. **Edge functions critiques publiquement appelables sans authentification** : `pennylane-sync-cron`, `pennylane-backfill-quotes` ouverts sur Internet.

Phase 2 a ajouté **4 bombes structurelles côté DB** :

3. **`public.exec_sql(query_text text)` exécutable par `authenticated`** : la fonction est SECURITY DEFINER, filtre SELECT/WITH only, mais permet la **lecture sans RLS de toute la base**. Un user de l'org B exécute `SELECT * FROM majordhome.clients` et lit tous les clients Mayer. CVSS estimé 9.8.
4. **112 vues SECURITY DEFINER** (dont les 73 vues `public.majordhome_*` qui alimentent le frontend) : la RLS appliquée sur les tables sous-jacentes est **intégralement contournée** dès qu'on lit via ces vues. La sécurité réelle ne repose que sur le filtre applicatif `.eq('org_id', orgId)` — soit la **pire stratégie de défense** en multi-tenant.
5. **24 RPCs SECURITY DEFINER exposées à `anon`** : incluant `delete_organization`, `update_user_role`, `update_member_role`, `update_majordhome_lead`, `find_or_create_client`, etc. N'importe qui sur Internet peut tenter de les appeler.
6. **Storage `contracts`, `certificats`, `product-documents` : policies ALL pour tout authentifié, sans aucun filtre** — un user de l'org B peut télécharger / écraser / supprimer **tous** les contrats Mayer signés et tous les certificats d'entretien.

S'y ajoutent : 19 tables `majordhome.*` sans RLS du tout, 9 policies `USING (true)` qui rendent leurs tables totalement publiques aux `authenticated`, et le fait que l'**instance Supabase héberge 4+ apps non-Majord'home** (Pack Vendeur 26 edges, Baikal, Towercontrol, Snapstudio, Arpet, Karedas, Zelty) — la surface d'attaque est **massive**.

Le plan P0 initial (focus codebase + edge functions, 17 j-h) **est insuffisant**. Il manque une **Semaine 0 de hardening DB** (~10-15 j-h) qui doit précéder toute autre intervention.

### 3.3 Estimation effort (révisée Phase 2)

| Phase | Durée | Personnes | Risque |
|---|---|---|---|
| ~~Phase 2 audit DB~~ | ✅ FAIT | — | — |
| **P0.Sem 0 — Hardening DB** (nouveau) | 1.5-2 sem | 1 (focus DB/Postgres) | élevé (peut casser l'app) |
| P0.Sem 1-4 — Codebase + edge functions | 3-4 sem | 1-2 | moyen |
| P1 — Post-onboarding immédiat | 1-2 sem | 1 | bas |
| P2 — Roadmap consolidation | 2-3 mois | 1 | bas |

**Total avant onboarding** : ~5-6 semaines (au lieu des 3-4 initiales). Si on a 2 devs en parallèle (un sur DB, un sur codebase) : on retombe à 4 semaines.

---

## 4. TOP 10 CRITICAL — bloquants stricts avant ouverture

> Chaque item ci-dessous doit être résolu **ET vérifié** avant que le 2ème tenant ait accès au système. Aucun de ces 10 points ne tolère un workaround temporaire.

### TOP 5 nouveaux bloquants DB (Phase 2) — à traiter en priorité absolue

> Ajoutés suite à l'audit DB. Plus graves que les 10 précédents car ils touchent la couche d'isolation fondamentale.

#### DB#1 — `public.exec_sql` exécutable par `authenticated` (lecture totale DB)
- **Grant actuel** : `proacl = {postgres=X, service_role=X, authenticated=X}` (confirmé via `pg_proc`)
- **Source** : SECURITY DEFINER, filtre `UPPER(query) LIKE 'SELECT%' OR 'WITH%'` + blocklist regex `\b(INSERT|UPDATE|DELETE|DROP|...)\b`. Pas de filtre `org_id`.
- **Exploit** : `POST /rest/v1/rpc/exec_sql {"query_text":"SELECT * FROM majordhome.clients"}` retourne tous les clients de toutes les orgs.
- **Fix** : `REVOKE EXECUTE ON FUNCTION public.exec_sql FROM authenticated, anon;` IMMÉDIAT. Si elle est utilisée par une app (Towercontrol ?), la remplacer par des RPCs dédiées avec validation org_id.

#### DB#2 — 112 vues SECURITY DEFINER bypassent la RLS
- **Findings** : Supabase Advisor `security_definer_view` × 112. Dont 73 vues `public.majordhome_*` utilisées en prod.
- **Conséquence** : tout `SELECT FROM majordhome_clients WHERE org_id = '<other_org>'` retourne les données de l'autre org. La RLS sur la table sous-jacente est ignorée.
- **Fix** : `ALTER VIEW public.majordhome_X SET (security_invoker = true);` pour chaque vue (script SQL one-shot). Tester l'app après — certaines vues qui JOIN `core.profiles` (visible seulement aux org_admin) peuvent casser des écrans.

#### DB#3 — 24 RPCs SECURITY DEFINER exposées à `anon`
- **Inclut** : `delete_organization`, `delete_project`, `create_organization`, `create_project`, `update_user_role`, `update_member_role`, `assign_user_to_org`, `remove_user_from_org`, `update_majordhome_lead(p_lead_id, p_updates jsonb)`, `update_majordhome_task`, `update_majordhome_technical_visit`, `find_or_create_client`, `record_voice_memo_extraction`, `mail_segment_compile`, `resend_apply_webhook_event`, `meta_ads_upsert_daily_stats`, `gsc_upsert_metrics`, etc.
- **Exploit** : sans authentification, `POST /rest/v1/rpc/delete_organization` tente de supprimer une org. Si le corps ne vérifie pas l'identité du caller (probablement non), c'est exploitable.
- **Fix** : `REVOKE EXECUTE ... FROM anon` sur les 24 fonctions. Conserver `authenticated` mais auditer chaque corps pour validation `auth.uid()` + membership.

#### DB#4 — Storage `contracts`, `certificats`, `product-documents` : ALL `authenticated`
- **Policies actuelles** :
  ```sql
  "Authenticated users access contracts bucket"   ALL: bucket_id='contracts'
  "Authenticated users access certificats bucket" ALL: bucket_id='certificats'
  "product_documents_storage_select/insert/delete" ALL: bucket_id='product-documents'
  ```
- **Aucun filtre org_id, user_id, path**. Tout user authentifié peut lire/écrire/supprimer n'importe quel objet de ces buckets.
- **Fix** : DROP les policies actuelles, CREATE 4 policies (SELECT/INSERT/UPDATE/DELETE) avec filtre `(storage.foldername(name))[1]::uuid IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid())`. Migrer les fichiers existants sous préfixe `${org_id}/` (cf. P0.9 codebase).

#### DB#5 — 9 policies RLS `USING (true)` (cross-tenant ouvert)
- **Tables affectées** : `majordhome.aide_requests`, `majordhome.certificats` (déjà DB#4), `majordhome.intervention_technicians` (USING auth.role()='authenticated'), `majordhome.lead_activities` (SELECT + INSERT), `majordhome.mailing_logs` (SELECT + INSERT, nom `*_service` trompeur), `majordhome.monthly_source_costs` (3 ops), `majordhome.pricing_*` (5 tables), `public.towercontrol_campaigns`.
- **Conséquence** : tout authentifié peut lire/écrire ces tables, peu importe l'org.
- **Fix** : DROP + CREATE policies avec filtre `org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid())` ou `EXISTS (...)`. Pour les policies nommées `*_service` mais role=`public` : soit corriger role à `service_role`, soit retirer la policy.

### TOP 10 bloquants codebase (Phase 1) — rappel

### #1 — `pennylane-sync-cron` et `pennylane-backfill-quotes` ouverts à Internet
**Fichiers** : `supabase/functions/pennylane-sync-cron/index.ts:1-13`, `pennylane-backfill-quotes/index.ts:1-12`
**Symptôme** : `verify_jwt: false` documenté + **aucune auth alternative**.
**Exploit** :
```
POST https://<project>.supabase.co/functions/v1/pennylane-sync-cron
```
N'importe qui sur Internet peut déclencher : DoS de l'API Pennylane (drain du quota gratuit), consommation des quotas Supabase edge, pollution massive de la DB Mayer par création de clients/leads non désirés.
**Fix** : header `X-Cron-Secret` vérifié en début de handler avec `Deno.env.get('CRON_SECRET')`. N8n / pg_cron / GitHub Actions passent ce secret, le reste du monde reçoit 401. Pour `pennylane-backfill-quotes` (job one-shot) : préférer la suppression si l'usage initial est terminé.

### #2 — `pennylane-proxy` : JWT vérifié mais aucun contrôle d'org ni de rôle
**Fichier** : `supabase/functions/pennylane-proxy/index.ts:117-138`
**Symptôme** : la fonction vérifie que le JWT est valide, mais ne vérifie ni l'`org_id`, ni le rôle (`org_admin` / `team_leader`), ni un allowlist de paths Pennylane.
**Exploit post-onboarding** : un utilisateur de la 2ème org authentifié peut faire :
```
POST /pennylane-proxy {"method":"DELETE","path":"/invoices/12345"}
```
… et **détruire ou modifier des factures Pennylane de Mayer** (un seul token Pennylane partagé côté edge).
**Fix** : (a) vérifier `user IS member of org_id qui possède la connexion Pennylane` ; (b) restreindre aux rôles `org_admin` / `team_leader` ; (c) allowlist regex sur les paths autorisés (`^/quotes`, `^/customers`, `^/invoices`, `^/ledger_accounts`). À terme : un token Pennylane par org dans `core.organizations.settings.pennylane_token`.

### #3 — `ORG_ID = 'Mayer'` hardcodé dans les crons Pennylane
**Fichiers** : `pennylane-sync-cron/index.ts:24`, `pennylane-backfill-quotes/index.ts:25`
**Symptôme** : `const ORG_ID = "3c68193e-783b-4aa9-bc0d-fb2ce21e99b1"` en dur.
**Conséquence** : tout sync Pennylane atterrit dans l'org Mayer, même si la 2ème entreprise branche son propre Pennylane. Multi-tenant impossible en l'état.
**Fix** : itérer sur les orgs qui ont `settings.pennylane_api_token` set, ou passer `org_id` en paramètre + lookup du token PL associé.

### #4 — CSRF sur OAuth GSC : `state` non signé
**Fichier** : `supabase/functions/gsc-oauth-callback/index.ts:71-72`
**Symptôme** : le `state` OAuth est `base64(JSON({orgId, returnTo}))` **sans HMAC, sans nonce, sans lien avec le user qui initie le flow**.
**Exploit** : un attaquant peut forger un `state` pointant vers l'`orgId` d'une victime, déclencher son propre flow Google sur son navigateur, puis pousser la victime à cliquer un lien qui complète le callback côté Mayer → **le refresh_token Google de l'attaquant atterrit dans `core.organizations.settings.gsc_refresh_token`** de l'org victime. Inverse possible (association attack).
**Fix** : signer le state avec HMAC + clé serveur + nonce + `user_id` originel. Vérifier au callback que le `user_id` était bien le caller de `gsc-oauth-init`. Alternative : table `oauth_states(state_hash, user_id, org_id, expires_at)` côté `gsc-oauth-init`, lookup au callback.

### #5 — Webhook N8n voice : `org_id` accepté du body sans vérification membership
**Fichier** : `docs/n8n/workflows/mayer-voice-field-report.json:130`
**Symptôme** : le webhook public `mayer-voice-field-report` reçoit `{org_id, recorded_by, audio_path, ...}` et relaie tel quel à la RPC `record_voice_memo_extraction` avec un `apikey: SERVICE_ROLE_KEY`. Aucune vérification que `recorded_by ∈ org_id`.
**Exploit** : un attaquant peut POSTer avec n'importe quel `org_id` + `recorded_by` + `audio_path` et faire écrire une extraction dans l'org cible, potentiellement liée à un `client_id_hint` appartenant à une autre org.
**Fix** : (a) requérir un secret partagé HMAC dans le header du webhook, ou (b) faire valider par la RPC : `recorded_by IN (SELECT user_id FROM core.organization_members WHERE org_id = p_org_id AND status = 'active')`.

### #6 — `ProtectedRoute.requireOrganization` désactivé via TODO
**Fichier** : `src/components/ProtectedRoute.jsx:73-85`
**Symptôme** : la garde "user sans org → redirect /join-organization" est commentée avec `// TODO: Réactiver quand le système d'organisation sera fonctionnel`.
**Conséquence** : un user authentifié mais orphelin (pas de membership dans `core.organization_members`) peut quand même charger le shell `AppLayout` et déclencher des requêtes. La seule défense restante est la RLS DB.
**Fix** : ré-activer la garde + tester un user orphelin (créer un compte de test sans membership et vérifier le redirect).

### #7 — `segment_sql` SQL libre construit côté client et envoyé à N8n
**Fichiers** : `src/apps/artisan/components/mailing/SendTab.jsx:106`, `src/apps/artisan/pages/client-detail/ContractPdfSection.jsx:286`
**Symptôme** : la page Mailing et la section Contract PDF construisent une chaîne SQL côté navigateur et la POSTent au webhook N8n qui l'exécute brut côté Postgres.
**Exploit** : tout utilisateur ayant accès à ces pages peut intercepter la requête réseau via DevTools, modifier la chaîne SQL pour cibler n'importe quel `org_id`, et faire envoyer des emails (ou exfiltrer des emails) cross-org. Si l'instance N8n exécute en `service_role`, n'importe quelle injection DML est possible.
**Fix** : ne **jamais** envoyer de SQL libre côté client. Le client envoie `{segment_id, campaign_id}` ; N8n appelle la RPC `mail_segment_compile(p_org_id := <org_id du JWT vérifié côté N8n>, p_segment_id := ...)` pour compiler le SQL en server-side.

### #8 — `clientId` (URL param) concaténé en SQL inline
**Fichier** : `src/apps/artisan/pages/client-detail/ContractPdfSection.jsx:286`
**Symptôme** : ``segment_sql: `SELECT ... WHERE id = '${clientId}'...` `` — `clientId` vient de `useParams()`, donc de l'URL, donc user-controlled.
**Exploit** : si N8n exécute brut (pas de bind), une URL crafted permet de réécrire le filtre WHERE.
**Fix** : (a) valider via regex UUID stricte avant build ; (b) ne plus inliner du SQL côté client (cf. #7).

### #9 — Storage paths sans préfixe `org_id`
**Fichiers** :
- `src/apps/artisan/pages/client-detail/ContractPdfSection.jsx:197` → `Contrat_Signe_-_${safeName}.${ext}` à la racine du bucket `contracts`
- `ContractPdfSection.jsx:238` → `Proposition_${contractNum}.pdf` à la racine
- `src/shared/services/chantiers.service.js:206` → `pv-reception/${leadId}/PV_Reception_${ts}.${ext}`
- `src/shared/services/certificats.service.js:193` → `${clientId}/${year}/${certificatId}.pdf`
**Symptôme** : aucun de ces chemins n'inclut l'`org_id` en préfixe.
**Conséquence** : (a) collisions cross-org (deux clients homonymes dans deux orgs écrivent au même endroit) ; (b) si la RLS storage policy filtre `(storage.foldername(name))[1] = org_id::text` (pattern documenté dans CLAUDE.md), tous les uploads existants deviennent inaccessibles ; (c) si la policy ne filtre pas, un user de l'org B peut lister/lire les certificats de Mayer.
**Fix** : préfixer systématiquement `${orgId}/${clientId}/...`. Migrer les fichiers existants par script one-shot. Aligner les RLS policies des buckets `contracts`, `interventions`, `certificats`, `technical-visits`, `quotes`, `product-documents`, `product-images`, `voice-memos`.

### #10 — `WHITELIST_USER_IDS` Voice hardcodée dans le bundle
**Fichier** : `src/apps/voice/components/VoiceAccessGate.jsx:12-15`
**Symptôme** : 2 UUIDs Mayer en clair dans le bundle client. Le gate est purement UI.
**Conséquence** : (a) la 2ème org ne peut pas accéder Voice ; (b) si l'edge function `voice-extract-fieldreport` n'a pas de gate équivalent côté serveur, le frontend est contournable via POST direct.
**Fix** : migrer vers permission DB `voice_recorder` dans la table `permissions` (sprint 7) ou flag `profile.features`. Vérifier que l'edge function vérifie la même permission via `auth.uid()`.

---

## 5. Détail par axe

### 5.1 Isolation multi-tenant — findings complets

#### CRITICAL (rappel)
Cf. #1, #2, #3, #5, #7, #9 ci-dessus.

#### HIGH (10)

| # | Fichier | Description |
|---|---|---|
| 5.1.H1 | `src/shared/hooks/cacheKeys.js:27-34` | `contractKeys` ne contient pas d'orgId. Pour un même `clientId`, le cache peut retourner données d'une autre org après login switch. |
| 5.1.H2 | `cacheKeys.js` (toutes les clés sauf clientKeys/leadKeys) | `appointmentKeys.detail`, `interventionKeys.*`, `chantierReceptionKeys`, `mailingKeys.byClient/byLead`, `pricingKeys.*`, `entretienSavKeys.children`, `pennylaneKeys.*`, `devisKeys.*`, etc. — aucune ne contient `orgId`. Risque de pollution cache si un user change d'org dans la même session. |
| 5.1.H3 | `src/contexts/AuthContext.jsx:40-45` | Fallback `userOrg = { id: profile.org_id, name: null, slug: null }` si `getUserOrganization` rate. Un profil corrompu = bascule silencieuse d'org. |
| 5.1.H4 | `AuthContext.jsx` (manque) | Pas de `queryClient.clear()` dans `signOut()` ni dans le handler `SIGNED_OUT`. Si user A logout puis user B login dans le même onglet, cache pollué. |
| 5.1.H5 | `src/shared/services/storage.service.js` | Service générique ne valide pas que le `path` est préfixé `orgId`. Tous les callers doivent le faire eux-mêmes (cf. #9). |
| 5.1.H6 | `supabase/functions/invite-client/index.ts:29,69,103,210,228-230` | `FROM_EMAIL`, logo, signature, téléphone, lien portal hardcodés Mayer. Les invitations client de l'org B partiront en "Mayer Energie". |
| 5.1.H7 | `supabase/functions/mailing-unsubscribe/index.ts:118,121,138` | Redirige vers `https://www.mayer-energie.fr/desabonnement` peu importe l'org. |
| 5.1.H8 | `src/apps/voice/components/VoiceAccessGate.jsx:12-15` | Cf. #10. |
| 5.1.H9 | `vercel.json` (manque) | Aucun header de sécurité défini (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). |
| 5.1.H10 | `vite.config.js:81` | `sourcemap: 'hidden'` en prod — les `.map` sont uploadés dans `dist/` et servis par Vercel par défaut. Code source frontend reconstructible. |

#### MEDIUM (18) — voir Annexe C

Branding hardcodé Mayer dans tous les PDFs (ContractPDF, CertificatPDF, DevisPDF, PvReceptionPDF — SIRET/RCS/adresse), coordonnées Gaillac dans `territoire-config.js` / `zoneDetection.js` / `mapbox.js`, INSEE/lat/lng Gaillac dans `ScanConfigPanel.jsx`, URLs Mayer dans `resources.js` (caisse à outils mailing), prompts wizard mentionnant "Mayer Énergie" hardcodé, UI GSC affichant "mayer-energie.fr", clés localStorage non scopées par org (`mayer-territoire-zones-v8`, brouillons interventions), seed permissions Prospection Mayer-only, scripts d'import avec ORG_ID hardcodé.

### 5.2 Sécurité edge functions — findings complets

#### Inventaire des 11 fonctions auditées

| Fonction | verify_jwt | Auth alt | Risque global |
|---|---|---|---|
| `voice-extract-fieldreport` | non documenté | aucune si false | **HIGH** |
| `resend-webhook` | false | Svix HMAC + skew 5min | **LOW** |
| `mailing-unsubscribe` | false | token HMAC signé | **MEDIUM** |
| `gsc-oauth-init` | true | JWT + membership | **LOW** |
| `gsc-oauth-callback` | false | state base64 (CSRF !) | **HIGH** |
| `gsc-sync` | true | JWT + membership | **LOW** |
| `client-change-password` | true | JWT + check `client_id` metadata | **MEDIUM** |
| `invite-client` | true | JWT + membership org | **MEDIUM** |
| `pennylane-proxy` | true | JWT mais pas de check org | **HIGH** |
| `pennylane-sync-cron` | false | **aucune** | **CRITICAL** |
| `pennylane-backfill-quotes` | false | **aucune** | **CRITICAL** |

#### HIGH (5) — non couverts en TOP 10

| # | Fichier | Description |
|---|---|---|
| 5.2.H1 | `voice-extract-fieldreport/index.ts:361` | `verify_jwt` non documenté dans l'en-tête. Si `false`, n'importe qui peut consommer Anthropic/OpenAI au crédit Mayer. À 50k chars × Claude Sonnet ≈ 0,05-0,08 €/appel → drain rapide. |
| 5.2.H2 | `voice-extract-fieldreport/index.ts:381` | Borne haute `50_000` chars trop large. Suggéré : `15_000` (largement suffisant pour un mémo 3min) + compteur quotidien par user. |
| 5.2.H3 | `voice-extract-fieldreport/index.ts:427-434` | `error: err.message` retourné brut — peut leaker le corps de la réponse Anthropic/OpenAI. |
| 5.2.H4 | `invite-client/index.ts:144-152` | Membership check via vue publique `organization_members` au lieu de `supabase.schema('core')`. Pas de check de rôle (`org_admin` / `team_leader`) → n'importe quel membre actif peut inviter un client. |
| 5.2.H5 | `invite-client/index.ts:166` | `generateTempPassword()` envoyé **en clair par email** = compromission si email intercepté. Pattern recommandé : magic link signé qui ouvre une page set-password. |

#### MEDIUM (11) — voir Annexe C

Skew strict OK, mais `safeEqual` early-return sur diff de length, secret HMAC partagé entre 3 usages (`RESEND_WEBHOOK_SECRET` utilisé pour webhook + unsubscribe + N8n), password length ≥ 6 trop faible, error leakage GoTrue dans `client-change-password`, rollback compensatoire manquant si `link_client_auth` rate, CORS `*` à restreindre, etc.

### 5.3 Sécurité front + dette technique — findings complets

#### CRITICAL (rappel)
Cf. #6, #7, #8 ci-dessus.

#### HIGH (6) — non couverts en TOP 10

| # | Fichier | Description |
|---|---|---|
| 5.3.H1 | `src/apps/artisan/components/mailing/SendTab.jsx:306-312`, `CampaignWizard.jsx:509-515` | `iframe` aperçu sans attribut `sandbox` + `doc.write()` du `html_body`. Les `<script>` exécuteront dans le même origin. Admin-only mais : HTML hostile collé (workflow "Claude → paste HTML") = XSS dans le shell avec accès au token Supabase localStorage. **Fix** : `sandbox="allow-same-origin"` (sans `allow-scripts`). |
| 5.3.H2 | `vite.config.js:81` | Cf. 5.1.H10. |
| 5.3.H3 | `vercel.json` | Cf. 5.1.H9. |
| 5.3.H4 | `src/lib/supabaseClient.js:17` | Token Supabase dans `localStorage` (défaut Supabase). Sensible à toute XSS. |
| 5.3.H5 | Services PostgREST `.or()` (5 occurrences : `clients.service.js:153`, `entretiens.service.js:236`, `leads.service.js:793`, `suppliers.service.js:189/271`, `CreateSAVModal.jsx:40`) | Caractères `,` `)` dans le terme user peuvent réécrire le filtre. Pas SQL injection (PostgREST parse), mais bypass de filtre possible. **Fix** : encoder ou échapper avant insertion. |
| 5.3.H6 | `package.json` | `xlsx 0.18.5` vulnérable à CVE-2023-30533 (proto pollution), corrigée seulement en 0.20.2 (hors npm officiel). Remplacer par `xlsx-js-style` / `exceljs` ou migrer vers `https://cdn.sheetjs.com/xlsx-0.20.x/xlsx.tgz`. |

#### Dette technique — inventaire

**Fichiers > 500 LOC (top 10)** :

| Fichier | LOC | Note |
|---|---:|---|
| `LeadModal.jsx` | 1021 | 22 useState — refacto urgent (state machine) |
| `clients.service.js` | 986 | CRUD + équipements legacy |
| `SupplierManagement.jsx` | 878 | 14 useState |
| `leads.service.js` | 874 | CRUD + transitions |
| `LeadFormSections.jsx` | 838 | Sections extraites de LeadModal |
| `suppliers.service.js` | 837 | |
| `sav.service.js` | 828 | 4 méthodes hors `withErrorHandling` |
| `interventions.service.js` | 778 | + webhooks PDF |
| `pennylane.service.js` | 753 | |
| `entretiens.service.js` | 748 | |

**Autres mesures** :
- TODO / FIXME : **4** (très propre)
- `console.log` : **0** (déjà nettoyé)
- `console.error` : **340** — wrapper `logger` no-op en prod recommandé
- Composants > 5 useState : top 5 = LeadModal (22), LeadKanban (14), SupplierManagement (14), DevisProductPicker (12), BenchmarkLauncher (12)
- Services hors `withErrorHandling` : **16 / 32** (50%)
- Tests automatisés : **0** dans tout le repo
- ESLint config : **absente** à la racine — `npm run lint` ne valide probablement rien
- Hooks avec cacheKeys centralisées : 28/29 (excellent)

---

## 6. Phase 2 — Audit DB exécuté ✅

Audit DB exécuté le 2026-05-20 via Supabase MCP sur projet `odspcxgafcqxjzrarsqf`. Résultats détaillés en **Annexe E**.

**Résumé** :
- Supabase Security Advisor : 725 findings (131 ERROR, 589 WARN, 5 INFO)
- 4 bombes structurelles découvertes (vues SECURITY DEFINER × 112, `exec_sql` ouvert, 24 RPCs anon, storage ALL)
- 19 tables `majordhome.*` sans RLS
- 9 policies `USING (true)`
- 4+ apps non-Majord'home cohabitent dans l'instance (Pack Vendeur, Baikal, Towercontrol, etc.)

**Plan révisé** : Semaine 0 ajoutée (hardening DB) — voir §7.0 et Annexe E.6.

---

## 7. Plan d'action priorisé

### P0 — Pré-onboarding (5-6 semaines, BLOQUANT)

Tous les items P0 doivent être **résolus, déployés en production, et testés** avant que le 2ème tenant ait un seul user créé.

#### Semaine 0 — Hardening DB (NOUVEAU, ajouté Phase 2)

> **Ce sprint conditionne tous les suivants.** Sans ces fixes, le hardening codebase ne sert à rien : la RLS DB reste percée.

| # | Tâche | Effort | Risque |
|---|---|---|---|
| P0.0.1 | `REVOKE EXECUTE ON FUNCTION public.exec_sql FROM authenticated, anon;` + vérifier qui l'appelle (Towercontrol ? probable) | 0.5j | moyen (peut casser une app) |
| P0.0.2 | Script SQL : convertir les 73 vues `public.majordhome_*` en `security_invoker=true`. Tester l'app entre chaque batch. | 2j | élevé (peut casser screens qui JOIN core.profiles) |
| P0.0.3 | Convertir les 39 autres vues SECURITY DEFINER (Pack Vendeur, Baikal, etc.) — OU décider de désactiver ces apps si non-stratégiques | 2j | dépend du périmètre |
| P0.0.4 | `REVOKE EXECUTE ... FROM anon` sur les 24 RPCs sensibles (`delete_organization`, `update_user_role`, `update_majordhome_lead`, etc.) | 0.5j | bas |
| P0.0.5 | Activer RLS + créer policies CRUD pour les 19 tables `majordhome.*` sans RLS : `user_profiles`, `project_access`, `client_creation_audit`, `home_details`, `dpe_data`, `lead_pennylane_quotes`, `geogrid_keyword_lists`, `geogrid_benchmarks`, `conversations`, `messages`, `dedup_candidates`, `dedup_merge_history`, `service_requests`. | 1.5j | moyen |
| P0.0.6 | Corriger les 9 policies `USING (true)` : `aide_requests`, `certificats`, `intervention_technicians`, `lead_activities`, `mailing_logs`, `monthly_source_costs`, `pricing_*` × 5, `towercontrol_campaigns`. Remplacer par `org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())`. | 1j | bas |
| P0.0.7 | Storage policies pour buckets `contracts`, `certificats`, `product-documents` : DROP les policies ALL + CREATE 4 policies par bucket (SELECT/INSERT/UPDATE/DELETE) avec filtre `(storage.foldername(name))[1]::uuid IN (...)` | 1j | dépend de la migration paths existants |
| P0.0.8 | Compléter les RLS manquantes signalées : policy UPDATE absente sur `chantier_line_receptions`, refactor des policies SELECT trompeuses sur `mailing_logs` / `mailing_events`. | 0.5j | bas |
| P0.0.9 | Auditer le corps des RPCs sensibles : `update_majordhome_lead`, `update_majordhome_task`, `update_majordhome_technical_visit`, `find_or_create_client`, `record_voice_memo_extraction`, `mail_segment_compile`. Vérifier validation `auth.uid()` + membership. Ajouter contrôles manquants. | 2j | bas |
| P0.0.10 | `function_search_path_mutable` × 183 : ajouter `SET search_path = ...` à chaque fonction flaggée (script `ALTER FUNCTION`). | 1j | bas |
| P0.0.11 | Dashboard Supabase Auth → activer HaveIBeenPwned (leaked password protection). | 0.1j | bas |
| P0.0.12 | Décision sur les apps cohabitantes (Pack Vendeur, Baikal, Towercontrol, Snapstudio, Arpet, Karedas, Zelty) : actives ? À sortir vers projets Supabase séparés ? À nettoyer ? | 0.5j (décision) | dépend |

**Total Semaine 0 : ~12 j-h**. À 1 dev focus DB, ~2 semaines calendaires (avec tests intercalés).

#### Semaine 1 — Findings DB restants + bouchage des plaies edge

| # | Tâche | Effort | Fichiers |
|---|---|---|---|
| P0.1 | Phase 2 audit DB (RLS + RPCs) | 0.5j | Supabase MCP |
| P0.2 | Ajouter `CRON_SECRET` à `pennylane-sync-cron` et `pennylane-backfill-quotes` (ou supprimer le 2ème) | 0.5j | edge functions |
| P0.3 | `pennylane-proxy` : check membership org + check rôle + allowlist paths | 1j | `pennylane-proxy/index.ts` |
| P0.4 | Signer le `state` OAuth GSC (HMAC + nonce + user_id) | 1j | `gsc-oauth-init` + `gsc-oauth-callback` |
| P0.5 | Webhook voice : ajouter HMAC ou validation membership dans RPC `record_voice_memo_extraction` | 0.5j | RPC DB + workflow N8n |
| P0.6 | Confirmer `verify_jwt:true` sur `voice-extract-fieldreport` + check membership + quota daily | 1j | edge function |

#### Semaine 2 — Multi-tenant front

| # | Tâche | Effort | Fichiers |
|---|---|---|---|
| P0.7 | Ré-activer `requireOrganization` dans `ProtectedRoute` + tester user orphelin | 0.5j | `ProtectedRoute.jsx` |
| P0.8 | Supprimer `segment_sql` du frontend — n'envoyer que `{segment_id, campaign_id}` | 1j | `SendTab.jsx`, `ContractPdfSection.jsx`, workflow N8n |
| P0.9 | Préfixer tous les storage paths par `${orgId}/...` + script migration fichiers existants + alignment RLS policies storage | 2j | services PDF + Supabase |
| P0.10 | `VoiceAccessGate` : migrer vers permission DB `voice_recorder` | 0.5j | `VoiceAccessGate.jsx` + table permissions |
| P0.11 | Ajouter `orgId` en premier élément de toutes les cache keys React Query | 1j | `cacheKeys.js` + propagation dans tous les hooks |
| P0.12 | `queryClient.clear()` dans `signOut()` + handler `SIGNED_OUT` | 0.5j | `AuthContext.jsx` |

#### Semaine 3 — Branding multi-tenant + paramétrage org

| # | Tâche | Effort | Fichiers |
|---|---|---|---|
| P0.13 | Schéma `core.organizations.settings` enrichi : legal_name, siret, rcs, capital, address, phone, email, logo_url, brand_name, from_email, portal_url, unsubscribe_landing_url, mailing_resources (JSON), pennylane_api_token, google_place_id, gsc_refresh_token, gsc_site_url, territoire_centers (JSON) | 1j | migration DB |
| P0.14 | PDFs (`ContractPDF`, `CertificatPDF`, `DevisPDF`, `PvReceptionPDF`) : remonter constantes `COMPANY` dans settings org, passer en props depuis caller | 1j | 4 fichiers PDF |
| P0.15 | `invite-client` : récupérer settings org au lieu des constantes hardcodées | 0.5j | edge function |
| P0.16 | `mailing-unsubscribe` : redirect URL depuis settings org | 0.25j | edge function |
| P0.17 | `resources.js` : devenir un getter `getResources(orgId)` lisant `settings.mailing_resources` | 0.5j | refactor |
| P0.18 | `CampaignWizard` : retirer "Mayer Énergie" hardcodé du prompt, paramétrer depuis settings | 0.5j | `CampaignWizard.jsx` |
| P0.19 | `territoire-config.js` + `mapbox.js` + `zoneDetection.js` : coordonnées centres depuis settings org | 1j | 3 fichiers |
| P0.20 | `ScanConfigPanel`, `BenchmarkLauncher`, `GscPanel` : pré-rempli depuis settings org au lieu de Gaillac/Mayer | 0.5j | 3 composants |

#### Semaine 4 — Headers sécurité, bundle, validation finale

| # | Tâche | Effort | Fichiers |
|---|---|---|---|
| P0.21 | Headers sécurité dans `vercel.json` : CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy | 0.5j | `vercel.json` |
| P0.22 | `sourcemap: false` en prod (ou exclusion Vercel des `*.map`) | 0.25j | `vite.config.js` |
| P0.23 | Remplacer `xlsx 0.18.5` par `exceljs` ou cdn.sheetjs.com 0.20.2 | 0.5j | `package.json` + appelants |
| P0.24 | Ajouter `sandbox="allow-same-origin"` aux 2 iframes mailing | 0.25j | `SendTab.jsx`, `CampaignWizard.jsx` |
| P0.25 | Helper partagé `requireOrgMembership(supabase, token, orgId, requiredRole?)` utilisable par toutes les edge functions | 1j | `supabase/functions/_shared/` |
| P0.26 | Encoder les termes de recherche dans les 5 occurrences `.or()` PostgREST | 0.5j | 5 fichiers |
| P0.27 | Vérifier que `eslint.config.js` existe ou créer (sinon `npm run lint` est silencieux) | 0.5j | racine |
| P0.28 | Checklist pen-test sur les 10 CRITICAL (cf. §8) | 1j | manuel + scripts |

**Total P0 : ~17 jours homme**. Avec 1 dev temps plein, ça tient en 3.5 semaines. Avec 2 devs (front + backend/edge), ça tient en 2 semaines compressées.

### P1 — Post-onboarding immédiat (1-2 semaines après ouverture)

Travaux qui peuvent attendre l'arrivée du 2ème tenant mais qui doivent être faits dans les 2 semaines suivantes.

| # | Tâche | Effort |
|---|---|---|
| P1.1 | `safeEqual` constant-time partagé (`shared/crypto.ts`) | 0.5j |
| P1.2 | Séparer `RESEND_WEBHOOK_SECRET` en 3 secrets distincts (webhook / unsubscribe / N8n) | 0.5j |
| P1.3 | `invite-client` : passer au magic link au lieu de password en clair par email | 1j |
| P1.4 | Sanitize error messages partout dans les edge functions (helper `sanitizeError(err)`) | 1j |
| P1.5 | Restreindre CORS `*` partout par `FRONTEND_ORIGINS` env var | 0.5j |
| P1.6 | Reproduire `verify_jwt` config dans `supabase/config.toml` pour versionning | 0.5j |
| P1.7 | Wrapper `logger` no-op en prod pour les 340 `console.error` | 0.5j |
| P1.8 | Seed permissions Prospection / Voice / etc. au moment de la création d'une org (RPC `org_seed_permissions(new_org_id)`) | 1j |
| P1.9 | Suffixer toutes les clés localStorage par `orgId` ou `userId` (territoire-zones, intervention-draft, communes-cache) | 0.5j |
| P1.10 | Auditer routes artisan non gardées : `/`, `/planning`, `/clients`, `/clients/:id`, `/contrats`, `/entretiens`, `/intervention/:id`, `/certificat/:id`, `/profile`, `/territoire`, `/contrat/signer` | 1j |

**Total P1 : ~7 jours homme**.

### P2 — Roadmap consolidation (T+3 mois)

Travaux d'hygiène et refacto qui ne bloquent pas le multi-tenant mais améliorent la maintenabilité.

| # | Tâche | Effort estimé |
|---|---|---|
| P2.1 | Mettre en place vitest + tests sur `permissions.js`, services critiques (auth, clients, leads), helpers (formatDate, formatPhone, computeEndTime), RPCs (segment compile) | 5j |
| P2.2 | Refacto `LeadModal.jsx` (22 useState → useReducer ou state machine) | 3j |
| P2.3 | Refacto autres composants > 10 useState (LeadKanban, SupplierManagement, DevisProductPicker, BenchmarkLauncher, ChantierModal, EntretienSAVModal) | 5j |
| P2.4 | Migrer les 16 services restants vers `withErrorHandling` | 3j |
| P2.5 | Migrer `useDashboardData` vers React Query | 2j |
| P2.6 | Décomposer `clients.service.js` (986 LOC) en sous-modules (déjà entamé avec `equipments.service.js`) | 2j |
| P2.7 | Migrer `useModalManager` dans les pages multi-modales (LeadModal, ClientDetail, Planning) | 2j |
| P2.8 | Mettre en place ESLint v9 flat config + activer `react-hooks/exhaustive-deps` en error | 1j |
| P2.9 | Évaluer migration storage Supabase → Vercel Blob pour les buckets non-RLS-critical | 5j |
| P2.10 | Documentation onboarding 2ème entreprise (procédure step-by-step + checklist + scripts d'init) | 2j |

**Total P2 : ~30 jours homme**.

---

## 8. Critères de go/no-go pré-ouverture

Aucun de ces critères ne tolère un "presque OK". Soit c'est OK et coché, soit on ne donne pas accès.

### Tests fonctionnels obligatoires

- [ ] Créer un user de test `org_test_b` rattaché à une 2ème org factice. Vérifier qu'il NE PEUT PAS :
  - Lister les clients, leads, contracts, appointments, interventions, chantiers, devis, mailings de Mayer
  - Lire les PDFs (contrats signés, certificats, PV réception) de Mayer via signed URL ou path direct
  - Appeler `pennylane-proxy` et obtenir une réponse 200 sur un endpoint Pennylane
  - Déclencher `pennylane-sync-cron` ou `pennylane-backfill-quotes` (sans le `CRON_SECRET`)
  - Forger un `state` OAuth GSC pour écrire un refresh_token dans Mayer
  - Envoyer un mailing en payload "segment_sql" custom ciblant des emails Mayer
  - Uploader un fichier hors de son préfixe `${orgId}/`
  - Voir les pages `/voice`, `/settings`, `/meta-ads`, `/geogrid` si pas le rôle requis

### Tests cross-cutting

- [ ] `npm run lint` retourne 0 warning (avec config présente et stricte)
- [ ] `npm run build` produit un bundle sans `console.log` (que des `console.error` filtrables par logger)
- [ ] `npm audit --omit=dev` ne remonte aucun HIGH/CRITICAL non patché
- [ ] Headers `curl -I https://majordhome.vercel.app/` montrent : CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- [ ] Pas de `.map` accessibles publiquement (`curl https://majordhome.vercel.app/assets/*.js.map` → 404)
- [ ] Phase 2 audit DB : RLS policies présentes sur toutes les tables `majordhome.*` et tous les buckets storage
- [ ] Toutes les RPCs `SECURITY DEFINER` valident `auth.uid()` membership de l'`org_id` paramètre

### Tests opérationnels

- [ ] Procédure d'onboarding documentée et testée sur l'org de test : création org, settings (logo, SIRET, adresse, etc.), seed permissions, invitation premier admin
- [ ] Procédure de rollback : si la 2ème org cause un incident, on peut isoler/désactiver son accès en < 5 min sans toucher à Mayer

---

## 9. Annexes

### Annexe A — Settings org à externaliser (récap)

À ajouter dans `core.organizations.settings` (JSONB) :

```jsonc
{
  // Identité légale (pour PDFs)
  "legal_name": "MAYER ENERGIE",
  "siret": "100 288 224 00012",
  "rcs": "Albi B 100 288 224",
  "capital": "10 000 €",
  "address": { "street": "...", "zip": "81600", "city": "Gaillac" },
  "phone": "05 ...",
  "email": "contact@mayer-energie.fr",
  "from_email": "Mayer Energie - Econ'Home <contact@mayer-energie.fr>",
  "logo_url": "https://...",

  // Branding UI
  "brand_name": "Mayer Énergie",
  "portal_url": "https://majordhome.vercel.app",
  "unsubscribe_landing_url": "https://www.mayer-energie.fr/desabonnement",

  // Intégrations
  "pennylane_api_token": "...",
  "google_place_id": "ChIJ...",
  "gsc_refresh_token": "...",
  "gsc_site_url": "sc-domain:mayer-energie.fr",

  // Mailing
  "mailing_resources": { /* la caisse à outils URLs */ },

  // Territoire
  "territoire_centers": {
    "primary": { "lat": 43.9015, "lng": 1.8975, "label": "Gaillac" },
    "secondary": { /* ... */ }
  },

  // Features flags
  "features": {
    "voice_recorder": true,
    "geogrid": true,
    "pennylane_sync": true
  }
}
```

### Annexe B — Checklist onboarding 2ème entreprise (V0)

1. Créer l'org dans `core.organizations`
2. Remplir le `settings` JSONB (cf. Annexe A) avec les valeurs de la 2ème entreprise
3. Exécuter la RPC `org_seed_permissions(new_org_id)` (à créer en P1.8) pour seed les permissions Prospection / Voice / etc.
4. Créer le premier admin via `invite-client` (ou flow dédié admin) avec le rôle `org_admin`
5. Vérifier les tests fonctionnels du §8 sur un user de test
6. Sigle GO du responsable sécurité (Eric)
7. Communication au client : URL, credentials initiaux, doc utilisateur

### Annexe C — Findings complets par sévérité

> Cette annexe contient l'intégralité des findings remontés par les 3 audits. Les CRITICAL et HIGH sont déjà détaillés dans le corps du rapport. Les MEDIUM et LOW sont listés ci-dessous en mode résumé pour ne pas alourdir.

#### MEDIUM (35) — listing

**Multi-tenant (18)** :
- Branding hardcodé Mayer dans : `ContractPDF.jsx:29-40`, `PvReceptionPDF.jsx:29-40`, `CertificatPDF.jsx:155,317`, `DevisPDF.jsx:208-209`
- Coordonnées Gaillac hardcodées dans : `territoire-config.js:8-11`, `zoneDetection.js:17,60,132`, `mapbox.js:9`, `useMapZones.js`
- INSEE/lat/lng Gaillac dans : `ScanConfigPanel.jsx:16,105`, `BenchmarkLauncher.jsx:27,37`
- URLs Mayer dans `resources.js` (toute la caisse à outils)
- Wizard mailing : `CampaignWizard.jsx:664,669` mentionne "Mayer Énergie" + tél/adresse dans le prompt LLM
- UI GSC : `GscPanel.jsx:104` affiche "mayer-energie.fr"
- Brouillons interventions persistés en localStorage sans préfixe user/org (`useInterventions.js:307-355`)
- Cache localStorage `mayer-territoire-zones-v8` non scopé par org (`useMapZones.js:408-448`)
- Workflows N8n hardcodés ORG_ID Mayer (`docs/n8n/workflows/*`, `docs/n8n/MAILING_SCHEDULER_SETUP.md:175,181`, `LEAD_BIENVENUE_CRON_SETUP.md:72,114`)
- Seed permissions Prospection Mayer-only (`sql/migration_prospects.sql:180-206`)
- Scripts d'import hardcodés ORG_ID (`scripts/_import_excel.mjs:21`, `scripts/geocode-clients.mjs:31`)
- Hook `useDashboardData.js:110` : `majordhome_sources` sans filtre `org_id` (à vérifier côté vue DB)
- Fallback orphelin AuthContext (cf. 5.1.H3)
- 16 services hors `withErrorHandling`

**Edge functions (11)** :
- `voice-extract-fieldreport` borne 50k chars trop large
- `voice-extract-fieldreport` error leakage
- `mailing-unsubscribe` `safeEqual` early-return sur length
- `mailing-unsubscribe` secret partagé entre 3 usages
- `gsc-oauth-callback` HTML error injection (sanitize plus large)
- `gsc-oauth-callback` `readErr.message` leak dans page publique
- `gsc-sync` error leakage du refresh token
- `client-change-password` password length ≥ 6 trop faible
- `client-change-password` error leakage GoTrue
- `invite-client` rollback compensatoire manquant
- `pennylane-proxy` paths allowlist (cf. #2)
- `pennylane-sync-cron` no MAX_PAGES sur customers
- `pennylane-sync-cron` log[] retourné au caller

**Front + dette (6)** :
- TODO optimisation filtre équipements (`clients.service.js:188`)
- Brouillons interventions localStorage non chiffrés
- Pas d'auth re-check sur les webhooks N8n côté frontend
- Pas de Subresource Integrity sur Mapbox GL + Google fonts
- `EQUIPMENT_TYPES` legacy coexiste avec `EQUIPMENT_CATEGORIES`
- `default_segment` / `allowed_segments` columns legacy encore référencées

#### LOW (22) — listing

Console logs avec `org_id` dans edges, `PORTAL_URL` hardcodé `majordhome.vercel.app` dans `invite-client`, `storageKey: 'majordhome-auth'` partagé, `offre_pellets` Mayer-specific dans resources, cache communes Tarn dans localStorage (donnée publique INSEE), `Math.random()` fallback UUID dans VoiceRecorder (crypto prioritaire), routes artisan non gardées (`/`, `/planning`, `/clients`, etc.), `Buffer` polyfill dans deps (taille bundle), eslint v8 EOL, etc.

#### Findings transverses

- **Aucun test automatisé** dans tout le repo (0 % coverage)
- **Aucun monitoring d'erreurs** côté front (Sentry, etc.) — découvert implicitement
- **Aucun rate limiting** sur les edge functions IA / OAuth
- **Aucune doc de procédure d'incident** (que faire si compromission ?)

### Annexe D — Sources

- Audit 1 (isolation multi-tenant) — exécuté 2026-05-20, agent `general-purpose`
- Audit 2 (edge functions) — exécuté 2026-05-20, agent `general-purpose`
- Audit 3 (front + dette tech) — exécuté 2026-05-20, agent `general-purpose`
- Contexte projet : `CLAUDE.md`, `MEMORY.md`, `docs/DATABASE.md`, `docs/COMPONENTS.md`, `docs/SPRINT_LOG.md`

---

## Annexe E — Phase 2 audit DB (Supabase MCP, 2026-05-20)

### E.1 Méthodologie

Audit DB exécuté via Supabase MCP sur le projet `odspcxgafcqxjzrarsqf` (eu-west-3, Postgres 17.6) :

1. **Supabase Security Advisor** (`get_advisors type=security`) — lint built-in Supabase, 725 findings au total
2. **6 requêtes SQL custom** :
   - `pg_class` RLS state pour `majordhome`, `core`, `public`
   - `pg_policies` détaillé (clauses USING / WITH CHECK)
   - `pg_proc.prosecdef = true` (RPCs SECURITY DEFINER)
   - `pg_class.reloptions` sur les vues `majordhome_*` (security_invoker check)
   - `storage.buckets` + policies par bucket
   - `pg_proc.proacl` sur les fonctions sensibles (grants `anon` / `authenticated`)
3. Lecture du **source code** de `public.exec_sql` via `pg_proc.prosrc`

### E.2 Décompte Supabase Advisor

| Level | Count | Top lint name |
|------|------:|---------------|
| ERROR | 131 | `security_definer_view` (112), `rls_disabled_in_public` (19) |
| WARN  | 589 | `authenticated_security_definer_function_executable` (195), `anon_security_definer_function_executable` (194), `function_search_path_mutable` (183), `rls_policy_always_true` (12), `extension_in_public` (3), `public_bucket_allows_listing` (1), `auth_leaked_password_protection` (1) |
| INFO  | 5   | `rls_enabled_no_policy` |

### E.3 Findings critiques détaillés

#### E.3.1 — `public.exec_sql` granted à `authenticated` — lecture totale DB

**Grants confirmés** (via `pg_proc.proacl`) :
```
proacl = {postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}
```

**Source de la fonction** (extrait depuis `pg_proc.prosrc`) :
```sql
DECLARE
  result jsonb;
  upper_query text;
BEGIN
  upper_query := UPPER(TRIM(query_text));
  IF NOT (upper_query LIKE 'SELECT%' OR upper_query LIKE 'WITH%') THEN
    RAISE EXCEPTION 'Seules les requêtes SELECT sont autorisées';
  END IF;
  IF upper_query ~ '\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|EXECUTE|CALL)\b' THEN
    RAISE EXCEPTION 'Requête contient des mots-clés non autorisés';
  END IF;
  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query_text || ') t' INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM, 'detail', SQLSTATE);
END;
```

**Risque** : la fonction est **SECURITY DEFINER**, donc elle exécute le SELECT avec les droits de `postgres` — **la RLS du caller est bypassée**. Le filtre regex protège contre les mutations mais **pas contre la lecture de toutes les tables, toutes les orgs**.

**Exploit minimal** :
```bash
curl -X POST 'https://odspcxgafcqxjzrarsqf.supabase.co/rest/v1/rpc/exec_sql' \
  -H 'Authorization: Bearer <any-authenticated-jwt>' \
  -H 'apikey: <anon-key>' \
  -d '{"query_text":"SELECT * FROM majordhome.clients"}'
```
→ retourne **3301 clients** de toutes les orgs (actuellement Mayer, demain les 2 orgs).

**Bypass possibles supplémentaires** du regex blocklist :
- Unicode normalization / fullwidth characters
- Encodage SQL avec sous-requêtes scalaires écrites en JSON_BUILD_OBJECT
- Functions calls qui ne contiennent pas les mots-clés interdits (ex : `set_config()` via SELECT)

**Fix** : `REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM authenticated, anon;` puis supprimer la fonction si possible. Si une app l'appelle, identifier laquelle (probable Towercontrol vu le contexte) et la remplacer par des RPCs scoped par org.

#### E.3.2 — 112 vues SECURITY DEFINER bypassent la RLS

Supabase Advisor `security_definer_view` × 112. Répartition par schéma :

| Schéma | Count | Exemples |
|--------|------:|----------|
| `public` | 89 | `majordhome_clients`, `majordhome_contracts`, `majordhome_leads`, `majordhome_chantiers`, `majordhome_quotes`, `majordhome_mailing_logs`, `organizations`, `organization_members`, `profiles`, `projects`, `files`, `documents`, `apps`, etc. |
| `majordhome` | 6 | vues métier internes |
| `invoicing` | 4 | |
| `legifrance` | 2 | |
| `core` | 1 | `admin_users_stats` |
| `arpet`, `sources` | 1 chacun | |

**Vérifié spécifiquement** : sur les 73 vues `public.majordhome_*` du projet, **seules `majordhome_supplier_products` et `_write` ont `security_invoker = true`**. Toutes les autres sont en `default(definer)`.

**Conséquence** : quand le frontend fait `supabase.from('majordhome_clients').select('*').eq('org_id', orgA)`, PostgREST traduit en `SELECT * FROM majordhome_clients WHERE org_id = 'orgA'`. Comme la vue est SECURITY DEFINER, le filtre RLS sur `majordhome.clients` est **ignoré** ; seul le `WHERE org_id = 'orgA'` du caller filtre. Donc :
- Si le frontend met bien `.eq('org_id', orgId)` → OK (mais c'est de la défense applicative, pas DB)
- Si le frontend oublie le filtre OU si un attaquant requête directement `/rest/v1/majordhome_clients?org_id=eq.<other_org>` → **leak total**

**Fix** : `ALTER VIEW public.majordhome_X SET (security_invoker = true);` pour les 73 vues. Tester l'app après chaque batch :
- Certaines vues JOIN `core.profiles` (visible aux org_admin uniquement) → écrans pourraient se vider pour les non-admin
- Certaines vues utilisent des fonctions qui dépendent du contexte d'appel → peut casser

#### E.3.3 — 24 RPCs SECURITY DEFINER exposées à `anon`

Liste exhaustive confirmée via `pg_proc.proacl LIKE '%anon=%'` :

**Catégorie 1 — Admin multi-tenant** (anormalement ouvertes à `anon`) :
- `delete_organization(p_org_id, p_confirm)` ⚠️
- `delete_project(p_project_id, p_confirm)` ⚠️
- `create_organization(p_name, p_slug, ...)` ⚠️
- `create_project(p_name, p_org_id, ...)` ⚠️
- `update_organization(p_org_id, ...)` ⚠️
- `update_user_role(p_target_user_id, p_new_app_role, ...)` ⚠️
- `update_member_role(p_org_id, p_user_id, p_app_role, ...)` ⚠️
- `assign_user_to_org(p_target_user_id, p_org_id, ...)` ⚠️
- `remove_user_from_org(p_target_user_id, ...)` ⚠️

**Catégorie 2 — Mutations métier Majord'home** (peuvent toucher des données cross-org si pas de validation interne) :
- `update_majordhome_lead(p_lead_id, p_updates jsonb)` ⚠️⚠️ (jsonb arbitraire)
- `update_majordhome_task(p_task_id, p_updates jsonb)` ⚠️
- `update_majordhome_technical_visit(p_visit_id, p_updates jsonb)` ⚠️
- `find_or_create_client(p_org_id, ...)` ⚠️
- `assign_pennylane_quote_to_lead(p_org_id, p_quote_pl_id, ...)` ⚠️
- `chantier_reception_create(p_chantier_id, ...)` ⚠️
- `record_voice_memo_extraction(p_data jsonb)` ⚠️ (TOP 10 #5 confirmé)
- `link_client_auth(p_client_id, p_auth_user_id)` ⚠️

**Catégorie 3 — Webhooks / IO partagés** (probablement légitime si validation interne stricte) :
- `process_web_entretien(...)` — webhook public site
- `mailing_apply_unsubscribe(...)` — token HMAC validé par edge function
- `validate_invitation_code(p_code)` — flow d'invite
- `mail_segment_compile(p_filters, p_campaign_name, p_org_id)` — utilisé par scheduler N8n
- `mail_campaign_mark_run(p_campaign_id)` — scheduler N8n
- `meta_ads_upsert_daily_stats(p_rows)` — workflow N8n
- `gsc_upsert_metrics(p_rows)` — edge function gsc-sync
- `resend_apply_webhook_event(p_provider_id, ...)` — edge function webhook

**Recommandation** : `REVOKE EXECUTE FROM anon` sur **les catégories 1 et 2 (17 fonctions)**. Garder catégorie 3 mais auditer chaque corps pour validation stricte du caller (HMAC, signature, ou auth.uid() si conservée).

#### E.3.4 — Storage : 3 buckets ALL-authenticated

Policies actuelles (extraites de `pg_policies` schema=`storage`) :

| Bucket | Policy | Op | Clause | Risque |
|--------|--------|----|--------|--------|
| `contracts` | "Authenticated users access contracts bucket" | ALL | `(bucket_id = 'contracts'::text)` | **CRITICAL** |
| `contracts` | "Authenticated users can read contract PDFs" | SELECT | `(bucket_id = 'contracts'::text)` | (redondant) |
| `contracts` | "Service role and authenticated can upload contract PDFs" | INSERT | `(bucket_id = 'contracts'::text)` | (redondant) |
| `certificats` | "Authenticated users access certificats bucket" | ALL | `(bucket_id = 'certificats'::text)` | **CRITICAL** |
| `product-documents` | `product_documents_storage_select/insert/delete` | 3 ops | `(bucket_id = 'product-documents'::text)` | **CRITICAL** |
| `interventions` | `org_members_*_interventions` | 4 ops | check via `core.organization_members` JOIN `core.projects` | OK |
| `technical-visits` | `org_members_*_technical_visits` | 4 ops | `(storage.foldername(name))[1] IN (org_ids of user)` | OK |
| `product-images` | "Product images upload/update/delete by org members" | 3 ops | `(storage.foldername(name))[1]::uuid IN ...` | OK (mais bucket public en SELECT) |
| `premium-sources` | `premium_sources_*_own_org` | 4 ops | check via `core.profiles.org_id` | OK |
| `project-recordings` | `recordings_*_own_org` | 2 ops | check org_id via profiles | OK |
| `meeting-transcripts` | "Users can read own org transcripts" | SELECT | check org_id via profiles | OK |
| `user-workspace` | "Users can read/update/delete their own files" | 4 ops | `(storage.foldername(name))[2] = auth.uid()` | OK |
| `invoices` | "Users upload/view own invoices" | 2 ops | `(storage.foldername(name))[1] = auth.uid()` | OK |
| `invoices` | "Public read invoices" | SELECT | `(bucket_id = 'invoices'::text)` | ⚠️ public read |
| `snapstudio` | aucune policy | - | - | bucket public, aucune restriction |
| `pack-vendeur` | aucune policy | - | - | bucket privé, accessible service_role only |

**Fix bucket `contracts`** :
```sql
DROP POLICY "Authenticated users access contracts bucket" ON storage.objects;
DROP POLICY "Authenticated users can read contract PDFs" ON storage.objects;
DROP POLICY "Service role and authenticated can upload contract PDFs" ON storage.objects;

CREATE POLICY "org_members_select_contracts" ON storage.objects FOR SELECT
  USING (bucket_id = 'contracts' AND (storage.foldername(name))[1]::uuid IN (
    SELECT org_id FROM core.organization_members WHERE user_id = auth.uid() AND status = 'active'
  ));
-- idem INSERT, UPDATE, DELETE
```
+ Migrer les fichiers existants (actuellement à la racine du bucket) vers `${org_id}/${client_id}/...`.

Idem pour `certificats` et `product-documents`.

#### E.3.5 — 19 tables sans RLS exposées via PostgREST

**Schema `majordhome`** (13 tables) :
- `user_profiles` — **données utilisateurs**
- `project_access` — **table de contrôle d'accès**, ironie absolue
- `client_creation_audit` — audit log
- `home_details` — **données personnelles logement clients**
- `dpe_data` — **DPE clients**
- `lead_pennylane_quotes` — **devis financiers liés à des leads**
- `geogrid_keyword_lists` — stratégie SEO
- `geogrid_benchmarks` — historique benchmarks SEO
- `conversations`, `messages` — chat (probable feature interne)
- `dedup_candidates`, `dedup_merge_history` — déduplication
- `service_requests` — demandes service

**Schema `legifrance`** (6 tables, app Baikal) :
- `article_concepts`, `articles`, `codes`, `org_grants`, `rag_chunks`, `sync_jobs`

**Fix** : `ALTER TABLE majordhome.X ENABLE ROW LEVEL SECURITY;` + créer policies. Pattern recommandé :
```sql
ALTER TABLE majordhome.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_profiles_self" ON majordhome.user_profiles FOR ALL
  USING (user_id = auth.uid());
```

Pour les tables avec `org_id` :
```sql
ALTER TABLE majordhome.home_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "home_details_org" ON majordhome.home_details FOR ALL
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
```

#### E.3.6 — 9 policies `USING (true)` ou équivalent

Détail confirmé (cf. agent RLS audit) :

| Table | Policy | Op | Role | Clause | Action |
|-------|--------|----|----- |--------|--------|
| `majordhome.aide_requests` | "Service role full access" | ALL | `public` | `USING (true)` | DROP + CREATE filtré service_role OR org_id |
| `majordhome.certificats` | "Authenticated users can manage certificats" | ALL | `authenticated` | `USING (true)` | DROP + CREATE 4 policies org_id (cf. E.3.4 storage) |
| `majordhome.intervention_technicians` | "allow_authenticated_all" | ALL | `public` | `USING (auth.role()='authenticated')` | DROP + CREATE 4 policies via JOIN interventions.org_id |
| `majordhome.lead_activities` | `lead_activities_select_authenticated` | SELECT | `authenticated` | `USING (true)` | DROP (la version `_org_members` existe en parallèle) |
| `majordhome.lead_activities` | `lead_activities_insert_authenticated` | INSERT | `authenticated` | `CHECK (true)` | DROP |
| `majordhome.mailing_logs` | `mailing_logs_select_service` | SELECT | `public` | `USING (true)` | DROP (renommer ou cibler service_role réel) |
| `majordhome.mailing_logs` | `mailing_logs_insert_service` | INSERT | `public` | `CHECK (true)` | DROP |
| `majordhome.monthly_source_costs` | `*_insert_authenticated` | INSERT | `authenticated` | `CHECK (true)` | DROP + CREATE filtré org_id |
| `majordhome.monthly_source_costs` | `*_update_authenticated` | UPDATE | `authenticated` | `USING (true)` | DROP + CREATE filtré org_id |
| `majordhome.pricing_*` (5 tables : discounts, equipment_types, extras, rates, zones) | `*_auth` | ALL | `authenticated` | `USING (true)` | DROP + CREATE filtré org_id (sauf `equipment_types` qui est référentiel global) |
| `public.towercontrol_campaigns` | `towercontrol_campaigns_allow_all` | ALL | `public` | `USING (true)` | DROP + filtre selon métier Towercontrol |

#### E.3.7 — Tables avec `policy_count = 0` (RLS=true mais aucune policy)

- `majordhome.organizations` — équivalent à deny-all pour authenticated (sauf service_role). Voulu ?
- `majordhome.parrainage_leads` — idem
- `majordhome.pellets_orders` — idem

**Recommandation** : créer policies explicites SELECT pour les org members, sinon ces tables sont accessibles uniquement via les RPCs SECURITY DEFINER (acceptable mais à documenter).

#### E.3.8 — Cohabitation multi-app sur la même instance Supabase

L'inventaire `list_edge_functions` retourne **67 edge functions actives**. Toutes appartiennent au même projet Supabase. Inventaire par préfixe :

| Préfixe | Count | App | Statut |
|---------|------:|-----|--------|
| (no prefix) | 21 | divers (Majord'home : invite-client, create-user, delete-user, etc.) | Majord'home |
| `pv-*` | 26 | **Pack Vendeur** — app immobilière vendeur | actif |
| `baikal-*`, `ingest-*`, `trigger-*`, `generate-*`, `mcp-*`, `meeting-*`, `extract-*`, `get-concepts`, `transcribe-*` | 14 | **Baikal** — IA juridique / RAG | actif |
| `gsc-*` | 3 | Majord'home (GSC) | actif |
| `pennylane-*` | 4 | Majord'home (Pennylane) | actif |
| `voice-*`, `geogrid-*`, `avis-*`, `resend-*`, `mailing-*`, `client-*`, `google-calendar-*`, `crawl-*` | divers | Majord'home (modules) | actif |
| `calendar-*`, `leads`, `assets` | 3 | Baikal scheduling ? | actif |
| `create-test-user`, `update-test-user` | 2 | **App de test** (sans JWT !) | ⚠️ à supprimer en prod |

**Schémas DB additionnels** détectés via les findings Advisor :
- `pack_vendeur` (Pack Vendeur)
- `legifrance` (Baikal)
- `rag` (Baikal)
- `config` (config partagée)
- `sources` (Baikal sources)
- `imports` (imports généraux)
- `arpet` (autre app)
- `snapstudio` (autre app)
- `karedas` (autre app)
- `invoicing` (factures)
- `zelty` (commerce/restauration)

**Conséquence** : un user authentifié de Majord'home (org B futur) atterrissant sur cette instance a potentiellement accès, via `exec_sql` ou les vues SECURITY DEFINER, **aux données des autres apps** (Baikal RAG chunks, Pack Vendeur prospects, etc.). Inversement, un user Pack Vendeur ou Baikal compromis peut atteindre Majord'home.

**Question critique pour Eric** : ces 4+ apps sont-elles toutes business / clients différents ?
- **Si oui** : c'est une **catastrophe d'isolation** déjà présente entre tes propres apps, indépendamment de Majord'home. Le hardening doit couvrir TOUS les schémas.
- **Si non** (tests / sandboxes perso) : nettoyer maintenant pour réduire la surface.

### E.4 Mapping findings vers fixes (Annexe E.6)

| Finding | Fix |
|---------|-----|
| E.3.1 `exec_sql` ouvert | P0.0.1 |
| E.3.2 vues SECURITY DEFINER | P0.0.2, P0.0.3 |
| E.3.3 RPCs anon | P0.0.4 |
| E.3.4 storage ALL | P0.0.7 |
| E.3.5 tables sans RLS | P0.0.5 |
| E.3.6 USING(true) | P0.0.6 |
| E.3.7 RLS sans policy | P0.0.8 |
| E.3.8 multi-app | P0.0.12 (décision) |
| Advisor `function_search_path_mutable` × 183 | P0.0.10 |
| Advisor `auth_leaked_password_protection` | P0.0.11 |
| Advisor `extension_in_public` × 3 (vector, fuzzystrmatch, unaccent) | P1 (low priority, move to extensions schema) |
| Advisor `public_bucket_allows_listing` × 1 (product-images) | P1 (vérifier intentionnel) |

### E.5 Effort Phase 2

| Workstream | Effort | Risque exécution |
|---|---|---|
| `exec_sql` revoke + cleanup | 0.5j | moyen |
| Conversion vues security_invoker | 4j (avec tests) | élevé |
| Revokes anon sur RPCs | 0.5j | bas |
| Activation RLS sur 19 tables + policies | 1.5j | moyen |
| Correction 9 policies USING(true) | 1j | bas |
| Storage policies (3 buckets + migration paths) | 1j | dépend |
| Policy UPDATE manquante `chantier_line_receptions` + refactor mailing_logs/events | 0.5j | bas |
| Audit corps RPCs sensibles | 2j | bas |
| search_path mutable × 183 | 1j | bas |
| HaveIBeenPwned activation | 0.1j | bas |
| Décision apps cohabitantes | 0.5j (décision) | dépend |
| **Total** | **~12 j-h** | |

À 1 dev DB full-time, **2 semaines calendaires** avec tests intercalés et retours arrière éventuels (notamment sur les vues converties).

### E.6 Risque résiduel après Phase 2

Même tous les fixes appliqués, plusieurs risques persistent :

1. **Cohabitation multi-app** non résolue par les fixes ci-dessus. Si les autres apps gardent leurs propres vues SECURITY DEFINER et leurs propres tables sans RLS, le cross-pollination reste possible. → décision stratégique nécessaire.
2. **Conversion vues security_invoker** peut casser des écrans dépendant de joins avec `core.profiles` (visibles aux org_admin uniquement). Tests UI obligatoires.
3. **183 fonctions sans search_path** corrigées en patch global, mais aucune ne dispose actuellement de tests unitaires — régression silencieuse possible. Recommandé : dump de test représentatif Mayer dans un projet Supabase staging avant migration.
4. **Audit du corps des 195 RPCs authenticated-callable** non couvert en Phase 2 (seulement échantillon). Risque qu'une RPC tierce non flaggée par l'advisor accepte un `p_org_id` sans valider — à instruire en P1 par grep sur `pg_proc.prosrc`.

### E.7 Recommandation finale Phase 2

**Avant** d'engager le moindre développement frontend / edge function pour le multi-tenant, **exécuter Sem 0 sur un projet Supabase staging** :

1. Cloner les schémas DB vers un projet de test (`pg_dump --schema-only` + restore)
2. Appliquer toutes les corrections P0.0.x
3. Tester l'app Majord'home Mayer complète sur le staging
4. Si OK : appliquer en prod un par un les changements, avec rollback prêt
5. Une fois Sem 0 validé en prod, démarrer Sem 1 (edge functions)

**Anti-pattern à éviter** : appliquer directement en prod les changements RLS sans staging — risque de casser silencieusement des écrans / cron / webhooks. Le coût d'un projet Supabase staging temporaire (Pro plan ~25 €/mois) est négligeable face au risque.

---

**Prochaine étape** : validation de ce rapport (avec annexe E) par Eric, décision sur la stratégie staging vs prod, puis exécution Semaine 0 (hardening DB).
