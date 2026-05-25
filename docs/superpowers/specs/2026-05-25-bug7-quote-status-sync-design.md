# Spec — Bug #7 : sync quote_status ↔ allowlist Kanban + invariant winning

> **Date** : 2026-05-25
> **Auteur** : Diagnostic via MCP Supabase (Eric + Claude)
> **Statut** : ✅ **APPLIQUÉ EN PROD 2026-05-25** (migrations `20260525_5/6/7`)
> **Sprint** : 9 Pennylane quote-driven — fix de cohérence data + structurel
> **Lié** : brief `docs/PROMPT_PENNYLANE_MATCHING_REFACTOR.md` bug #7

## 1. Contexte & symptômes

Observation prod 2026-05-25 : sur 6 cartes de la colonne **Gagné** du Kanban Pipeline, **4 affichent un statut "Gagné" sans le chip "1 devis attaché"**, alors que la modale du lead montre bien un devis avec le badge "🏆 Gagnant". Cartes affectées : FEDERATION, FAISANT GISELE, MAZEL ERIC, SALLOIGNON AGNES.

L'utilisateur perd l'information visuelle critique du montant et du nombre de devis sur ces leads gagnés.

## 2. Diagnostic — root cause confirmée par audit DB

### 2.1. Vue `public.majordhome_kanban_cards`

La vue calcule les cartes Kanban en filtrant `lead_pennylane_quotes.quote_status` contre une allowlist (cf migration `20260525_majordhome_kanban_cards.sql`) :

| Statut(s) reconnu(s) | Colonne Kanban |
|---|---|
| `pending`, `draft` | Devis envoyé |
| `accepted` | Gagné |
| `refused`, `denied`, `expired`, `canceled` | Perdu |

Toute autre valeur génère 1 ligne `lead_quote_stats` avec counts=0 (donc skip des 3 UNION par `WHERE *_count > 0`) ET fait skipper le fallback `classic` via `NOT EXISTS (lead_quote_stats)`. **Résultat : aucune carte créée pour ces leads** → le frontend retombe sur une carte synthétique basée sur `leads.status_id` sans `devis_count`.

### 2.2. Audit DB — distribution actuelle (2026-05-25)

```sql
SELECT quote_status, COUNT(*), COUNT(*) FILTER (WHERE is_winning_quote) AS winning
FROM majordhome.lead_pennylane_quotes WHERE ejected_at IS NULL
GROUP BY quote_status ORDER BY total DESC;
```

| quote_status | total | winning | distinct_leads |
|---|---|---|---|
| `expired` | 67 | **1** | 49 |
| `pending` | 47 | 0 | 32 |
| `denied` | 18 | 0 | 18 |
| `accepted` | 15 | **13** | 14 |
| **`invoiced`** | **5** | **4** | **5** |

### 2.3. 2 anomalies identifiées

1. **`invoiced` (5 lignes, hors allowlist)** — 4 leads en colonne Gagné (FAISANT, FEDERATION, MAZEL, SALLOIGNON) + 1 lead en colonne Devis envoyé (FRENCH COUNTRY, multi-devis). Pennylane bascule le statut interne de `accepted` à `invoiced` quand le devis est transformé en facture émise. Le cron `pennylane-sync-quote-status` recopie cette valeur sans la mapper vers l'allowlist Kanban.

2. **Invariant violé : `is_winning_quote=true` AND `quote_status != 'accepted'`** — 5 lignes au total (les 4 invoiced ci-dessus + 1 cas `expired` : LEMUR JEROME, D-2026-04123). Tous datent du backfill `2026-05-01 10:19:xx` (one-shot 13 leads Gagnés, cf migration commit `c4518cae`). À ce moment-là, les devis étaient déjà passés en `invoiced`/`expired` côté PL, le backfill a flaggé winning sans normaliser le statut.

### 2.4. Cas FRENCH COUNTRY (multi-devis, hors scope strict du bug #7 mais voisin)

Lead avec 2 devis attachés :
- D-2026-05150 : pending (3391€)
- D-2026-05149 : invoiced (1140€, non-winning)

