# SPEC — App Solaire : calculateur de rentabilité photovoltaïque (intégré Majord'home)

> **Date** : 2026-06-10 · **Statut** : validée avec Eric (option A — intégration Majord'home)
> **Origine** : spec standalone « mayer-pv-calc » v1.0 (10 juin 2026), adaptée à l'écosystème Majord'home.
> **Objectif** : outil d'aide à la vente terrain pour les commerciaux — simulation de rentabilité PV honnête et conservatrice en < 5 min chez le client, mobile-first.

---

## 1. Contexte & objectif

Outil utilisé par les commerciaux **en rendez-vous chez le client** (mobile/tablette d'abord). Produit une simulation de rentabilité photovoltaïque basée sur la production solaire réelle du lieu (API PVGIS) et démontre qu'avec un financement adapté **l'opération peut être neutre en trésorerie** (mensualité ≈ économies).

### Contexte réglementaire (arrêté du 1er juin 2026, applicable depuis le 5 juin 2026)
- Tarif d'achat du surplus : 1,1 c€/kWh HT (indexé 2 %/an, contrat 20 ans) — économiquement négligeable.
- **Prime à l'autoconsommation : SUPPRIMÉE.**
- Vente totale : non éligible ≤ 9 kWc.
- **Décision produit : la revente du surplus est IGNORÉE dans les calculs** (valorisée à 0 €). Le surplus est affiché comme « énergie perdue » — argument de dimensionnement, pas un revenu. Approche conservatrice = argument de crédibilité commerciale.
- TVA 5,5 % applicable aux installations résidentielles éligibles. La grille de coûts est saisie **en € TTC posé** ; `vat_rate` est un paramètre informatif (affichage « TVA 5,5 % incluse »), pas de calcul HT/TTC en v1.

Toute la valeur économique vient de **l'électricité autoconsommée** (kWh non achetés au fournisseur).

---

## 2. Décisions d'intégration (deltas vs spec standalone)

| Sujet | Spec d'origine | Décision retenue |
|---|---|---|
| Enveloppe | Nouveau repo `mayer-pv-calc`, TS, Vercel séparé | **Option A** : app interne `src/apps/solaire/` du repo Majord'home, **JSX** (convention repo), même déploiement |
| Auth | Login Supabase dédié | Auth Majord'home existante. Permission DB **`pv_calculator.use`** (pattern `voice_recorder` P0.10), configurable Settings → Permissions. Seed Mayer : commercial ✅, team_leader ✅, technicien ❌, org_admin bypass auto |
| Paramètres admin | Table `app_settings` clé/valeur | **`core.organizations.settings.pv`** (jsonb) via `useOrgSettings()` + page **`/settings/solaire`** (org_admin only) |
| Simulations | Table `simulations` mono-tenant | **`majordhome.pv_simulations`** : org_id NOT NULL + RLS + vue publique `security_invoker` (charte multi-tenant) |
| Proxy PVGIS | API route Vercel `/api/pvgis` | **Edge function Supabase `pvgis-proxy`** (`verify_jwt:true` + `requireOrgMembership`) |
| Grille de coûts | Format ouvert (€/kWc ou palier) | **Tableau de configurations explicites** `[{kwc, prix_ttc}]` entre 1 et 9 kWc, enrichi au fil de l'eau. Interpolation linéaire entre points ; grille vide/incomplète → saisie manuelle du coût (champ toujours éditable par le commercial) |
| Rattachement CRM | `client_name` texte libre | Idem v1, **mais colonnes `lead_id` / `client_id` nullables posées dès la migration** (liaison UI = évolution future) |

Le cœur métier (moteur de calcul §8, optimiseur §9, module VE, palette deutan) est repris **à l'identique** de la spec d'origine.

---

## 3. Parcours utilisateur (3 étapes max)

1. **Localisation & toiture** — bouton « 📍 Me localiser » (GPS device) OU saisie d'adresse (autocomplétion data.gouv). Pente toiture en **%** (langage BTP, conversion en degrés affichée, ex « 18 % ≈ 10° »), orientation (boussole 8 directions ou degrés), surface disponible (m²).
2. **Consommation client** — saisie des **12 consommations mensuelles en kWh** (clavier numérique mobile). Bouton « répartir depuis l'annuel » si le client n'a que le total (profil résidentiel standard, ajustable mois par mois ensuite). Prix du kWh (défaut admin). Profil de présence → coefficient de simultanéité. **Bloc repliable « Véhicule électrique »** : km/an + conso véhicule + cases « recharge pilotée en journée » et « ajouter la borne ».
3. **Résultats** — bandeau 3 scénarios (§9), graphique barres mensuel, module financement (taux/durée/apport → mensualité live), tableau annuel (§8.7) + graphique cumul avec point de bascule, bouton « Enregistrer la simulation » (nom client + commentaire).

\+ **Historique** : liste des simulations du commercial (recherche par nom client), rechargement à l'identique.
\+ **Admin** `/settings/solaire` : tous les paramètres (§6).

Brouillon de saisie persisté en `localStorage` clé **`pv-draft:${userId}`** (convention P1.9) — un RDV interrompu ne perd pas la saisie.

---

## 4. Architecture & fichiers

```
src/apps/solaire/
├── pages/
│   ├── Simulateur.jsx          # orchestrateur wizard 3 étapes (useReducer, state interne)
│   └── Historique.jsx          # liste + recherche + rechargement
├── components/
│   ├── Step1Localisation.jsx   # GPS / adresse / pente / orientation / surface
│   ├── Step2Consommation.jsx   # grille 12 mois / prix kWh / présence / bloc VE
│   ├── Step3Resultats.jsx      # scénarios / graphiques / financement / tableau annuel
│   └── ...                     # sous-composants (ScenarioCard, TableauAnnuel, etc.)
└── lib/
    ├── pvEngine.js             # moteur de calcul PUR (zéro import React, testable isolément)
    └── pvgis.js                # appel edge function + géocodage data.gouv + géoloc device

src/shared/services/pv.service.js      # CRUD simulations via vue publique (org_id explicite)
src/shared/hooks/usePvSimulations.js   # React Query (cache keys pvKeys)
src/shared/hooks/cacheKeys.js          # + famille pvKeys : all: (orgId) => ['pv', orgId]
src/apps/artisan/pages/settings/SolaireSettings.jsx   # page admin /settings/solaire
supabase/functions/pvgis-proxy/index.ts               # proxy PVGIS
```

- Routes `solaire` et `solaire/historique` dans `src/apps/artisan/routes.jsx`, wrappées `<RouteGuard resource="pv_calculator" action="use">`. Route `settings/solaire` wrappée `RouteGuard resource="settings"` + guard `isOrgAdmin` in-component (pattern OrganizationSettings).
- Entrée sidebar « Solaire » (icône `Sun`) dans `AppLayout.jsx`, masquée si `!can('pv_calculator', 'use')`.
- Conventions qualité applicables : composants < 500 LOC (orchestrateur + sections), wizard en `useReducer`, logique business dans `pvEngine.js`/hooks jamais dans le JSX, `logger` au lieu de `console.*`, Tailwind only.

---

## 5. Modèle de données & sécurité

### Table `majordhome.pv_simulations`
```sql
create table majordhome.pv_simulations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references core.organizations(id),
  created_by uuid not null references auth.users(id),
  client_name text,
  client_address text,
  lat double precision,
  lon double precision,
  lead_id uuid references majordhome.leads(id) on delete set null,      -- liaison CRM future
  client_id uuid references majordhome.clients(id) on delete set null,  -- liaison CRM future
  inputs jsonb not null,         -- toutes les saisies (toiture, conso 12 mois, prix, profil, VE, financement)
  pvgis_monthly jsonb not null,  -- { e_m: [12 valeurs kWh à 1 kWc], e_y, params, fetched_at }
  results jsonb not null,        -- scénario retenu + indicateurs clés (recalculables depuis inputs)
  comment text,
  created_at timestamptz default now()
);
```

### Charte multi-tenant (obligatoire dès la migration)
- **RLS activée** + policies : SELECT `org_id IN (org_members de auth.uid()) AND (created_by = auth.uid() OR rôle org_admin sur cette org)` — le commercial ne voit que ses simulations, l'admin voit tout. INSERT : membre org + `created_by = auth.uid()`. UPDATE/DELETE : owner ou org_admin.
- Vue publique **`public.majordhome_pv_simulations`** créée `WITH (security_invoker=true)`, `SELECT *` simple (mono-table, sans JOIN) → **auto-updatable** : lectures ET écritures frontend passent par elle (gotcha : vue + JOIN = non-updatable, a déjà cassé la prod).
- **`GRANT SELECT ON majordhome.pv_simulations TO service_role`** dans la même migration (régression connue du 2026-05-27 sinon : 42501 silencieux côté edge functions).
- Toute requête frontend filtre **explicitement** `.eq('org_id', orgId)` (défense en profondeur).
- Recherche historique par nom client : `.ilike()` passe par **`escapePostgrestSearchTerm()`** (P0.26).
- Permission : seed `majordhome.role_permissions` pour Mayer — resource `pv_calculator`, action `use` : commercial=true, team_leader=true, technicien=false (via `org_upsert_role_permission` ou migration).

---

## 6. Paramètres admin — `core.organizations.settings.pv`

Lus/écrits exclusivement via `useOrgSettings()` (canal canonique). Shape :

```jsonc
{
  "pv": {
    "default_price_kwh": 0.20,        // €/kWh TTC — ⚠️ à ajuster au TRV en vigueur
    "inflation_rate": 0.03,           // +3 %/an prix élec
    "degradation_rate": 0.005,        // −0,5 %/an panneaux
    "horizon_years": 25,
    "system_loss": 14,                // % pertes système (défaut PVGIS)
    "panel_power_wc": 500,
    "panel_area_m2": 2.26,
    "default_tilt_percent": 18,       // ≈ 10,2°
    "autoconso_threshold": 0.85,      // seuil optimiseur (recouvrement pré-coefficient)
    "max_power_kwc": 9,               // plafond offre résidentielle (régime réglementaire ≤ 9 kWc)
    "simultaneity": {
      "presence_journee": 0.70,
      "presence_partielle": 0.55,     // défaut
      "absent_journee": 0.45,
      "bonus_ecs": 0.10,              // pilotage ECS/domotique (argument Mayer CVC/ENR)
      "bonus_ve": 0.10,               // recharge VE pilotée en journée
      "cap": 0.85                     // plafond global
    },
    "cost_grid": [],                  // [{ "kwc": 3, "prix_ttc": 8990 }, ...] — 1 à 9 kWc, rempli au fil de l'eau
    "default_loan_rate": 0.045,
    "default_loan_years": 12,
    "vat_rate": 0.055,                // informatif (grille en TTC)
    "ev": {
      "charger_price": null,          // € TTC borne posée — à remplir par Mayer
      "home_charge_share": 0.95,
      "default_km": 20000,
      "default_kwh_100km": 20
    }
  }
}
```

**Page `/settings/solaire`** (org_admin only, gabarit OrganizationSettings) — 3 onglets :
1. **Paramètres calcul** : prix kWh défaut, inflation, dégradation, horizon, pertes, panneau (Wc + m²), pente défaut, seuil autoconso, taux/durée crédit défaut, TVA.
2. **Grille de coûts** : tableau éditable `kWc → prix TTC posé` (ajout/suppression de lignes, tri par kWc, bornes 1–9 kWc).
3. **Simultanéité & VE** : les 3 presets + 2 bonus + plafond ; params VE (part domicile, prix borne, défauts km/conso).

Critère d'acceptation : tout est modifiable sans redéploiement ; le commercial n'y a pas accès.

---

## 7. APIs externes

### 7.1 PVGIS v5.2 via edge function `pvgis-proxy`
PVGIS ne renvoie pas d'en-têtes CORS → proxy obligatoire.
- **Edge function `pvgis-proxy`** : `verify_jwt:true` + `requireOrgMembership(req)` (helper `_shared/auth.ts`), entrée dans `supabase/config.toml`.
- Body accepté : `{ lat, lon, loss, angle, aspect }` — validés numériquement (bornes plausibles), **`peakpower=1` forcé côté serveur** (jamais accepté du client).
- Appel relayé : `GET https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?lat&lon&peakpower=1&loss&angle&aspect&outputformat=json`.
- Réponse renvoyée au front : `{ e_m: [12 × E_m kWh], e_y, params }` extraits de `outputs.monthly.fixed[]` et `outputs.totals.fixed.E_y`.
- **Linéarité** : la production est linéaire en kWc → **1 seul appel PVGIS par simulation** (à 1 kWc), toutes les puissances testées par l'optimiseur sont des multiplications côté client. La réponse est persistée dans `pv_simulations.pvgis_monthly` (rechargement à l'identique sans nouvel appel).
- PVGIS indisponible/timeout → message clair + bouton « Réessayer » (jamais d'écran blanc). `sanitizeError` pour les messages.

### 7.2 Géocodage — API Adresse data.gouv.fr (direct front, CORS OK)
`GET https://api-adresse.data.gouv.fr/search/?q={adresse}&limit=5` — autocomplétion (debounce via `useDebounce`), retourne lat/lon.

### 7.3 Géolocalisation device
`navigator.geolocation.getCurrentPosition()` — HTTPS OK (Vercel). Gérer le refus (fallback adresse) et afficher la précision obtenue.

### Conversions (affichées à l'écran)
- Pente : `angle_degrés = atan(pente_% / 100) × 180 / π` (ex « 18 % ≈ 10° »).
- Orientation → aspect PVGIS : S=0, SE=−45, E=−90, NE=−135, N=±180, NO=+135, O=+90, SO=+45. Avertissement si Nord : « orientation défavorable ».
- Puissance max toiture : `floor(surface_dispo / panel_area_m2) × panel_power_wc`.

---

## 8. Moteur de calcul — `pvEngine.js` (pur, testable)

### 8.1 Production mensuelle
`prod_mois[m] = e_m_1kwc[m] × P` pour la puissance P (kWc).

### 8.2 Coefficient de simultanéité
Le `min(prod, conso)` mensuel donne le recouvrement *théorique* mais ignore le décalage intra-journalier (production 11h–16h vs conso matin/soir). Le coefficient = **part du recouvrement mensuel réellement simultanée à l'échelle de la journée**. Ce n'est PAS le taux d'autoconsommation final (celui-ci est un résultat : autoconsommé ÷ produit).
`coeff = preset_présence + bonus_ecs (si coché) + bonus_ve (si VE actif ET recharge pilotée cochée)`, **plafonné à `cap` (0,85)**.

### 8.3 Autoconsommation mensuelle
```
autoconso[m] = min(prod[m], conso[m]) × coeff
surplus[m]   = prod[m] − autoconso[m]      // affiché « perdu », valorisé 0 € PARTOUT
taux_autoconso_annuel = Σ autoconso / Σ prod
taux_autoproduction   = Σ autoconso / Σ conso   // « part de votre facture couverte »
```

### 8.4 Économies année N (N = 1 → horizon)
```
prix_kwh[N]     = prix_kwh_initial × (1 + inflation)^(N−1)
prod_facteur[N] = (1 − dégradation)^(N−1)
économie[N]     = Σ_mois autoconso[m] × prod_facteur[N] × prix_kwh[N]
```

### 8.5 Financement (annuités constantes)
```
mensualité = K × t/12 / (1 − (1 + t/12)^(−12×D))   // K = capital, t = taux annuel, D = durée années
K = coût_installation − apport
```
Taux et durée saisis par le commercial (défauts admin). Coût installation : ligne exacte de `cost_grid` pour P, sinon **interpolation linéaire** entre les 2 points encadrants, sinon (grille vide / P hors bornes) **saisie manuelle**. Le champ coût est **toujours éditable** par le commercial. Si option borne VE cochée : `coût += ev.charger_price`.

### 8.6 Module véhicule électrique (optionnel)
Cas d'usage : projet de VE ou VE rechargé ailleurs — la surconsommation n'apparaît pas dans les factures.
```
conso_ve_annuelle = km_annuel × conso_kwh_100km / 100 × home_charge_share
conso[m] += conso_ve_annuelle / 12        // linéarisation 12 mois
```
- Ajoutée **avant** le calcul d'autoconsommation et **avant** l'optimiseur (un VE justifie plus de kWc).
- « Recharge pilotée en journée » cochée → bonus simultanéité +0,10 (§8.2) — argument « votre voiture roule au solaire ».
- Option borne → capital financé += prix borne (admin).
- Affichage : ligne « dont véhicule électrique : X kWh/an » dans le récap conso. (Coût carburant évité vs thermique = v2.)
- Critère : activer/désactiver le bloc VE recalcule **instantanément** conso, dimensionnement suggéré, capital (borne) et tableau annuel.

### 8.7 Tableau annuel (type amortissement) — LE livrable commercial
Colonnes pour chaque année 1 → horizon :
| Année | Économie élec (€) | Annuité crédit (€) | **Effort net (€)** | Cumul (€) |
- `effort_net[N] = annuité[N] − économie[N]` (négatif = le client gagne de l'argent). `annuité[N] = 12 × mensualité` si N ≤ durée, **0 après** → bascule visuelle forte.
- `cumul[N] = Σ_{1..N} (économie − annuité)`.
- Mise en évidence : ① première année où effort net ≤ 0, ② cumul à la fin du crédit, ③ cumul à l'horizon.
- 3 indicateurs en tête : **Effort mensuel moyen pendant le crédit** `= Σ_{N=1..D} effort_net[N] / (12 × D)`, **Année de neutralité**, **Gain total sur 25 ans** `= cumul[horizon]`.

### 8.8 Répartition automatique de l'annuel (aide saisie)
Profil résidentiel standard (constante du moteur, % du total annuel) :
`[12, 11, 10, 8, 7, 6, 6, 6, 7, 8, 9, 10]` (janv → déc, Σ = 100). Valeurs ajustables mois par mois après répartition.

---

## 9. Dimensionnement optimal (pivot central)

L'outil **suggère la puissance**, le commercial peut la modifier.
- Tester les puissances par pas de 1 panneau (0,5 kWc), de 1 panneau jusqu'à la puissance max toiture, et retenir **la plus grande puissance dont le recouvrement théorique annuel `Σ min(prod, conso) / Σ prod` ≥ seuil admin (défaut 85 %)**. Aucun nouvel appel PVGIS (linéarité).
- **⚠️ Correctif 2026-06-11** : le critère se calcule **AVANT** le coefficient de simultanéité (contrairement au `taux_autoconso` du §8.3, qui reste la métrique affichée). Le taux post-coefficient est plafonné par le coefficient (0,45–0,85) → un seuil à 85 % serait inatteignable et l'optimiseur recommanderait toujours le minimum (bug constaté en validation : 22 110 kWh/an → 0,5 kWc). Le coefficient scale toutes les puissances uniformément et ne déplace pas le point de surdimensionnement ; le seuil signifie « au plus 15 % de la production déborde structurellement de la consommation mensuelle ».
- Cas limites : si même 1 panneau < seuil → recommander 1 panneau ; si max ≥ seuil → recommander le max ; scénarios ±1 clampés à [1 panneau, max] (si recommandé = max, n'afficher que 2 scénarios).
- **⚠️ Plafond d'offre (correctif 2026-06-11)** : la puissance testée est bornée par `min(max toiture, max_power_kwc admin — défaut 9 kWc)`. Au-delà de 9 kWc le régime réglementaire change (offre résidentielle, grille de coûts 1–9 kWc). Bug constaté en validation : un gros consommateur (25 910 kWh/an) se voyait recommander 20 kWc / 40 panneaux. Si la toiture permettrait plus que le plafond, l'UI l'indique sous les scénarios.
- Affichage : **3 scénarios côte à côte** — « Recommandé », « −1 palier » (sobre), « +1 palier » (confort) — chacun : kWc, nb panneaux, taux d'autoconso, % surplus perdu, économie an 1, effort net mensuel moyen. Le « +1 palier » doit visuellement montrer le surplus perdu qui grimpe : argument anti-survente face aux concurrents.

---

## 10. UI / UX

### 10.1 Accessibilité daltonisme (deutan) — OBLIGATOIRE, NON NÉGOCIABLE
- Palette : **jaunes `#F5C542` / `#FFD166`** et **bleus `#2196F3` / `#1565C0` / `#0D47A1`**. Neutres gris/blanc/noir autorisés.
- **JAMAIS de distinction rouge/vert. Jamais de couleur seule** pour porter une information.
- Toujours **couleur + icône + libellé** (effort net positif = ▲ + « effort », négatif = ▼ + « gain »).
- Recharts : production = jaune, consommation = bleu foncé, autoconsommation = bleu clair, surplus perdu = gris hachuré.

### 10.2 Écrans
Wizard 3 étapes (§3) + Historique + Admin. Mobile-first : utilisable à une main sur téléphone en RDV, clavier numérique sur les champs kWh, layout artisan existant (sidebar repliée sur mobile).

---

## 11. Hors périmètre (v1)
- Revente du surplus (volontairement ignorée, cf. §1).
- Batteries de stockage (v2 : augmenterait le coefficient de simultanéité).
- ~~Export PDF client (v2)~~ → **livré le 2026-06-11** (cf. §13).
- Comparatif coût carburant évité VE vs thermique (v2).
- Données horaires PVGIS (modèle mensuel + coefficient suffisent en v1).
- Ombrages, multi-pans de toiture.
- UI de liaison lead/client (colonnes posées, UI = évolution).

---

## 12. Critères d'acceptation
1. Depuis un mobile chez un client : géolocalisation GPS → simulation complète en < 5 min.
2. **Un seul appel PVGIS par simulation** (1 kWc), optimiseur instantané côté client.
3. Le surplus n'est **jamais** valorisé en € dans aucun calcul ni affichage de gain.
4. Tableau annuel exact : annuités constantes vérifiables, effort net = annuité − économie, cumul cohérent.
5. Aucune information portée par la seule couleur ; palette limitée aux jaunes/bleus/neutres définis.
6. Le commercial ne peut pas modifier les paramètres admin ; l'org_admin modifie tout via `/settings/solaire` sans redéploiement.
7. PVGIS indisponible : message clair + réessayer (pas d'écran blanc).
8. Simulation rechargeable à l'identique depuis l'historique (via `pvgis_monthly` persisté, sans nouvel appel).
9. Bloc VE : activer/désactiver recalcule instantanément conso, dimensionnement, capital (borne) et tableau annuel.
10. Charte multi-tenant respectée : RLS dès la création, vue `security_invoker=true`, GRANT service_role, `org_id` explicite partout, cache keys org-scopées, `escapePostgrestSearchTerm` sur la recherche.

---

## 13. Étude PDF personnalisée & bibliothèque technique (ajout 2026-06-11, validé Eric)

### Étude PDF (2 pages A4, transmissible au client)
- **Génération** : `@react-pdf/renderer` (pattern PDFs existants), brandé via `buildCompanyInfo(settings)` (multi-tenant, fallback neutre). Graphique mensuel **redessiné en primitives** (barre production empilée autoconsommée + surplus avec liseré jaune, barre conso) — pas de capture d'écran.
- **Page 1** : en-tête org (logo, coordonnées, RGE) · titre + client/adresse/date · hypothèses complètes · scénario retenu en vedette (+ autres scénarios en 1 ligne — l'étude vend UNE solution) · graphique + 4 totaux annuels.
- **Page 2** : financement · 3 indicateurs · tableau annuel complet (badges NEUTRALITÉ / FIN DU CRÉDIT) · encadré « approche conservatrice, surplus 0 € » · liste des annexes · footer mentions légales + « étude indicative non contractuelle ».
- **Source unique de calcul** : `src/apps/solaire/lib/etudeModel.js::buildEtudeModel` — le MÊME pipeline alimente l'étape 3 (UI) et le PDF (étape 3 live + historique). Testé via node --test.
- **Accès** : bouton « Étude PDF » à l'étape 3 (modale nom client, pré-remplie si simulation rechargée) + bouton par ligne d'historique (régénération à l'identique via `pvgis_monthly` persisté). Fichier `etude-pv-<client>-<date>.pdf`.

### Bibliothèque technique (fiches annexées)
- **Dépôt** : Settings → Solaire → onglet « Bibliothèque technique » (org_admin). Upload PDF vers bucket existant **`product-documents`** (policies org-scoped P0.0.7), path `${orgId}/solaire/<uuid>.pdf`.
- **Métadonnées** : `settings.pv.tech_docs: [{ id, label, kind: 'panneau'|'borne'|'onduleur'|'autre', path, attach }]` — sauvées avec le reste du pv (en bloc).
- **Règles de jonction** : `attach=true` requis ; les fiches `kind='borne'` ne sont jointes **que si** l'option borne est cochée dans la simulation. Liste des annexes mentionnée en page 2.
- **Fusion** : `pdf-lib` (dépendance ajoutée 2026-06-11) — copie des pages des fiches à la suite de l'étude. Une annexe illisible/introuvable est **ignorée avec warn**, jamais bloquante (l'étude part seule au pire).

### UI graphique (ajout même date)
- Légende du graphique mensuel = 4 vignettes cliquables (couleur + libellé + **total annuel kWh**) ; un clic masque/affiche la série (état porté par opacité + barré, jamais couleur seule).
