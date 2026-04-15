# Sprint 9 — Intégration Pennylane

> **Date** : 2026-04-12 — Phase idéation
> **Objectif** : Connecter Majordhome à Pennylane pour chaîner devis → facture et récupérer les factures clients
> **Dépendances** : Module Devis existant (complet), API Pennylane V2

---

## Contexte & Décisions d'architecture

### Stratégie retenue : Lignes libres + `ledger_account_id`

**Rejeté** :
- ~~Produits génériques par TVA~~ — "déformation comptable", devis client illisible
- ~~Sync catalogue complet~~ — trop complexe pour le gain, maintenance lourde

**Retenu** :
- Push des lignes de devis SANS `product_id` Pennylane
- Chaque ligne porte un `ledger_account_id` (compte comptable) configuré sur l'article Majordhome
- Le devis Pennylane affiche les vrais labels/descriptions/prix des articles
- Liberté totale de modification dans Pennylane (primes, remises, ajustements)

### Flux global

```
Majordhome                              Pennylane
───────────────────────────────────────────────────────
1. Client créé/modifié                ──→ POST /company_customers (sync auto)
2. Devis créé, lignes + sections
3. Bouton "Envoyer vers Pennylane"    ──→ POST /quotes (sections + lignes + ledger_account_id)
                                         ↓
                                      4. Ajuster si besoin (primes MaPrimeRénov', CEE...)
                                      5. Envoyer au client depuis Pennylane
                                      6. Convertir en facture (bouton natif Pennylane)
                                         ↓
7. Pull factures (cron ou à la demande) ←── GET /customer_invoices
8. Stockage URL PDF
9. Affichage fiche client + portail
```

### Ce qu'on NE fait PAS