Comportement actuel : carte "Devis envoyé" avec `devis_count=1` (pending). Le devis facturé est invisible. Comportement souhaité (selon spec multi-devis) : 1 carte Devis envoyé + 1 carte Gagné pour le même lead (mix pending/accepted). Le fix de bug #7 va automatiquement faire apparaître la carte Gagné aussi.

## 3. Options de fix

### Option A — Normaliser la data (`invoiced → accepted`)

**Migration** :
```sql
UPDATE majordhome.lead_pennylane_quotes
SET quote_status = 'accepted'
WHERE quote_status = 'invoiced' AND ejected_at IS NULL;
```

**Pour** : simple, élimine `invoiced` de la base, la vue Kanban reste inchangée.
**Contre** : on perd l'info métier "ce devis a été transformé en facture" (utile pour Sprint 9 invoices). Le cron `pennylane-sync-quote-status` doit en plus mapper `invoiced → accepted` à chaque sync (sinon redrift).

### Option B — Étendre la vue Kanban (recommandée)

**Migration vue** : ajouter `invoiced` à l'allowlist `accepted_count` (sémantiquement = devis signé, juste à un stade ultérieur).

```sql
COUNT(*) FILTER (WHERE lpq.quote_status IN ('accepted','invoiced')) AS accepted_count
SUM(...)  FILTER (WHERE lpq.quote_status IN ('accepted','invoiced')) AS accepted_sum
```

**Pour** :
- Préserve l'info métier `invoiced` en DB (utile pour distinguer "signé mais pas facturé" vs "signé et facturé" dans futures features facturation/relances)
- Pas de migration data destructive
- Pas de mapping à maintenir côté cron
- Si PL ajoute d'autres statuts post-accepted (`paid`, etc.), il suffira d'étendre l'allowlist

**Contre** : la vue grossit (1 valeur en plus). Acceptable.

### Recommandation : **Option B**

Plus respectueuse de la sémantique métier + moins de dette de maintenance (cron, allowlist, mapping). On préserve `invoiced` comme valeur valide post-accepted, on l'inclut dans la colonne Gagné côté Kanban.

## 4. Invariant à enforcer côté DB

Indépendamment du choix A/B, l'invariant **"`is_winning_quote=true` ⟹ `quote_status` ∈ {`accepted`, `invoiced`}"** doit être garanti structurellement. Aujourd'hui violé sur 5 lignes (4 invoiced legacy backfill + 1 expired anormal).

### Migration data de cohérence

```sql
-- 4.1. Pour les 4 invoiced winning : déjà OK après option B (invoiced reconnu)
--   → aucun UPDATE nécessaire si option B retenue, ils tombent dans accepted_count

-- 4.2. Pour le 1 expired winning (LEMUR JEROME, D-2026-04123) :
-- 2 choix sémantiques :
--   (a) le commercial a déclaré gagné → on force accepted (préserve geste user)
--   (b) le devis est expiré côté PL → on retire le winning flag (data PL prime)
-- Choix proposé : (a) — le winning est une décision business MDH, pas un état PL.
UPDATE majordhome.lead_pennylane_quotes
SET quote_status = 'accepted'
WHERE is_winning_quote = true
  AND quote_status NOT IN ('accepted','invoiced')
  AND ejected_at IS NULL;
-- Estimé : 1 ligne (LEMUR JEROME D-2026-04123 expired → accepted)
```

### Trigger BEFORE INSERT/UPDATE (garde-fou amont)

```sql
CREATE OR REPLACE FUNCTION majordhome.lead_pennylane_quotes_invariant_winning()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si on flag winning, force le statut compatible
  IF NEW.is_winning_quote = true
     AND NEW.quote_status NOT IN ('accepted','invoiced') THEN
    NEW.quote_status := 'accepted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lead_pennylane_quotes_invariant_winning
BEFORE INSERT OR UPDATE OF is_winning_quote, quote_status
ON majordhome.lead_pennylane_quotes
FOR EACH ROW
EXECUTE FUNCTION majordhome.lead_pennylane_quotes_invariant_winning();
```

