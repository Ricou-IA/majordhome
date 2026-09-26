# Baikal ↔ Majord'home — activation des modules par organisation

> Spec validée avec Eric le 2026-09-26. Baikal (`C:\Dev\Frontend-Baikal`) est la console
> d'administration des apps. Partie **Majord'home** : ce dépôt. Partie **Baikal** : session
> dédiée sur le dépôt Baikal, qui part de ce document (§ 4 = contrat, § 6 = à faire côté Baikal).

## 1. Besoin

Eric ouvre ou ferme, depuis Baikal, les modules de chaque organisation cliente de
Majord'home (décision commerciale — jamais l'org_admin du client). Premier cas : l'usine
Bricafeu, qui n'a que le module de tâches récurrentes ; demain un dépôt qui s'en sert pour
de la traçabilité.

## 2. État avant

- Drapeaux dans `core.organizations.settings.modules` (projet `ejqqqwudmizqisdkxohw`),
  posés à la main en SQL. Seuls `communication` et `maintenance` étaient lus.
- Exception `settings.modules.crm === false` (livrée le 2026-09-25) pour masquer le CRM.
- Baikal lit la base Majord'home (`baikal_reader`, lecture seule) mais n'y écrit rien.
  Il possède un canal d'écriture éprouvé avec Pack Vendeur : edge d'administration du site
  appelée avec l'anon key publique + secret partagé `X-Baikal-Key` (`admin-dossiers/relais.ts`).

## 3. Modèle des modules (Majord'home)

Registre unique `src/lib/modules.js` (pur, testé, copié pour Deno). Chaque module
**activable** porte `parDefaut` : état quand l'org n'a pas de drapeau explicite.

| Clé | Libellé | parDefaut | Ce qu'il ouvre |
|---|---|---|---|
| `crm` | CRM artisan | `true` | Dashboard, Clients, Planning, Pipeline, Chantiers, Tâches, Territoire, Mailing, GeoGrid, Meta Ads, Prospection… + tuiles socle hors `horsCrm` |
| `entretiens` | Entretiens & Contrats | `true` | Contrats, Entretiens, Tarification, Tournées |
| `communication` | Communication | `false` | envoi e-mail des factures (règle existante) |
| `solaire` | Solaire | `true` | `/solaire` et ses réglages |
| `thermique` | Thermique | `true` | `/thermique` et ses réglages |
| `maintenance` | Tâches récurrentes | `false` | borne, suivi, registre, e-mail du soir |

- `moduleActif(settings, key)` : `settings.modules[key]` s'il est booléen, sinon `parDefaut`.
  Le socle (Organisation, Équipe, Droits, Emails…) n'est pas activable.
- Les `parDefaut: true` reproduisent l'existant : **aucun changement pour Mayer**.
- `crm` remplace l'exception `crm === false` (même effet : sidebar et Paramètres réduits,
  accueil vers le premier module ouvert).
- Un module fermé est masqué dans la sidebar ET dans Paramètres, et ses routes renvoient à
  l'accueil (`ModuleGate`) — une case décochée dans Baikal ne doit pas laisser l'URL ouverte.
- La clé technique `maintenance` est conservée (tables `maint_*`, routes `/maintenance`) ; le
  **vocabulaire affiché** est réglable par org (§ 5).

## 4. Contrat du canal (edge `baikal-admin`, projet Majord'home)

- `POST {SUPABASE_URL}/functions/v1/baikal-admin`, `verify_jwt = false` (l'anon key passe
  le gateway ; l'autorisation réelle est le secret).
- En-têtes : `apikey` + `Authorization: Bearer <anon key>` (gateway), **`X-Baikal-Key`**
  = secret partagé, comparé en temps constant à `MDH_BAIKAL_KEY` (côté Majord'home). Absent
  ou faux ⇒ 401 `{ error: 'unauthorized' }`.
- Corps : `{ "action": "<nom>", ...paramètres }`. Réponses JSON, erreurs `{ error, detail? }`.

| Action | Paramètres | Réponse 200 |
|---|---|---|
| `manifeste` | — | `{ app: 'majordhome', version: 1, actions: ['manifeste','catalogue','organisations','modules'] }` |
| `catalogue` | — | `{ modules: [{ key, label, description, parDefaut }] }` (lu dans le registre, jamais recopié par Baikal) |
| `organisations` | — | `{ organisations: [{ id, nom, modules: { [key]: boolean } }] }` — `modules` = état **effectif** (défauts appliqués), trié par nom |
| `modules` | `org_id` (uuid), `modules` (`{ [key]: boolean }`, au moins une clé), `auteur` (texte libre, ex. e-mail de l'admin Baikal) | `{ organisation: { id, nom, modules } }` après écriture |

Erreurs de `modules` : 400 `invalid_body` (org_id non uuid, objet vide, valeur non booléenne),
400 `unknown_module` (`detail` = clés inconnues du catalogue), 404 `org_not_found`.
Action inconnue : 400 `unknown_action`. Erreur serveur : 500 (message nettoyé par
`sanitizeError`).

Écriture : RPC `public.org_set_modules(p_org_id uuid, p_modules jsonb, p_auteur text)`
SECURITY DEFINER, **service_role seulement** (`REVOKE … FROM PUBLIC, anon, authenticated` :
elle prend `org_id` en paramètre). Fusion dans `settings.modules` (les autres clés de
`settings` intactes), refus de toute valeur non booléenne, trace dans la table
`majordhome.org_modules_journal` (org, date, auteur, avant, après) — RLS sans aucune policy :
invisible des membres du client (`settings` est lisible par tout membre, on n'y range donc pas
l'identité de l'admin Baikal).

## 5. Vocabulaire du module de tâches récurrentes

`settings.maintenance.vocabulaire = { module, unite, unites }`, défauts « Maintenance »,
« Unité », « Unités » ; éditable Settings → Maintenance → onglet Vocabulaire. Helper pur
`vocabulaire(settings)` (`src/lib/maintenance/vocabulaire.js`, copié pour Deno). Consommé par
la sidebar, les titres des pages, la borne, l'e-mail du soir et le registre PDF.
Ex. dépôt : « Traçabilité », « Zone », « Zones ».

## 6. À faire côté Baikal (session dédiée)

1. Registre des sites : pour `majordhome`, renseigner l'URL du projet, l'anon key publique et
   un nom de secret (ex. `MAJORDHOME_BAIKAL_KEY`) dont la **valeur** est identique à
   `MDH_BAIKAL_KEY` côté Majord'home ; nom de la fonction : `baikal-admin`. Le champ
   `env_dossiers_fn` sert aujourd'hui au canal « dossiers » : décider (côté Baikal) si l'on
   réutilise ce champ ou si l'on en ajoute un pour ce canal.
2. Edge Baikal qui relaie `catalogue`, `organisations`, `modules` (contrôle
   `exigerModule(…, 'ecriture')` pour `modules`), en passant l'e-mail de l'admin en `auteur`.
3. Écran « Modules » sur la fiche Majord'home : une ligne par organisation, une case par
   module du catalogue (libellé + description), état effectif, enregistrement par ligne,
   erreurs du canal affichées (jamais de succès supposé).

## 7. Hors périmètre

Création d'une organisation / d'un compte depuis Baikal (même canal, plus tard) ; modules
facturés (plan, dates) ; activation par l'org_admin.