- Sync inverse Pennylane → Majordhome pour les devis (les modifs restent dans PL)
- Catalogue produits synchro dans Pennylane
- Envoi email de devis depuis Majordhome (PL s'en charge)
- Conversion devis→facture depuis Majordhome (bouton natif PL suffit)
- Archivage des devis PL dans Majordhome (on garde nos devis locaux, PL a les siens)

---

## API Pennylane V2 — Référence technique

### Authentification
- **Bearer Token** : `Authorization: Bearer <token>`
- **Base URL** : `https://app.pennylane.com/api/external/v2/`
- **Rate limit** : 25 requêtes / 5 secondes (headers `ratelimit-remaining`, `ratelimit-reset`)
- **Montants** : toujours en STRING (`"8500.00"`, pas `8500.00`)
- **Pagination** : cursor-based (pas d'offset)

### Scopes requis
`customers:all`, `quotes:all`, `customer_invoices:readonly`, `ledger_accounts:readonly`

### Codes TVA France
| Code Pennylane | Taux | Usage Majordhome |
|----------------|------|------------------|
| `FR_200` | 20% | Équipement standard |
| `FR_100` | 10% | Main d'œuvre / rénovation |
| `FR_055` | 5.5% | Matériel éligible énergie |
| `exempt` | 0% | Aides déduites (MaPrimeRénov') |

### Mapping TVA Majordhome → Pennylane
```javascript
const TVA_MAPPING = {
  20:  'FR_200',
  10:  'FR_100',
  5.5: 'FR_055',
  0:   'exempt'
};
```

### Unités Majordhome → Pennylane
```javascript
const UNIT_MAPPING = {
  'pièce':  'piece',
  'h':      'hour',
  'forfait': 'flat_rate',  // ou 'piece' si non supporté
  'ml':     'meter',
  'm²':     'square_meter', // vérifier support PL
};
```

---

## Phase 1 — Infrastructure & Config

### 1.1 Variables d'environnement

**Supabase Edge Functions** (secret, pas exposé au frontend) :
```
PENNYLANE_API_TOKEN=hyrio4ff...  (le token fourni)
PENNYLANE_BASE_URL=https://app.pennylane.com/api/external/v2
```

> **IMPORTANT** : le token NE DOIT PAS être dans le frontend (VITE_*). Toutes les requêtes Pennylane passent par une Edge Function Supabase qui porte le secret.

### 1.2 Edge Function `pennylane-proxy`

Proxy sécurisé entre le frontend et l'API Pennylane.

```
supabase/functions/pennylane-proxy/index.ts
```

**Pourquoi un proxy** :
- Le token API ne transite jamais côté client
- Rate limiting centralisé
- Logging des appels
- Retry automatique sur 429

**Interface** :
```
POST /functions/v1/pennylane-proxy
Authorization: Bearer <supabase_jwt>
Content-Type: application/json

{
  "method": "POST",
  "path": "/quotes",
  "body": { ... }
}
```

→ Forward vers `https://app.pennylane.com/api/external/v2/quotes` avec le Bearer token Pennylane.

### 1.3 Table de mapping `majordhome.pennylane_sync`

```sql
CREATE TABLE majordhome.pennylane_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES core.organizations(id),
  entity_type TEXT NOT NULL,          -- 'client' | 'quote' | 'invoice'
  local_id UUID NOT NULL,             -- ID Majordhome (client.id, quote.id)
  pennylane_id BIGINT NOT NULL,       -- ID Pennylane (integer)
  pennylane_number TEXT,              -- Numéro PL (FA-2026-0042, DEV-2026-001)
  external_reference TEXT,            -- Référence croisée
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_status TEXT DEFAULT 'synced',  -- 'synced' | 'pending' | 'error'
  sync_error TEXT,                    -- Message d'erreur si échec
  metadata JSONB,                     -- Données complémentaires (public_url, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id, entity_type, local_id)
);

CREATE INDEX idx_pennylane_sync_entity ON majordhome.pennylane_sync(entity_type, local_id);
CREATE INDEX idx_pennylane_sync_pl_id ON majordhome.pennylane_sync(entity_type, pennylane_id);
```

### 1.4 Colonne `ledger_account_id` sur les articles

```sql
ALTER TABLE majordhome.supplier_products
  ADD COLUMN ledger_account_pl_id BIGINT,           -- ID compte Pennylane
  ADD COLUMN ledger_account_pl_number TEXT;          -- Numéro (706xxx) pour affichage
```

Et sur les lignes de devis (pour conserver le compte au moment de la création) :
```sql
ALTER TABLE majordhome.quote_lines
  ADD COLUMN ledger_account_pl_id BIGINT;
```

### 1.5 Récupération des comptes comptables Pennylane

Au setup initial, appel `GET /ledger_accounts?filter[number][start_with]=706&filter[enabled][eq]=true` pour lister les comptes de vente disponibles chez Mayer.

Stockage en config (table `majordhome.pennylane_config` ou simple JSON en `organization_settings`) pour le sélecteur UI côté articles.

---

## Phase 2 — Sync Clients

### 2.1 Mapping des champs

| Majordhome (`clients`) | Pennylane (`company_customers`) |
|-------------------------|--------------------------------|
| `id` | `external_reference` |
| `display_name` | `name` |
| `first_name` + `last_name` | `recipient` → "M./Mme Prénom Nom" |
| `email` | `emails[0]` |
| `phone` | `phone` |
| `client_category` (entreprise) | `reg_no` = `siren` |
| `address` | `billing_address.address` |
| `postal_code` | `billing_address.postal_code` |
| `city` | `billing_address.city` |
| `'FR'` | `billing_address.country_alpha2` |
| `client_number` | `reference` |

### 2.2 Service `pennylane.service.js`

```javascript
export const pennylaneService = {
  // Proxy call
  async apiCall(method, path, body),

  // Clients
  async syncClient(client),           // Create or update
  async getOrCreateCustomer(client),   // Check sync table, create if needed

  // Devis
  async pushQuote(quote, lines, client),

  // Factures
  async pullInvoices(orgId, since),
  async getInvoiceDetail(pennylaneInvoiceId),

  // Config
  async getLedgerAccounts(),
};
```

### 2.3 Sync automatique

**Trigger** : quand on clique "Envoyer vers Pennylane" sur un devis, le client est automatiquement synchro (create ou update) AVANT le push du devis.

**Pas de sync en masse au démarrage** — on sync les clients au fil de l'eau, quand ils apparaissent dans un devis. Les 3301 clients existants ne sont PAS tous poussés.

### 2.4 Gestion des clients existants dans Pennylane

Pour les clients déjà créés manuellement dans Pennylane :
- Option 1 : `GET /customers?filter[email]` pour matcher par email
- Option 2 : Mapping manuel initial (UI admin)
- **Recommandé** : Option 1 (auto-match par email) + fallback création

---

## Phase 3 — Push Devis

### 3.1 Construction du payload Pennylane

```javascript
function buildPennylaneQuote(quote, lines, pennylaneCustomerId) {
  // 1. Extraire les sections uniques (section_title lines)
  const sections = lines
    .filter(l => l.line_type === 'section_title')
    .map(l => ({ label: l.designation }));

  // 2. Mapper les lignes produit/labor
  const sectionIndexMap = {};
  let currentSection = -1;

  const invoiceLines = [];
  for (const line of lines) {
    if (line.line_type === 'section_title') {
      currentSection++;
      sectionIndexMap[line.sort_order] = currentSection;
      continue;
    }

    invoiceLines.push({
      label: line.designation,
      description: line.description || null,
      quantity: line.quantity,
      unit: UNIT_MAPPING[line.unit] || 'piece',
      raw_currency_unit_price: String(line.unit_price_ht.toFixed(2)),
      vat_rate: TVA_MAPPING[line.tva_rate] || 'FR_200',
      section_rank: currentSection >= 0 ? currentSection : 0,
      ledger_account_id: line.ledger_account_pl_id || null,
      product_id: null,  // Jamais de product_id PL
    });
  }

  return {
    customer_id: pennylaneCustomerId,
    date: new Date().toISOString().split('T')[0],
    deadline: addDays(new Date(), quote.validity_days).toISOString().split('T')[0],
    currency: 'EUR',
    language: 'fr_FR',
    external_reference: quote.id,  // UUID Majordhome
    pdf_invoice_subject: quote.subject || 'Devis',
    discount: quote.global_discount_percent > 0
      ? { type: 'relative', amount: String(quote.global_discount_percent.toFixed(2)) }
      : null,
    invoice_line_sections: sections,
    invoice_lines: invoiceLines,
  };
}
```

### 3.2 UI — Bouton sur DevisModal

Ajout dans `DevisModal.jsx` :
- Bouton "Envoyer vers Pennylane" (icône ExternalLink)
- Visible uniquement pour les devis `brouillon` ou `envoye`
- États : idle → syncing → synced (avec lien vers PL)
- Si déjà synchro : affiche badge "Synchro Pennylane" + date + lien

### 3.3 Hook `usePennylane`

```javascript
export function usePennylaneSync(quoteId) {
  // Query : état sync depuis pennylane_sync table
  // Mutations : pushQuote, refreshSync
  // Retourne : { syncStatus, pennylaneUrl, pushQuote, isPushing }
}
```

---

## Phase 4 — Pull Factures

### 4.1 Stratégie de récupération

**Pas de webhook Pennylane** — on utilise le polling :

**Option A — Cron N8N** (recommandé) :
- Toutes les 15 min, `GET /customer_invoices?filter[updated_at][gte]=<last_check>`
- Filtre sur `external_reference` qui matche un UUID Majordhome
- Upsert dans `pennylane_sync` (entity_type='invoice')
- Stocke `public_url`, `invoice_number`, `status`, `paid`, `remaining_amount`

**Option B — À la demande** :
- Quand on ouvre la fiche client, on check les devis synchro
- Pour chaque devis synchro, `GET /quotes/{id}` → si converti, récupère la facture liée
- Plus simple mais moins réactif

**Recommandé** : Option A pour la donnée fraîche, Option B en complément pour l'affichage.

### 4.2 Table factures (vue légère, pas de duplication)

On ne duplique PAS toutes les données facture — on stocke juste le lien :

```sql
-- Pas de nouvelle table. On utilise pennylane_sync avec entity_type='invoice'
-- metadata contient : { public_url, invoice_number, status, paid, amount_ttc, remaining_amount }
```

### 4.3 UI — Onglet Factures sur fiche client

Nouvel onglet `TabFactures.jsx` dans `client-detail/` :

```
┌─────────────────────────────────────────────────────┐
│ Factures                                             │
├─────────────────────────────────────────────────────┤
│ FA-2026-0042  │ 01/05/2026  │ 5 020,00 € │ ✅ Payée  │ 📄 PDF │
│ FA-2026-0038  │ 15/04/2026  │ 3 200,00 € │ ⏳ En attente │ 📄 PDF │
└─────────────────────────────────────────────────────┘
```

- Liste des factures depuis `pennylane_sync` WHERE `entity_type='invoice'` AND client lié
- Badge statut (payée / en attente / en retard)
- Lien PDF → `public_url` Pennylane (pas de téléchargement, juste le lien)
- Montant, date, numéro facture

---

## Phase 5 — Configuration articles (ledger_account)

### 5.1 UI Settings — Page fournisseurs/articles

Dans la page de gestion des articles (`EquipmentFormModal` ou page Settings dédiée) :

- Sélecteur "Compte comptable Pennylane" sur chaque article
- Liste déroulante alimentée par `GET /ledger_accounts` (cachée localement)
- Affiche : numéro + label (ex: "706100 — Ventes de marchandises")
- Valeur stockée : `ledger_account_pl_id` (l'ID PL) + `ledger_account_pl_number` (pour affichage)

### 5.2 Propagation aux lignes de devis

Quand un article est ajouté à un devis (via DevisProductPicker), le `ledger_account_pl_id` est copié sur la ligne de devis. Si l'article n'a pas de compte configuré, la ligne part sans → Pennylane utilisera le mapping par défaut.

---

## Fichiers à créer/modifier

### Nouveaux fichiers
| Fichier | Rôle |
|---------|------|
| `supabase/functions/pennylane-proxy/index.ts` | Edge Function proxy sécurisé |
| `src/shared/services/pennylane.service.js` | Service API Pennylane (via proxy) |
| `src/shared/hooks/usePennylane.js` | Hooks React Query (sync, push, pull) |
| `src/apps/artisan/pages/client-detail/TabFactures.jsx` | Onglet factures fiche client |

### Fichiers à modifier
| Fichier | Modification |
|---------|-------------|
| `src/apps/artisan/components/devis/DevisModal.jsx` | Bouton "Envoyer vers Pennylane" + badge sync |
| `src/apps/artisan/components/devis/DevisProductPicker.jsx` | Propager `ledger_account_pl_id` sur les lignes |
| `src/apps/artisan/components/devis/CreateDevisModal.jsx` | Idem propagation compte comptable |
| `src/shared/services/suppliers.service.js` | CRUD `ledger_account_pl_id` sur produits |
| `src/apps/artisan/pages/client-detail/` (index) | Ajouter onglet Factures |
| `src/shared/hooks/cacheKeys.js` | Ajouter `pennylaneKeys`, `invoiceKeys` |
| `src/apps/artisan/routes.jsx` | Route Settings Pennylane (si page dédiée) |

### Migrations SQL
| Migration | Contenu |
|-----------|---------|
| `add_pennylane_sync_table` | Table `pennylane_sync` + index + vue publique + RLS |
| `add_ledger_account_to_products` | Colonnes `ledger_account_pl_id/number` sur `supplier_products` |
| `add_ledger_account_to_quote_lines` | Colonne `ledger_account_pl_id` sur `quote_lines` |
| `add_pennylane_config` | Table ou colonne config pour stocker les comptes comptables PL disponibles |

---

## Ordre de développement recommandé

### Étape 1 — Fondations (1 session)
1. Migration `pennylane_sync` + vue publique + RLS
2. Migration colonnes `ledger_account_pl_id` sur `supplier_products` et `quote_lines`
3. Edge Function `pennylane-proxy` (avec le token en secret)
4. `pennylane.service.js` — méthodes de base (`apiCall`, `getLedgerAccounts`)
5. Test : vérifier que l'appel API fonctionne (GET /ledger_accounts)

### Étape 2 — Sync clients (1 session)
1. `pennylane.service.js` — `syncClient()`, `getOrCreateCustomer()`
2. `usePennylane.js` — hook de sync client
3. Test : créer un client dans Pennylane depuis Majordhome

### Étape 3 — Push devis (1 session)
1. `pennylane.service.js` — `pushQuote()`, `buildPennylaneQuote()`
2. `usePennylane.js` — `usePennylaneSync(quoteId)`
3. UI `DevisModal.jsx` — bouton + badge + états
4. Propagation `ledger_account_pl_id` dans le picker et le wizard
5. Test : pousser un devis complet vers Pennylane

### Étape 4 — Config comptes comptables (1 session)
1. UI sélecteur compte comptable sur articles/produits
2. Cache local des comptes PL disponibles
3. Test : configurer un article, créer un devis, vérifier l'imputation PL

### Étape 5 — Pull factures (1 session)
1. `pennylane.service.js` — `pullInvoices()`, `getInvoiceDetail()`
2. Workflow N8N ou Edge Function cron pour polling
3. `TabFactures.jsx` — onglet fiche client
4. Test : convertir un devis en facture dans PL, vérifier l'affichage

---

## Points d'attention

### Sécurité
- Token API **jamais** côté frontend — toujours via Edge Function
- JWT Supabase requis pour appeler le proxy (authentification utilisateur)
- RLS sur `pennylane_sync` filtré par `org_id`

### Idempotence
- `external_reference` = UUID Majordhome sur chaque entité PL
- Avant de créer, toujours vérifier si l'entité existe déjà (via `pennylane_sync` ou `GET` avec filtre)
- La table `pennylane_sync` est la source de vérité du mapping

### Rate limiting
- 25 req / 5 sec → le proxy doit gérer la file d'attente
- Retry automatique sur HTTP 429 avec `retry-after` header
- Pas de sync en masse — toujours au fil de l'eau

### Gestion d'erreurs
- Si le push échoue : `sync_status='error'`, `sync_error=message`
- UI affiche le badge erreur avec possibilité de retry
- Toast d'erreur explicite ("Pennylane : client introuvable", etc.)

### Clients existants dans Pennylane
- Au premier push, tenter un match par email (`GET /customers?filter[email]`)
- Si trouvé : stocker le mapping dans `pennylane_sync`, mettre à jour `external_reference`
- Si non trouvé : créer le client

---

## Questions à résoudre avant le build

1. ~~Token API~~ ✅ Fourni
2. **Sandbox** : tester sur l'environnement sandbox PL avant prod ? (recommandé)
3. **Comptes comptables** : quels comptes 706xxx utilise Mayer ? (à récupérer via l'API au démarrage)
4. **Template devis PL** : Mayer a-t-il un template de mise en page dans Pennylane ? (`quote_template_id`)
5. **Conditions de paiement par défaut** : `upon_receipt`, `30_days` ?
6. **Clients existants** : combien de clients déjà dans Pennylane ? Faut-il un mapping initial ?
