# Spec — Bridge Pipeline ↔ Pennylane (Devis envoyé / Gagné / Perdu)

> **Date** : 2026-05-23
> **Auteur** : Brainstorming Eric + Claude
> **Statut** : Validé pour implémentation
> **Itération** : 1/N — Bridge devis & statuts. La synchro continue des coordonnées contact (PL → MDH) est traitée dans cette spec. Push MDH → PL (V1 API) est explicitement hors scope.

## 1. Contexte & motivation

Aujourd'hui le pipeline Majord'home doit refléter l'exhaustivité du chiffre commercial (KPI sensible). Deux chemins parallèles existent pour qu'un lead soit comptabilisé "Devis envoyé" :

1. Le commercial bascule manuellement le statut depuis MDH via `QuoteModal` (montant + date saisis à la main)
2. Le commercial crée un devis dans Pennylane directement, sans passer par MDH

→ Aucune garantie que les deux soient synchros. Un commercial qui shortcut MDH rend le compteur faux.

Ajoute à ça que :
- Les devis se font en pratique tous dans Pennylane chez Mayer (réalité opérationnelle 2026)
- Les variantes de devis pour un même client (gamme A vs B, avec/sans clim) doivent rester traçables
- Pennylane n'expose pas de webhook fiable et l'API V2 ne permet pas d'update les customers (PUT/PATCH renvoient 404)
- L'instance va héberger une 2ᵉ entreprise sans intégration Pennylane garantie

**Objectif** : définir une convention claire de gouvernance MDH ↔ Pennylane qui garantit l'exhaustivité du pipeline sans introduire de "bac à réconcilier" (rejeté en brainstorming), tout en restant gracieusement dégradée pour les orgs sans Pennylane.

## 2. Scope