**Effet** : si une RPC ou un cron tente de marquer un devis `winning=true` alors qu'il est `expired`/`refused`/`pending`, le trigger force `quote_status='accepted'`. Préserve le geste commercial.

## 5. Audit cron `pennylane-sync-quote-status`

Le cron actuel recopie probablement `quote.status` PL brut vers `lead_pennylane_quotes.quote_status`. À auditer dans `supabase/functions/pennylane-sync-quote-status/index.ts` :
- Vérifier comment il gère `invoiced` (déjà transmis brut ?)
- Avec option B retenue, le cron continue de poser `invoiced` librement (la vue le reconnaît), pas de mapping à ajouter
- Si PL retourne d'autres valeurs hors allowlist élargie (`paid`, `partially_paid`, etc.) : à logguer pour décision future

**Optionnellement** : ajouter une CHECK CONSTRAINT pour empêcher tout drift futur :
```sql
ALTER TABLE majordhome.lead_pennylane_quotes
ADD CONSTRAINT chk_quote_status
CHECK (quote_status IS NULL OR quote_status IN (
  'pending','draft','accepted','invoiced',
  'refused','denied','expired','canceled'
));
```
→ Toute insertion d'un statut inconnu (futur `paid` PL) ferait échouer le cron explicitement plutôt que de re-créer un bug #7 silencieux. À discuter — peut être trop rigide si PL évolue.

## 6. Plan d'exécution

| # | Action | Type | Effort | Risk |
|---|---|---|---|---|
| 1 | Migration vue `majordhome_kanban_cards` : allowlist `accepted,invoiced` | DDL | 15 min | Bas (CREATE OR REPLACE) |
| 2 | Migration data : 1 expired winning → accepted | DML | 5 min | Nul (1 ligne) |
| 3 | Trigger invariant winning | DDL | 15 min | Bas (BEFORE trigger, idempotent) |
| 4 | Audit cron `pennylane-sync-quote-status` (lecture) | Lecture | 15 min | Nul |
| 5 | (Optionnel) CHECK CONSTRAINT quote_status | DDL | 10 min | Moyen (à coordonner avec cron) |
| 6 | Tests manuels Kanban : 4 cartes Gagné doivent retrouver leur chip | Manuel | 10 min | — |
| 7 | Commit : `fix(pennylane): bug #7 invoiced visible dans Kanban Gagné + invariant winning` | Git | 5 min | — |

**Total** : ~1h. À exécuter en session dédiée (ou en queue session 2 avec bug #5 ROGERO + D.5 cache lookup si périmètre élargi acceptable).

## 7. Tests d'acceptation

- [ ] **Avant migration** : Kanban → colonne Gagné → 4 cartes (FAISANT, FEDERATION, MAZEL, SALLOIGNON) sans chip "devis attaché"
- [ ] **Après migration** : ces 4 cartes affichent chip avec `devis_count=1` + montant
- [ ] **FRENCH COUNTRY** : doit maintenant apparaître dans 2 colonnes (Devis envoyé + Gagné), 1 carte chacune
- [ ] **LEMUR JEROME** : devis D-2026-04123 passe d'`expired` à `accepted` en base
- [ ] **Trigger invariant** : tentative INSERT winning=true + quote_status='refused' → le trigger force `accepted` (test sandbox)
- [ ] **Régression Kanban** : compter cartes par colonne avant/après → seules les 4 Gagné cassées + FRENCH COUNTRY changent

## 8. Hors scope

- Refacto complète du cron `pennylane-sync-quote-status` (à voir si l'audit étape 4 révèle d'autres bugs)
- Migration vers ENUM PostgreSQL pour `quote_status` (rigidité excessive, PL peut évoluer)
- Spec multi-devis détaillée — déjà couverte par `docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md`

## 9. Références

- Brief origine : `docs/PROMPT_PENNYLANE_MATCHING_REFACTOR.md` bug #7 (commits `3e415e9`, `7fde9ce`)
- Vue Kanban : `supabase/migrations/20260525_majordhome_kanban_cards.sql`
- Spec multi-devis : `docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md`
- Bridge spec : `docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md`
