# Spec — Offres & Inscriptions (capture campagne → dashboard Webshop)

> **Date** : 2026-06-21
> **Statut** : Design validé (en attente relecture Eric avant plan d'implémentation)
> **Module** : Webshop (`src/apps/artisan/pages/Webshop.jsx`) ↔ Mailing (campagnes)

## 1. Contexte & objectif

Eric pousse régulièrement des **offres** aux clients/prospects Mayer (bûche compressée Bricafeu, granulés, parrainage, clim d'été…). Le flux actuel :

> campagne créée dans **Majord'home (Mailing)** → CTA vers une **page du site** (`mayer-energie.fr/offre-xxx`) → l'internaute s'inscrit.

**Le trou** : les inscriptions n'atterrissent nulle part d'exploitable.
- L'offre **bûche compressée** (campagne `decouverte_de_la_buche_compresse`, 2 608 envois le 12/06) : **0 inscription capturée** — le CTA pointait vers le site, sans aucun retour en base.
- L'offre **granulés** : capturée, mais via un moteur **codé en dur** (RPC `inscrire_*_pellets`, flags sur `clients`) **sans aucune UI** → Eric doit demander à Claude d'exécuter `export_pellets_inscriptions` pour voir qui s'est inscrit.

**Objectif** : un **dashboard self-service dans l'onglet Webshop** qui capte et affiche les inscriptions de **n'importe quelle offre**, regroupées par campagne — sans passer par Claude.

**Critères de succès :**
- Un formulaire web qui POST une inscription → la ligne apparaît dans **Webshop → Inscriptions** en quelques secondes, scopée à l'org d'Eric.
- Filtrable **par campagne** ; détail contact dépliable ; **export CSV**.
- **Générique** : une nouvelle offre = une nouvelle campagne (réutilisation de sa `key`), **zéro changement de code**.
- L'inscription **rattache/crée** un client CRM (dédoublonnage email/phone) et gère le **code de parrainage** (parité avec le moteur granulés).

## 2. Décisions validées (avec Eric, 2026-06-21)

| Sujet | Décision |
|-------|----------|
| Hébergement des formulaires | **Option A** : le **site héberge la page** (créée par offre) ; Majord'home = définition (campagne) + endpoint de capture + dashboard |
| Identité d'une offre | **Réutiliser `mail_campaigns.key`** comme clé d'offre — pas de nouvelle entité « catalogue d'offres ». C'est ce qui « couple les campagnes au Webshop » |
| Emplacement du dashboard | Nouveau sous-onglet **« Inscriptions »** dans Webshop (à côté de Commandes / Produits & tarifs) |
| Création client | Oui : l'inscription **dédoublonne par email/phone** puis crée un client + projet sinon (parité granulés) ; parrainage résolu |
| Personnalisation (pré-remplissage par token) | **Hors V1** → Lot 2 (réutilisera le mécanisme token déjà en base) |
| Générateur de formulaire hébergé par l'app (Option B) | **Hors V1** → Lot 2 |

## 3. Découverte clé — le moteur « pellets » existant

Tout un moteur d'inscription **existe déjà en base** (RPC `SECURITY DEFINER`), construit pour la campagne granulés :

| RPC | Rôle |
|-----|------|
| `inscrire_prospect_pellets(...)` | nouveau prospect (dédoublonne email/phone, crée `core.projects` + `majordhome.clients`, résout le parrainage) |
| `inscrire_client_pellets(token, …)` | client existant via **lien personnalisé** (token mono-usage) |
| `get_client_by_pellets_token(token)` | pré-remplissage de la landing |
| `creer_commande_pellets(...)` | insert `pellets_orders` (produit + quantité) |
| `generate_missing_pellets_tokens()` / `list_clients_with_pellets_tokens()` | génération/listing des tokens (audience d'envoi) |
| `export_pellets_inscriptions(since, until)` | export |

**Pourquoi on ne le réutilise pas tel quel** : c'est un modèle « **offre = flag sur le client** » (`clients.pellets_total_token`, `pellets_total_inscrit_at`, token **mono-usage mono-offre**, **org core hardcodée** `3c68…`). Il faudrait **une colonne par offre** → ne scale pas. On le remplace par une **table générique d'inscriptions clé-en-campagne**. Le moteur pellets **reste en service tel quel** (aucune régression) ; sa migration vers la table générique est un chantier Lot 2.

## 4. ⚠️ Gotcha `org_id` — critique (verrouille tout le design)

Les org_id ne sont **pas alignés** entre les tables :

| Table | org_id | Nb |
|-------|--------|----|
| `majordhome.clients` | **`3c68…` (core)** | 3460 |
| `majordhome.mail_campaigns` | **`3c68…` (core)** | 16 |
| `core.organization_members` (membership Eric) | **`3c68…` (core)** | ✓ |
| `majordhome.webshop_orders` | **`7825…` (majordhome)** | 1 |

`webshop_orders` utilise l'org **majordhome** (`7825…`), or **aucun** `core.organization_members` ne porte `7825…` → la policy RLS `org_id IN (core.organization_members…)` **ne matche jamais** → l'unique commande webshop est **invisible dans l'UI** (cf. capture « Toutes (0) »). **Bug latent du module Webshop**, signalé hors-scope (§12).

**Décision** : `campaign_inscriptions` s'aligne sur l'**org CORE** (`3c68…`), **dérivée de `mail_campaigns.org_id`**. RLS sur `core.organization_members`. C'est le seul choix cohérent avec `clients` (prouvé : 3460 lignes visibles) et avec la membership d'Eric. **Ne PAS utiliser `getMajordhomeOrgId()` ici.**

## 5. Architecture & flux

```
[ Page site mayer-energie.fr/offre-xxx ]   ← créée par offre (côté site)
        │  supabase.rpc('inscription_record',
        │     { p_campaign_key:'decouverte_de_la_buche_compresse', p_payload:{…} })   (clé anon)
        ▼
public.inscription_record()  (SECURITY DEFINER)
        │  • org dérivée de mail_campaigns.key  → 3c68 (core)
        │  • dédoublonne email/phone → client_id (ou crée client+projet)
        │  • résout parrainage_code → parrain_id
        ▼
INSERT majordhome.campaign_inscriptions   (1 ligne = 1 inscription)
        ▲
        │  SELECT (RLS org-scopée, security_invoker)
[ Webshop → onglet « Inscriptions » ]  ── filtre campagne · détail · export CSV
```

- **Code (cette spec)** : table + vue + 1 RPC + service/hook + sous-onglet Webshop.
- **Dépendance Eric (site)** : la page d'offre appelle `inscription_record` (§9). Petit branchement JS, **clé anon comme la page borne lit déjà les tarifs**.

## 6. Modèle de données

### 6.1 Table `majordhome.campaign_inscriptions`

| Colonne | Type | Note |
|---------|------|------|
| `id` | uuid PK | `gen_random_uuid()` |
| `org_id` | uuid NOT NULL | FK `core.organizations` — **core (3c68)**, dérivée de la campagne |
| `campaign_key` | text NOT NULL | = `mail_campaigns.key` |
| `client_id` | uuid NULL | FK `majordhome.clients` (rattaché/créé) |
| `lead_id` | uuid NULL | optionnel |
| `first_name`, `last_name`, `email`, `phone` | text | contact (au moins email **ou** phone requis) |
| `address`, `postal_code`, `city` | text NULL | |
| `data` | jsonb NOT NULL `'{}'` | champs spécifiques à l'offre (quantité, intérêt, message…) |
| `parrainage_code_used` | text NULL | code saisi par l'inscrit |
| `parrain_id` | uuid NULL | client parrain résolu |
| `source` | text NULL | ex. `website`, `email` |
| `from_token` | bool `false` | lien personnalisé (Lot 2) |
| `created_at` | timestamptz `now()` | |

- Index : `(org_id, campaign_key, created_at DESC)`, `(email)`.
- **RLS activée** ; policies calquées sur `webshop_orders` mais **SELECT/UPDATE/DELETE seulement** pour `authenticated` org-members. **Pas d'INSERT** direct (ni anon ni authenticated) → écriture **uniquement** via la RPC SECURITY DEFINER.
- `GRANT SELECT ON majordhome.campaign_inscriptions TO service_role` (charte : table lue via vue publique `security_invoker`).

### 6.2 Vue publique `public.majordhome_campaign_inscriptions`

`CREATE VIEW … WITH (security_invoker = true)` :
```sql
SELECT i.*,
       mc.label  AS campaign_label,
       c.display_name AS client_display_name,
       c.client_number
FROM majordhome.campaign_inscriptions i
LEFT JOIN majordhome.mail_campaigns mc ON mc.key = i.campaign_key AND mc.org_id = i.org_id
LEFT JOIN majordhome.clients c        ON c.id  = i.client_id;
```
(Vue simple → reste lisible ; `GRANT SELECT` à `authenticated`, `anon`, `service_role` selon le pattern existant des vues `majordhome_*`.)

## 7. RPC `public.inscription_record`

```
inscription_record(p_campaign_key text, p_payload jsonb, p_token text DEFAULT NULL)
  RETURNS json   -- LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public, majordhome, core, extensions
```

Logique :
1. **Org dérivée** : `SELECT org_id INTO v_org FROM majordhome.mail_campaigns WHERE key = p_campaign_key`.
   - 0 ligne → `{success:false, error:'campagne_inconnue'}` ; >1 ligne (multi-org) → `{success:false, error:'campagne_ambigue'}` (cf. §11).
2. **Extraction** depuis `p_payload` : `first_name,last_name,email,phone,address,postal_code,city,parrainage_code,source` ; **le reste** des clés → `v_data jsonb`.
3. **Validation** : `first_name` + `last_name` + (`email` OU `phone`) sinon `champs_obligatoires_manquants`.
4. **Résolution client** (réutilise la logique de `inscrire_prospect_pellets`, mais `v_org` dérivée, pas hardcodée) :
   - dédoublonnage par `lower(email)` OU phone normalisé, scoping `org_id = v_org`, `is_archived=false` ;
   - si trouvé → `v_client_id` (+ MAJ douce des champs vides) ;
   - sinon → INSERT `core.projects` + `majordhome.clients` (org `v_org`, `parrainage_code` généré).
   - parrainage : si `parrainage_code` fourni → résoudre `parrain_id`.
5. **INSERT** `campaign_inscriptions` (toujours, même si client existant) avec `org_id=v_org`, `campaign_key`, contact, `data`, `parrainage_code_used`, `parrain_id`, `from_token = (p_token IS NOT NULL)`.
6. **Retour** `{success:true, inscription_id, client_id, is_new_client, parrain_found, parrainage_code}`.

**Droits** : `GRANT EXECUTE TO anon, authenticated` — **endpoint public légitime de capture** (l'org est **dérivée de la campagne, jamais prise dans le payload** → un attaquant ne peut pas forger d'org ; même posture que les RPC `inscrire_*_pellets` actuelles). `REVOKE EXECUTE FROM public`.

## 8. Détail Frontend

### 8.1 `src/shared/services/inscriptions.service.js` (nouveau)
- `getInscriptions({ orgId, campaignKey } )` → `from('majordhome_campaign_inscriptions').select('*').eq('org_id', orgId)` (défense en profondeur) `[.eq('campaign_key', …)]` `.order('created_at',{ascending:false})`. Retour `{ data, error }` via `withErrorHandling`.
- Pas de méthode d'écriture côté app (capture = site uniquement).

### 8.2 `src/shared/hooks/useInscriptions.js` + `cacheKeys.js`
- Famille `inscriptionKeys` (convention P0.11, orgId en 1ᵉʳ) :
  ```js
  export const inscriptionKeys = {
    all: (orgId) => ['inscriptions', orgId],
    list: (orgId, campaignKey) => [...inscriptionKeys.all(orgId), 'list', campaignKey ?? 'all'],
  };
  ```
- `useInscriptions(campaignKey)` : `useQuery`, `enabled: !!orgId`, `orgId = useAuth().organization.id` (core).

### 8.3 `src/apps/artisan/pages/Webshop.jsx` + `components/webshop/InscriptionsTab.jsx` (nouveau)
- Ajouter un **3ᵉ onglet** « Inscriptions ».
- **Extraire `InscriptionsTab` dans son propre fichier** (`components/webshop/InscriptionsTab.jsx`) : `Webshop.jsx` fait déjà **566 LOC > 500** (seuil charte) → ne pas l'alourdir inline. *(Le découpage de `OrdersTab`/`ProductsTab` est de la dette adjacente → à signaler, pas à embarquer — Posture #3.)*
- UI `InscriptionsTab` : barre de filtre **par campagne** (liste des `campaign_key` distincts + `campaign_label`, dérivée des lignes chargées), liste type `OrderRow` (contact + date + campagne + ligne dépliable affichant `data`), bouton **Export CSV** (génération client-side depuis les lignes chargées → `Blob`/download, pas de RPC).
- Permission : lecture réservée aux mêmes rôles que le reste de Webshop (org-members ; pas de garde fine en V1).

## 9. Contrat site web (dépendance Eric)

La page d'offre appelle (clé anon Supabase) :
```js
const { data } = await supabase.rpc('inscription_record', {
  p_campaign_key: 'decouverte_de_la_buche_compresse', // = mail_campaigns.key
  p_payload: {
    first_name, last_name, email, phone,         // contact
    address, postal_code, city,                  // optionnels
    source: 'website',
    parrainage_code,                             // optionnel
    // …tout autre champ propre à l'offre → atterrit dans data jsonb
    quantite: 2, interesse_livraison: true
  }
});
// data = { success, inscription_id, client_id, is_new_client, parrain_found, parrainage_code }
```
- **Pré-requis** : la campagne doit exister dans Mailing avec cette `key` (sinon `campagne_inconnue`).
- Pas de token en V1 (formulaire anonyme).

## 10. Sécurité (charte multi-tenant)

- Nouvelle table `majordhome.*` → **RLS** + policies org-scopées + **`GRANT SELECT … TO service_role`** + vue publique **`security_invoker=true`**. ✓
- RPC SECURITY DEFINER → **org dérivée de la campagne, pas du payload** → `anon` autorisé (capture publique légitime). `SET search_path` explicite. ✓
- Lectures front : **`.eq('org_id', orgId)`** explicite (défense en profondeur) en plus de la RLS. ✓
- **Pas** de SQL dynamique, **pas** d'`exec_sql`, **pas** de `.or()/.ilike()` interpolant l'input (filtre campagne = `.eq` sur valeur contrôlée). ✓
- `localStorage` : aucun.

## 11. Edge cases & gotchas

- **`org_id` core vs majordhome** : tout le système est sur **core (3c68)** (§4). Ne jamais router une inscription via `getMajordhomeOrgId()`.
- **Ambiguïté `campaign_key` (multi-tenant)** : si deux orgs partagent une `key`, `inscription_record` lève `campagne_ambigue`. **Recommandation** : index `UNIQUE (key)` sur `mail_campaigns` (ou résolution `(org_id, key)` si on passe l'org plus tard — mais alors l'org sort du payload, on garde la dérivation par key).
- **Abus (anon crée des clients)** : même profil de risque qu'aujourd'hui (RPC pellets anon créent déjà des clients). Dédoublonnage email/phone en place. **Future** : honeypot/captcha côté site, validation format email — noté, hors V1.
- **`campaign_key` inconnue** → `campagne_inconnue` (le site doit afficher une erreur propre).
- **`data` arbitraire** : champs libres affichés tels quels dans le détail (pas de schéma figé en V1 — c'est voulu pour rester générique).

## 12. Hors scope (V1)

- **Lot 2 — personnalisation** : `inscription_prefill(token, campaign_key)` (généralise `get_client_by_pellets_token`) + **token durable réutilisable** (`clients.campaign_link_token`) + **merge du token dans le CTA** côté Mailing → pré-remplissage des clients existants.
- **Lot 2 — Option B** : générateur de formulaire **hébergé par l'app** (autonomie totale sans toucher au site).
- **Lot 2 — migration** du moteur pellets vers `campaign_inscriptions`.
- **Bug Webshop org (§4)** : `webshop_orders.org_id = 7825` (majordhome) invisible en UI → **tâche séparée** (corriger l'org à l'ingestion ou la base RLS). N'appartient pas à cette feature.

## 13. Validation

- `npx vite build` passe (pas de preview tools — serveur de dev géré par Eric).
- Vérif manuelle Eric : un POST `inscription_record` (campagne test) → la ligne apparaît dans **Webshop → Inscriptions**, scopée à son org ; filtre par campagne OK ; export CSV OK ; un 2ᵉ POST même email ne duplique pas le client (dédoublonnage) mais ajoute bien une ligne d'inscription.
- Vérif SQL : `SELECT has_table_privilege('service_role','majordhome.campaign_inscriptions','SELECT')` = true.

## 14. Fichiers touchés (récap)

| Fichier | Nature |
|---------|--------|
| `supabase/migrations/20260621_campaign_inscriptions.sql` | table + index + RLS + policies + grants + vue + RPC `inscription_record` |
| `src/shared/services/inscriptions.service.js` | nouveau service (lecture) |
| `src/shared/hooks/useInscriptions.js` | nouveau hook |
| `src/shared/hooks/cacheKeys.js` | + `inscriptionKeys` |
| `src/apps/artisan/components/webshop/InscriptionsTab.jsx` | nouveau sous-onglet |
| `src/apps/artisan/pages/Webshop.jsx` | + onglet « Inscriptions » (montage `InscriptionsTab`) |
| *(dépendance site, hors repo)* | page d'offre → appel `inscription_record` |