### Dans le scope
- Convention de **canonical par phase** : MDH amont, Pennylane aval (à partir du pivot "Devis envoyé")
- Nouvelle modale `QuoteCandidatesModal` au pivot "Devis envoyé" (multi-attach + blocage strict)
- Nouvelle modale `MarkWonQuoteModal` au pivot "Gagné" (choix devis canonique)
- Cron de synchro descendante `pennylane-sync-quote-status` (statut PL → statut MDH)
- Synchro continue des coordonnées client (PL → MDH) à chaque pull
- UI lecture seule sur les champs Contact post-rattachement (texte d'info, pas de deeplink)
- Compteur "devis PL des 30j sans rattachement MDH" (voyant de discipline)
- Branchement conditionnel par org (`settings.pennylane.enabled`) pour préserver le mode 100% MDH
- Migration DB : flag `is_winning_quote` sur `lead_pennylane_quotes`

### Hors scope explicite
- **Push MDH → Pennylane** (V1 API customers) — l'identité PL est canonical, on ne renvoie rien
- **Webhook Pennylane** — pas fiable, on s'appuie sur le cron périodique
- **Auto-création de leads depuis devis PL orphelins** — le compteur de discipline suffit, le commercial recrée manuellement
- **Notification mail "Pensez à créer les entrées sur MDH"** aux commerciaux retardataires — itération future, basée sur le compteur de discipline
- **Réassignation d'un devis déjà attaché à un autre lead** — couvert par la RPC actuelle (`action='moved'`) mais pas exposé dans l'UI itération 1
- **Filtrage SAV/entretien dans la liste exploratoire** — à voir au moment de l'usage si pollution réelle, pas d'heuristique pré-implémentée
- **Settings UI pour activer Pennylane par org** (toggle + saisie clé API) — itération séparée (tile Intégrations dans `/settings`), spec dédiée
- **i18n** — tout en français
- **Audit log dédié** — la timeline `lead_activities` suffit

## 3. Décisions de design validées en brainstorming

| Question | Décision |
|---|---|
| Source de vérité par phase | **MDH canonical** Nouveau → Contacté → RDV planifié. **Pennylane canonical** à partir de "Devis envoyé". |
| Bascule "Devis envoyé" sans devis PL | **Bloquée stricte**. Le commercial doit créer son devis dans PL avant de cliquer. |
| Multi-devis (variantes) | Le commercial peut **multi-sélectionner** plusieurs devis PL à l'attachement (variantes traçables). |
| Choix du devis canonique au Gagné | Modale dédiée affichant les devis attachés, sélection radio. Flag `is_winning_quote` sur le choisi. |
| Sort des autres devis attachés au Gagné | **Restent attachés en mémoire** (pas d'éjection). La timeline garde la trace. |
| Matching fuzzy client dans `QuoteCandidatesModal` | Empilement de 3 signaux : `pennylane_sync` (bridge fort), email exact, téléphone normalisé via `cleanPhone()`. **Pas de match par nom fuzzy** (faux positifs). |
| Cas où aucun signal ne match | Bouton "+" qui ouvre une liste exploratoire des devis PL non rattachés (60 derniers jours). |
| Exploration : strict ou souple ? | **Strict par défaut** (seulement devis sans rattachement actif). Toggle "Inclure devis déjà rattachés ailleurs" possible plus tard pour l'admin. |
| Synchro descendante statut PL → MDH | Cron périodique 15 min. Si un devis attaché passe `accepted` → lead Gagné + ce devis canonique. Si **tous** les attachés sont `refused/expired` → lead Perdu. |
| Identité client après rattachement | Pennylane canonical. À chaque pull (rattachement + cron), on aligne `clients.{first_name,last_name,email,phone,address,…}` depuis le customer PL. |
| UI champs Contact après rattachement | **Lecture seule**. Texte d'info "ℹ Données synchronisées depuis Pennylane — à modifier dans Pennylane". **Pas de deeplink** (pas de mapping URL à maintenir, pas de lien mort possible). |
| Comportement si org sans Pennylane | **Mode actuel intégral** : pas de modales nouvelles, pas de cron, pas de compteur, champs Contact éditables. La branche `if (pennylaneEnabled)` partout. |
| KPI de discipline | Compteur "devis PL des 30j sans entry active dans `lead_pennylane_quotes`". À 0 = pipeline tenu. Affiché org_admin only. |

## 4. Architecture d'ensemble

### Conditionnalité par org

```
useOrgSettings() → settings.pennylane?.enabled
                       │
              ┌────────┴────────┐
              ▼                 ▼
       enabled = true    enabled = false (ou absent)
              │                 │
   ┌──────────┴──────────┐      └─→ Comportement actuel
   ▼                     ▼          (QuoteModal classique,
   UI nouvelle           Backend     Mark Won direct,
   (QuoteCandidatesModal,  (RPC      Contact éditable,
    MarkWonQuoteModal,      multi-   pas de cron PL,
    Contact read-only,      attach,  pas de compteur)
    compteur discipline)    cron PL)
```

### Surfaces concernées

| Surface | Si PL **activé** | Si PL **désactivé** (mode actuel) |
|---|---|---|
| Bouton "Devis envoyé" (LeadModal) | Ouvre `QuoteCandidatesModal` (multi-attach, blocage strict) | Ouvre `QuoteModal` classique (montant + date manuels) |
| Bouton "Marquer Gagné" | Ouvre `MarkWonQuoteModal` (choix devis canonique) | Bascule directe via `updateLeadStatus` |
| Section Contact (LeadModal) | Read-only post-rattachement + texte info | Éditable |
| Compteur "devis PL non rattachés" | Affiché (Dashboard + Pipeline) | Non affiché |
| Cron `pennylane-sync-quote-status` | Tourne, filtre orgs avec PL activé | Skip cette org |
| Sync continue contact PL → MDH | À chaque pull (rattachement + cron) | N/A |

### Flux fonctionnel

```
PHASE AMONT (MDH canonical) ─────────────────────────────────────────────
  Nouveau ─┐
  Contacté ─┤── boutons MDH, source de vérité interne, comportement actuel
  RDV planifié ─┘

PIVOT "Devis envoyé" ────────────────────────────────────────────────────
  Bouton MDH "Passer en Devis envoyé"
  ▼
  ┌─ QuoteCandidatesModal ──────────────────────────────────┐
  │ Section 1 — Suggestions fuzzy pour ce client            │
  │   • Match via pennylane_sync (bridge fort)              │
  │   • Match par email exact                                │
  │   • Match par téléphone normalisé (cleanPhone())         │
  │   ☐ Cases à cocher (multi-sélection variantes)           │
  │                                                          │
  │ [+ Explorer les devis non rattachés (60j)]               │
  │   Section 2 (sur expand) — liste paginée, strict         │
  │                                                          │
  │ STRICT : bouton désactivé si 0 cochés                    │
  │ [Annuler]                    [Attacher la sélection]    │
  └──────────────────────────────────────────────────────────┘
  ▼
  Multi-attach devis PL + bascule lead → Devis envoyé
  + sync coordonnées client depuis customer PL
  + lead_activity 'status_changed' source='pennylane_link'

PIVOT "Gagné" ───────────────────────────────────────────────────────────
  2 portes d'entrée :

  (a) Depuis MDH : bouton "Marquer Gagné"
      ▼
      ┌─ MarkWonQuoteModal ────────────────────────────────┐
      │ Lequel des devis attachés a été signé ?            │
      │   ⦿ DEV-2026-042 — 7 500 € — 12 mai                │
      │   ○ DEV-2026-051 — 8 200 € — 14 mai (variante)     │
      │                                                     │
      │ [Annuler]                          [Confirmer]     │
      └─────────────────────────────────────────────────────┘
      ▼
      flag is_winning_quote=true sur le sélectionné
      + lead → Gagné + lead_activity

  (b) Depuis Pennylane : commercial marque un devis 'accepted' dans PL
      ▼
      Cron pennylane-sync-quote-status (15 min) détecte
      ▼
      Bascule auto lead → Gagné + flag is_winning_quote=true sur ce devis
      + lead_activity 'status_changed' source='pennylane_sync_cron'

PIVOT "Perdu" ───────────────────────────────────────────────────────────
  Si TOUS les devis attachés sont refused/expired côté PL
  ▼
  Cron bascule lead → Perdu (silencieux, traçable timeline)

PHASE AVAL (PL canonical sur statut + identité) ─────────────────────────
  À chaque cron / pull :
    - Sync quote_status (drives Gagné/Perdu)
    - Sync customer fields (name, emails, phone, address)
        → UPDATE majordhome.clients aligné sur PL
```

## 5. Modèle DB

### Migration 1 — Flag devis canonique
```sql
ALTER TABLE majordhome.lead_pennylane_quotes
  ADD COLUMN is_winning_quote BOOLEAN NOT NULL DEFAULT false;

-- Index partial pour requêtes type "le devis gagnant du lead X"
CREATE INDEX idx_lead_pennylane_quotes_winning
  ON majordhome.lead_pennylane_quotes (lead_id)
  WHERE is_winning_quote = true AND ejected_at IS NULL;

-- Backfill historique : pour les leads Gagnés, désigner comme gagnant
-- le devis attaché le plus récent (heuristique pour les 18 leads Gagnés existants)
UPDATE majordhome.lead_pennylane_quotes lpq
SET is_winning_quote = true
WHERE id IN (
  SELECT DISTINCT ON (lpq2.lead_id) lpq2.id
  FROM majordhome.lead_pennylane_quotes lpq2
  JOIN majordhome.leads l ON l.id = lpq2.lead_id
  JOIN majordhome.statuses s ON s.id = l.status_id
  WHERE s.display_order = 5  -- Gagné
    AND lpq2.ejected_at IS NULL
  ORDER BY lpq2.lead_id, lpq2.assigned_at DESC
);
```

### Convention `core.organizations.settings`

```jsonc
{
  "pennylane": {
    "enabled": true,                    // Toggle d'intégration
    "api_key_ref": "MAYER_PL_TOKEN"     // Nom de la secret env Supabase (la valeur reste côté server)
  }
}
```

Settings UI dédiée (saisie + activation) sort du scope de cette itération — sera traitée dans la spec du tile `/settings/integrations`. Pour Mayer (org existante), le flag sera set en SQL au moment du déploiement de la migration.

## 6. RPCs backend

### RPC 1 — `lead_attach_quotes_and_send`

Remplace l'appel itéré à `assign_pennylane_quote_to_lead` qui existe déjà. Prend un **array** de devis à attacher en une transaction.

```sql
CREATE OR REPLACE FUNCTION public.lead_attach_quotes_and_send(
  p_org_id uuid,
  p_lead_id uuid,
  p_quotes jsonb  -- array de { quote_pl_id, customer_id, amount_ht, label, date, status }
) RETURNS jsonb
SECURITY DEFINER SET search_path = majordhome, public, core
```

Comportement :
1. Check membership (P0.7)
2. Check `settings.pennylane.enabled = true` sur l'org (sinon RAISE — sécurité défense en profondeur)
3. Pour chaque entry dans `p_quotes` : INSERT dans `lead_pennylane_quotes` (réutilise la logique idempotente existante)
4. Une fois tous attachés, bascule le lead en "Devis envoyé" (display_order=4) — même logique que la RPC existante (pas de régression depuis Gagné/Perdu)
5. INSERT une seule `lead_activity 'status_changed'` avec `metadata.source='pennylane_link'` et `metadata.attached_quote_ids=[…]`
6. Retourne `{ attached: N, lead_status_changed: bool, new_status_id }`

REVOKE FROM anon. GRANT TO authenticated.

### RPC 2 — `lead_mark_won_with_quote`

```sql
CREATE OR REPLACE FUNCTION public.lead_mark_won_with_quote(
  p_org_id uuid,
  p_lead_id uuid,
  p_winning_quote_pl_id bigint
) RETURNS jsonb
SECURITY DEFINER SET search_path = majordhome, public, core
```

Comportement :
1. Check membership + check pennylane.enabled
2. Vérifie que le devis cible est bien attaché à ce lead (sinon RAISE)
3. UPDATE `lead_pennylane_quotes SET is_winning_quote = true WHERE pennylane_quote_id = p_winning_quote_pl_id AND lead_id = p_lead_id`
4. UPDATE `lead_pennylane_quotes SET is_winning_quote = false` sur les autres du lead (sécurité unicité)
5. Bascule lead → Gagné (display_order=5)
6. INSERT lead_activity 'status_changed' source='mark_won_with_quote'
7. Retourne `{ lead_status_changed: bool, winning_quote_pl_id }`

### RPC 3 — `pennylane_sync_quote_status` (cron call)

Appelée par l'edge function cron. Pas une RPC pure SQL — la logique vit côté edge function parce qu'elle doit fetcher PL.

Voir section "Cron" plus bas.

### Compteur — vue ou RPC ?

Le compteur "devis PL des 30j sans rattachement" se calcule trivialement sans nouveau objet DB :

```sql
SELECT COUNT(*) FROM (
  SELECT pq.pennylane_quote_id FROM ... -- fetch via API PL
) AS pl_quotes_recent
LEFT JOIN majordhome.lead_pennylane_quotes lpq
  ON lpq.pennylane_quote_id = pl_quotes_recent.id AND lpq.ejected_at IS NULL
WHERE lpq.id IS NULL;
```

→ Implémenté côté service frontend (fetch PL + diff DB), pas besoin de RPC dédiée. Voir section "Service" plus bas.

## 7. Cron — `pennylane-sync-quote-status`

Edge function planifiée (Supabase Cron ou pg_cron + edge invoke), fréquence : **15 min**.

**Auth** : `verify_jwt:false` + `requireSharedSecret(req, MDH_CRON_SECRET)` (pattern P0.2/P0.25).

**Algorithme** :
```
Pour chaque org dans core.organizations WHERE settings->pennylane->>'enabled' = 'true':
  1. Fetch devis PL via /quotes (cursor pagination, fenêtre 30j)
  2. Pour chaque devis attaché actif dans majordhome.lead_pennylane_quotes:
     a. Si quote_status DB ≠ quote_status PL → UPDATE quote_status
     b. Si quote_status PL == 'accepted' ET lead pas final → mark won + canonical
     c. Si quote_status PL ∈ ('refused', 'expired'):
        — Vérifier si TOUS les devis attachés du lead sont dans cet état
        — Si oui → mark lead 'Perdu' + lead_activity
  3. Pour chaque customer PL associé aux devis attachés:
     a. Pull customer (/customers/{id})
     b. Si fields divergent du client MDH → UPDATE majordhome.clients
        (name, first_name, last_name, emails, phone, billing_address)
  4. Logger nb d'updates en metadata pour observabilité
```

**Idempotence** : chaque appel re-scanne, pas d'état "déjà traité". Les RPCs internes (`lead_mark_won_with_quote`, équivalent perdu) sont elles-mêmes idempotentes (no-op si déjà à l'état cible).

**Budget API PL** : ~30j de devis × N orgs = quelques centaines de calls max par run. Largement OK même en multi-tenant.

**Erreurs** : si une org plante (clé API invalide, rate limit), on passe à la suivante et on loggue. Pas de blocage transversal.

## 8. Services frontend

### `pennylane.service.js` — ajouts

```javascript
/**
 * Devis candidats pour un lead : fuzzy match côté client (bridge + email + phone).
 * Retourne les devis PL non rattachés (ou attachés à ce lead — pour gérer le re-affichage).
 */
async function getCandidateQuotesForLead(leadId, orgId) { ... }

/**
 * Liste exploratoire : tous les devis PL des N derniers jours sans rattachement actif.
 */
async function getUnlinkedQuotes(orgId, { sinceDays = 60, limit = 100 } = {}) { ... }

/**
 * Compteur "devis PL non rattachés" — pour le voyant de discipline.
 */
async function countUnlinkedQuotes(orgId, { sinceDays = 30 } = {}) { ... }

/**
 * Multi-attach + bascule statut en une transaction (appelle RPC lead_attach_quotes_and_send).
 */
async function attachQuotesAndSendLead(orgId, leadId, quotes) { ... }

/**
 * Mark Won côté MDH (appelle RPC lead_mark_won_with_quote).
 */
async function markLeadWonWithQuote(orgId, leadId, winningQuotePlId) { ... }
```

### `useOrgSettings.js` — ajout sélecteur

```javascript
export function usePennylaneEnabled() {
  const { settings } = useOrgSettings();
  return Boolean(settings?.pennylane?.enabled);
}
```

### `usePennylane.js` — nouveaux hooks

- `useCandidateQuotesForLead(leadId, orgId, { enabled })` — fuzzy
- `useUnlinkedQuotes(orgId, { sinceDays })` — exploration paginée
- `useUnlinkedQuoteCount(orgId)` — compteur léger (staleTime 5 min)
- Mutations : `useAttachQuotesAndSend`, `useMarkLeadWonWithQuote`

Toutes invalident `leadKeys.all(orgId)` + `pennylaneKeys.linkedQuotesByLead(orgId, leadId)` + le compteur si pertinent.

## 9. UI

### Composant 1 — `QuoteCandidatesModal`

Refonte de `LinkPennylaneQuoteModal` (existant) avec ces évolutions :
- **Multi-sélection** (checkboxes au lieu de bouton "Ajouter" par ligne)
- **2 sections** : Suggestions (fuzzy) puis bouton "[+ Explorer les devis non rattachés]" qui révèle la liste exploratoire paginée
- **Blocage strict** : bouton "Attacher la sélection (N)" désactivé si 0 cochés
- **Message si 0 suggestion ET avant clic "+"** : "Aucun devis Pennylane trouvé pour ce client. Crée-le d'abord dans Pennylane, ou explore les devis non rattachés."

### Composant 2 — `MarkWonQuoteModal` (nouveau)

```
┌─ Marquer comme Gagné ─────────────────────────────────┐
│ Quel devis a été signé ?                              │
│                                                        │
│   ⦿ DEV-2026-042  · 7 500 €  · 12 mai                 │
│   ○ DEV-2026-051  · 8 200 €  · 14 mai (variante)      │
│                                                        │
│ ℹ Les autres devis restent attachés au lead pour      │
│   référence historique.                                │
│                                                        │
│ [Annuler]                          [Confirmer Gagné]  │
└────────────────────────────────────────────────────────┘
```

### Composant 3 — Section Contact (`LeadFormSections.jsx`)

```jsx
const isPennylaneActive = usePennylaneEnabled() && hasAttachedQuotes;

<SectionContact
  // ...
  readOnly={isPennylaneActive}
  footer={isPennylaneActive ? (
    <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-2">
      <Info className="w-3.5 h-3.5" />
      Données synchronisées depuis Pennylane — à modifier dans Pennylane
    </div>
  ) : null}
/>
```

`readOnly` applique `disabled` sur les inputs + cursor-not-allowed visuel.

### Composant 4 — Voyant "Devis PL non rattachés"

Petit widget org_admin only, à placer sur le Dashboard et/ou sur la barre header du Pipeline :

```
┌────────────────────────────────────────────┐
│ ⚠ 3 devis Pennylane sans rattachement MDH │
│   (derniers 30 jours)        [Voir détail]│
└────────────────────────────────────────────┘
```

Le "Voir détail" ouvre une modale qui liste les devis concernés avec un bouton "Créer un lead" (qui pré-remplit `LeadModal` avec les coordonnées du customer PL). Itération bonus si bande passante — sinon juste le voyant numérique en première étape.

### LeadModal — branchement conditionnel

```jsx
const pennylaneActive = usePennylaneEnabled();
const [showQuoteModal, setShowQuoteModal] = useState(false);
const [showQuoteCandidates, setShowQuoteCandidates] = useState(false);
const [showMarkWon, setShowMarkWon] = useState(false);

const onClickDevisEnvoye = () => {
  if (pennylaneActive) setShowQuoteCandidates(true);
  else setShowQuoteModal(true);  // mode actuel
};

const onClickGagne = () => {
  if (pennylaneActive && hasAttachedQuotes) setShowMarkWon(true);
  else updateLeadStatus(/* mode actuel */);
};
```

## 10. Plan d'implémentation (séquencement)

8 PRs séquentielles, chacune testable indépendamment :

### PR 1 — Migration DB + flag winning_quote
- Ajout colonne `is_winning_quote`
- Index partial
- Backfill historique (18 leads Gagnés Mayer)
- Pas d'impact UI

### PR 2 — RPC backend `lead_attach_quotes_and_send`
- Création de la RPC multi-attach
- Réutilise la RPC `assign_pennylane_quote_to_lead` existante en boucle au début, puis on consolide
- Test live sur lead Mayer

### PR 3 — RPC `lead_mark_won_with_quote` + sélecteur `usePennylaneEnabled`
- RPC mark won
- Hook `usePennylaneEnabled()` dans `useOrgSettings.js`
- Set le flag Mayer en SQL au déploiement

### PR 4 — `QuoteCandidatesModal` (refonte LinkPennylaneQuoteModal)
- Multi-sélection
- Dualité Suggestions / Exploration
- Blocage strict
- Branchement dans `LeadModal` sur le bouton "Devis envoyé" si `pennylaneActive`

### PR 5 — `MarkWonQuoteModal`
- Nouveau composant
- Branchement dans LeadModal sur "Marquer Gagné" si `pennylaneActive` + `hasAttachedQuotes`

### PR 6 — Contact section lecture seule
- Modif `SectionContact` (props `readOnly` + `footer`)
- Texte info i18n-ready

### PR 7 — Edge function `pennylane-sync-quote-status`
- Cron 15 min
- Logique sync statut + identité client
- Test sur Mayer + observabilité

### PR 8 — Voyant "Devis PL non rattachés"
- Service `countUnlinkedQuotes` + hook
- Widget Dashboard + header Pipeline
- (Bonus) modale détail + "Créer un lead"

**Estimation** : 6-8 sessions de dev, ~2-3 semaines avec tests utilisateurs entre chaque PR.

## 11. Cas limites identifiés

| Cas | Comportement |
|---|---|
| Org sans `pennylane.enabled` | Aucune des nouvelles UI/RPCs ne se déclenche. Comportement actuel intégral. |
| Org avec PL activé mais clé API invalide | Cron loggue l'erreur, passe à l'org suivante. UI front affiche un fallback (modale candidat dit "Erreur Pennylane, contacte l'admin"). |
| Lead avec 0 devis attachés et bouton Gagné cliqué | Si PL activé : modale ouvre vide → error toast "Aucun devis attaché à ce lead". Forcer le rattachement d'abord. Si PL désactivé : flow actuel inchangé. |
| Lead avec 1 seul devis et bouton Gagné cliqué | `MarkWonQuoteModal` s'ouvre quand même, pré-sélection radio sur le seul devis, un clic suffit. Pas de skip silencieux (traçabilité). |
| Devis PL supprimé côté PL après rattachement | Cron détecte la disparition au prochain run → `ejected_at` set + raison `'deleted_in_pennylane'`. Si c'était le `is_winning_quote` du lead Gagné, on alerte le KPI. |
| Lead avec plusieurs devis tous `accepted` | Cas anormal (en pratique 1 seul accepté). Le cron prend le plus récent comme winning. Loggue l'anomalie. |
| Client PL renommé après rattachement | Sync continue le réaligne sur MDH au prochain cron, sans intervention. Timeline ne trace pas (trop bruyant) — on garde la trace via PL natif. |
| Org passe de PL activé → désactivé | Les rattachements existants restent en DB mais inertes. Les champs Contact redeviennent éditables. Le cron skip cette org. |

## 12. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Le commercial veut basculer "Devis envoyé" avant d'avoir fait le devis dans PL → frustration | Tooltip explicite sur le bouton désactivé. Message dans la modale. Discipline qui doit s'installer (l'objectif est justement l'exhaustivité). |
| Cron silencieux qui se plante → décalage durable | Observabilité : log les nb d'updates par run + un canary "dernier run réussi" visible sur le dashboard admin. |
| Sync continue qui override des modifs commerciales | Le UI lecture seule empêche les modifs côté MDH après rattachement. Pas de conflit possible. |
| Customer PL avec données partielles écrase un client MDH complet | Le pull PL ne fait que des `COALESCE` (n'écrase pas avec NULL). À implémenter strictement côté cron. |
| Faux positif fuzzy match (mauvais client suggéré) | Multi-sélection oblige le commercial à cocher manuellement → garde-fou humain. Pas de match silencieux. |
| Compteur "devis sans rattachement" ignoré par tout le monde | Plus tard : mail auto au commercial concerné (itération séparée). Pour itération 1, juste le voyant. |

## 13. Travaux annexes (à intégrer dans le séquencement)

- **Settings UI tile `/settings/integrations`** : exposer le toggle `pennylane.enabled` + saisie clé API (référence à la secret Supabase). Spec dédiée (hors scope ici).
- **Migration MEMORY.md / CLAUDE.md** : documenter le nouveau pattern "intégration conditionnelle par org" si on étend à d'autres modules (Meta Ads, GSC, etc.).
- **Tests E2E** : un scénario "lead → devis PL → bascule auto → Gagné via cron" sur Cypress ou équivalent (pas encore en place dans le repo).

## 14. Références

- Brainstorming initial : session 2026-05-23 (cette conversation)
- Bug initial signalé : "création des devis envoyé depuis la liste pennylane ne se fait pas" → diagnostic + premier fix RPC `assign_pennylane_quote_to_lead` étendue (commit local non-pushé, à intégrer dans PR 2)
- Sprint 9 Pennylane quote-driven (WIP commit `1df67db4`, 2026-05-21) — cette spec en est la suite directe
- Pattern "intégrations conditionnelles par org" — P0.3 (`docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`)
- Convention multi-tenant cache keys + helpers — CLAUDE.md sections "Multi-tenant & sécurité" + "Conventions qualité"
