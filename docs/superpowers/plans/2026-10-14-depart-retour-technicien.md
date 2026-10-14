# Départ / Retour par technicien — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** chaque technicien porte un point de départ et un point de retour (défaut agence), surchargeables par jour (« Agence »), utilisés par la feuille de route du jour ET le moteur de tournées.

**Architecture :** un module pur `src/lib/tournee/extremites.js` résout départ/retour (exception du jour > réglage > siège) ; `chargerJournees` attache `journee.depart`/`journee.retour` ; le moteur distingue `depotKey` (départ) et `retourKey` (retour, défaut = départ, rétro-compatible) ; la feuille de route lit le même résolveur et expose un sélecteur Agence / Domicile qui écrit l'exception du jour par RPC.

**Tech Stack :** React 18 + TanStack Query v5, Supabase (Postgres RPC SECURITY DEFINER, vues `security_invoker`), edges Deno, tests `node --test`.

**Spec :** `docs/superpowers/specs/2026-10-14-depart-retour-technicien-design.md`

## Global Constraints

- Sans réglage ni exception : comportement **identique** à aujourd'hui (départ = retour = `getOrgHeadquarters(settings)`).
- Priorité par extrémité : exception du jour (`'agence'` | `'perso'`) > point personnel du technicien > siège.
- RPC SECURITY DEFINER : `IF auth.uid() IS NULL THEN refuser` en premier, autorisation positive, `REVOKE EXECUTE … FROM PUBLIC, anon`, audit via `has_function_privilege`.
- Nouvelle table `majordhome.*` : RLS + `GRANT SELECT … TO service_role` ; vue `public.majordhome_*` en `security_invoker=true`.
- Vue `majordhome_team_members` : colonnes ajoutées **en fin de liste**.
- Moteur : modules purs, copies Deno régénérées par `npm run sync:tournee-engine` (jamais éditées), JSDoc sur toute signature exportée.
- Retour compté dans le budget ; tolérance `tolerance_retour_depot_minutes` appliquée au point de retour ; journée figée jamais recalculée.
- Droits : réglage technicien = org_admin ; exception du jour = org_admin + team_leader.
- Mutations : `unwrapResult()` dans `mutationFn`, appelant en try/catch + toast. Cache keys centralisées avec `orgId` en 1ᵉʳ.
- Pas de `console.*` (logger), Tailwind only, pas de preview tools : vérifier par `npx vite build`.

## Review Focus

1. Point personnel aux coordonnées invalides (`lat` texte vide, NaN) → repli siège, jamais `"NaN,NaN"` en clé. Test dans Task 2.
2. Exception `'perso'` sur un technicien sans point personnel → agence, sans erreur. Test dans Task 2.
3. Siège non configuré mais point personnel saisi → le moteur et la feuille fonctionnent avec le point personnel (aujourd'hui `siege_non_configure`). Comportement retenu : le siège reste exigé côté edges (message existant), la feuille de route utilise le point personnel. Test résolveur Task 2.
4. Départ ≠ retour : dernier intervalle de `placerCandidat` mesure le retour vers `retourKey`, pas vers le départ. Test Task 3.
5. Feuille de route d'un commercial sans ressource `team_members` → agence, sélecteur masqué. Test Task 7 (modèle) / revue manuelle.

---

### Task 1 : Migration DB (réglage, exception du jour, RPC, vues)

**Files :**
- Create : `supabase/migrations/20261014_1_depart_retour_technicien.sql`
- Modify : `scripts/migration-rehearsal/snapshot.mjs` (ajouter la fonction `public.team_member_set_routing_settings` aux FUNCTIONS si absente)

**Interfaces — produit :**
- `majordhome.team_members.depart_point jsonb`, `.retour_point jsonb` (NULL = agence), exposées en fin de `public.majordhome_team_members`.
- `public.team_member_set_routing_settings(p_team_member_id uuid, p_daily_work_minutes int DEFAULT NULL, p_include_in_routing bool DEFAULT NULL, p_specialties text[] DEFAULT NULL, p_depart_point jsonb DEFAULT NULL, p_retour_point jsonb DEFAULT NULL, p_reset_depart bool DEFAULT false, p_reset_retour bool DEFAULT false) RETURNS TABLE(daily_work_minutes int, include_in_routing bool, specialties text[], depart_point jsonb, retour_point jsonb)`.
- `majordhome.team_member_day_endpoints(id, org_id, team_member_id, date, depart, retour, created_by, created_at, updated_at)` + vue `public.majordhome_team_member_day_endpoints`.
- `public.team_member_set_day_endpoints(p_team_member_id uuid, p_date date, p_depart text, p_retour text) RETURNS TABLE(team_member_id uuid, date date, depart text, retour text)` (0 ligne si supprimée).

- [ ] **Step 1 : écrire la migration**

```sql
-- 20261014_1_depart_retour_technicien.sql
-- Spec : docs/superpowers/specs/2026-10-14-depart-retour-technicien-design.md

-- 1. Réglage du technicien ---------------------------------------------------
ALTER TABLE majordhome.team_members
  ADD COLUMN IF NOT EXISTS depart_point jsonb,
  ADD COLUMN IF NOT EXISTS retour_point jsonb;

ALTER TABLE majordhome.team_members
  ADD CONSTRAINT team_members_depart_point_shape CHECK (
    depart_point IS NULL OR (jsonb_typeof(depart_point->'lat') = 'number' AND jsonb_typeof(depart_point->'lng') = 'number')),
  ADD CONSTRAINT team_members_retour_point_shape CHECK (
    retour_point IS NULL OR (jsonb_typeof(retour_point->'lat') = 'number' AND jsonb_typeof(retour_point->'lng') = 'number'));

CREATE OR REPLACE VIEW public.majordhome_team_members WITH (security_invoker = true) AS
SELECT id, org_id, first_name, last_name, display_name, email, phone, role, specialties,
       calendar_color, google_calendar_id, google_calendar_email, default_availability,
       default_zone, slack_user_id, is_active, created_at, updated_at, user_id,
       daily_work_minutes, include_in_routing,
       depart_point, retour_point
FROM majordhome.team_members;

-- 2. RPC réglages de tournée : signature étendue (DROP : le type de retour change)
DROP FUNCTION IF EXISTS public.team_member_set_routing_settings(uuid, integer, boolean, text[]);

CREATE FUNCTION public.team_member_set_routing_settings(
  p_team_member_id uuid,
  p_daily_work_minutes integer DEFAULT NULL,
  p_include_in_routing boolean DEFAULT NULL,
  p_specialties text[] DEFAULT NULL,
  p_depart_point jsonb DEFAULT NULL,
  p_retour_point jsonb DEFAULT NULL,
  p_reset_depart boolean DEFAULT false,
  p_reset_retour boolean DEFAULT false
)
RETURNS TABLE (daily_work_minutes integer, include_in_routing boolean, specialties text[],
               depart_point jsonb, retour_point jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_core_org_id uuid;
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF p_daily_work_minutes IS NOT NULL AND (p_daily_work_minutes < 60 OR p_daily_work_minutes > 1440) THEN
    RAISE EXCEPTION 'Budget journalier hors bornes (60-1440 min): %', p_daily_work_minutes USING ERRCODE = '22023';
  END IF;
  -- Un point sans coordonnées numériques est une faute de saisie, pas un réglage.
  IF p_depart_point IS NOT NULL AND (jsonb_typeof(p_depart_point->'lat') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_depart_point->'lng') IS DISTINCT FROM 'number') THEN
    RAISE EXCEPTION 'Point de départ sans coordonnées' USING ERRCODE = '22023';
  END IF;
  IF p_retour_point IS NOT NULL AND (jsonb_typeof(p_retour_point->'lat') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_retour_point->'lng') IS DISTINCT FROM 'number') THEN
    RAISE EXCEPTION 'Point de retour sans coordonnées' USING ERRCODE = '22023';
  END IF;

  SELECT o.core_org_id INTO v_core_org_id
  FROM majordhome.team_members tm JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;
  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  SELECT om.role INTO v_role FROM core.organization_members om
  WHERE om.user_id = v_user_id AND om.org_id = v_core_org_id;
  IF v_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un org_admin peut modifier les reglages de tournee (role=%)', v_role USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE majordhome.team_members tm
     SET daily_work_minutes = COALESCE(p_daily_work_minutes, tm.daily_work_minutes),
         include_in_routing = COALESCE(p_include_in_routing, tm.include_in_routing),
         specialties        = COALESCE(p_specialties, tm.specialties),
         depart_point       = CASE WHEN p_reset_depart THEN NULL ELSE COALESCE(p_depart_point, tm.depart_point) END,
         retour_point       = CASE WHEN p_reset_retour THEN NULL ELSE COALESCE(p_retour_point, tm.retour_point) END,
         updated_at         = NOW()
   WHERE tm.id = p_team_member_id
  RETURNING tm.daily_work_minutes, tm.include_in_routing, tm.specialties, tm.depart_point, tm.retour_point;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[], jsonb, jsonb, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[], jsonb, jsonb, boolean, boolean) TO authenticated;

-- 3. Exception du jour -------------------------------------------------------
CREATE TABLE majordhome.team_member_day_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES majordhome.organizations(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES majordhome.team_members(id) ON DELETE CASCADE,
  date date NOT NULL,
  depart text CHECK (depart IN ('agence', 'perso')),
  retour text CHECK (retour IN ('agence', 'perso')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_member_day_endpoints_uniq UNIQUE (team_member_id, date),
  CONSTRAINT team_member_day_endpoints_non_vide CHECK (depart IS NOT NULL OR retour IS NOT NULL)
);
CREATE INDEX team_member_day_endpoints_org_date ON majordhome.team_member_day_endpoints (org_id, date);

ALTER TABLE majordhome.team_member_day_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_member_day_endpoints_select ON majordhome.team_member_day_endpoints
  FOR SELECT TO authenticated
  USING (org_id IN (
    SELECT o.id FROM majordhome.organizations o
    JOIN core.organization_members om ON om.org_id = o.core_org_id
    WHERE om.user_id = auth.uid()));
-- Aucune policy d'écriture : la RPC ci-dessous est le seul écrivain.
GRANT SELECT ON majordhome.team_member_day_endpoints TO authenticated, service_role;

CREATE VIEW public.majordhome_team_member_day_endpoints WITH (security_invoker = true) AS
SELECT id, org_id, team_member_id, date, depart, retour, created_by, created_at, updated_at
FROM majordhome.team_member_day_endpoints;
GRANT SELECT ON public.majordhome_team_member_day_endpoints TO authenticated, service_role;

CREATE FUNCTION public.team_member_set_day_endpoints(
  p_team_member_id uuid, p_date date, p_depart text DEFAULT NULL, p_retour text DEFAULT NULL)
RETURNS TABLE (team_member_id uuid, date date, depart text, retour text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_core_org_id uuid;
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Date requise' USING ERRCODE = '22023';
  END IF;
  IF (p_depart IS NOT NULL AND p_depart NOT IN ('agence', 'perso'))
     OR (p_retour IS NOT NULL AND p_retour NOT IN ('agence', 'perso')) THEN
    RAISE EXCEPTION 'Valeur hors liste (agence | perso)' USING ERRCODE = '22023';
  END IF;

  SELECT tm.org_id, o.core_org_id INTO v_org_id, v_core_org_id
  FROM majordhome.team_members tm JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;
  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  SELECT om.role INTO v_role FROM core.organization_members om
  WHERE om.user_id = v_user_id AND om.org_id = v_core_org_id;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Réservé aux responsables (role=%)', v_role USING ERRCODE = '42501';
  END IF;

  IF p_depart IS NULL AND p_retour IS NULL THEN
    DELETE FROM majordhome.team_member_day_endpoints e
     WHERE e.team_member_id = p_team_member_id AND e.date = p_date AND e.org_id = v_org_id;
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO majordhome.team_member_day_endpoints AS e (org_id, team_member_id, date, depart, retour, created_by)
  VALUES (v_org_id, p_team_member_id, p_date, p_depart, p_retour, v_user_id)
  ON CONFLICT (team_member_id, date) DO UPDATE
     SET depart = EXCLUDED.depart, retour = EXCLUDED.retour, updated_at = now()
  RETURNING e.team_member_id, e.date, e.depart, e.retour;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.team_member_set_day_endpoints(uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_day_endpoints(uuid, date, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2 : répétition** — `node scripts/migration-rehearsal/…` selon le README du harnais (étendre `snapshot.mjs` si la fonction ou la table `organizations` manque). Attendu : migration passe sans erreur.
- [ ] **Step 3 : appliquer en prod** (`apply_migration`, projet `ejqqqwudmizqisdkxohw`), puis audit :

```sql
SELECT has_function_privilege('anon', 'public.team_member_set_routing_settings(uuid,integer,boolean,text[],jsonb,jsonb,boolean,boolean)', 'EXECUTE') AS anon_routing,
       has_function_privilege('anon', 'public.team_member_set_day_endpoints(uuid,date,text,text)', 'EXECUTE') AS anon_day,
       has_table_privilege('service_role', 'majordhome.team_member_day_endpoints', 'SELECT') AS sr_day,
       (SELECT is_insertable_into FROM information_schema.views WHERE table_name = 'majordhome_team_members') AS tm_insertable;
```
Attendu : `false, false, true, YES`.
- [ ] **Step 4 : commit** `feat(db): départ / retour par technicien + exception du jour`.

---

### Task 2 : Résolveur pur `extremites.js`

**Files :**
- Create : `src/lib/tournee/extremites.js`, `scripts/tournee/extremites.test.mjs`
- Modify : `scripts/sync-tournee-engine.mjs` (ajouter `'extremites'` à `NOMS`)

**Interfaces — produit :**
- `resoudreExtremites({ siege, membre, exception }) → { depart: Point|null, retour: Point|null }`, `Point = { lat:number, lng:number, label:string, address:string|null, source:'agence'|'perso' }`. `membre = { depart_point, retour_point }`, `exception = { depart, retour }|null`.
- `pointsDeJournee(journee, depot) → { depart, retour, depotKey:string, retourKey:string }` (départ = `journee.depart ?? depot`, retour = `journee.retour ?? départ`, clés `cleCoord` ou `''`).
- `pointValide(p) → boolean`.

- [ ] **Step 1 : tests (échouent)**

```js
// scripts/tournee/extremites.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resoudreExtremites, pointsDeJournee } from '../../src/lib/tournee/extremites.js';

const siege = { lat: 43.9, lng: 1.9, label: 'Gaillac' };
const maison = { label: 'Domicile', address: '1 rue X, 31620 Bouloc', lat: 43.78, lng: 1.41 };

test('sans réglage ni exception : agence aux deux bouts', () => {
  const r = resoudreExtremites({ siege, membre: {}, exception: null });
  assert.equal(r.depart.source, 'agence'); assert.equal(r.retour.source, 'agence');
  assert.equal(r.depart.label, 'Gaillac');
});
test('réglage personnel : départ et retour indépendants', () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: maison, retour_point: null } });
  assert.equal(r.depart.source, 'perso'); assert.equal(r.depart.lat, 43.78);
  assert.equal(r.retour.source, 'agence');
});
test("exception 'agence' l'emporte sur le réglage", () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: maison, retour_point: maison }, exception: { depart: null, retour: 'agence' } });
  assert.equal(r.depart.source, 'perso'); assert.equal(r.retour.source, 'agence');
});
test("exception 'perso' sans point personnel : agence, sans erreur", () => {
  const r = resoudreExtremites({ siege, membre: {}, exception: { depart: 'perso', retour: 'perso' } });
  assert.equal(r.depart.source, 'agence');
});
test('point personnel invalide : repli siège', () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: { lat: '', lng: 'abc' } } });
  assert.equal(r.depart.source, 'agence');
});
test('siège absent : point personnel seul, sinon null', () => {
  assert.equal(resoudreExtremites({ siege: null, membre: { depart_point: maison } }).depart.source, 'perso');
  assert.equal(resoudreExtremites({ siege: null, membre: {} }).depart, null);
});
test('libellé perso : label + commune', () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: maison } });
  assert.equal(r.depart.label, 'Domicile (Bouloc)');
});
test('pointsDeJournee : retour = départ par défaut, siège en repli', () => {
  const p = pointsDeJournee({}, siege);
  assert.equal(p.depotKey, p.retourKey);
  const q = pointsDeJournee({ depart: { lat: 43.78, lng: 1.41 }, retour: { lat: 43.9, lng: 1.9 } }, siege);
  assert.notEqual(q.depotKey, q.retourKey);
  assert.equal(pointsDeJournee(null, null).depotKey, '');
});
```

- [ ] **Step 2 :** `node --test scripts/tournee/extremites.test.mjs` → FAIL (module absent).
- [ ] **Step 3 : implémentation**

```js
// src/lib/tournee/extremites.js
// ============================================================================
// Départ / retour d'une journée de technicien. Module PUR (copié pour Deno).
// Priorité, par extrémité : exception du jour > point personnel > siège.
// Testé : node --test scripts/tournee/extremites.test.mjs
// Spec : docs/superpowers/specs/2026-10-14-depart-retour-technicien-design.md
// ============================================================================
import { cleCoord } from './geo.js';

/**
 * @typedef {{ lat: number, lng: number, label: string, address: string|null, source: 'agence'|'perso' }} Point
 */

/** @param {any} p @returns {boolean} */
export function pointValide(p) {
  if (!p) return false;
  const ok = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
  return ok(p.lat) && ok(p.lng);
}

function communeDe(address) {
  const m = /\b\d{5}\s+(.+)$/.exec(String(address || '').trim());
  return m ? m[1].trim() : null;
}

/** @param {any} siege @returns {Point|null} */
function pointAgence(siege) {
  if (!pointValide(siege)) return null;
  return { lat: Number(siege.lat), lng: Number(siege.lng), label: siege.label || 'Agence', address: siege.address ?? null, source: 'agence' };
}

/** @param {any} p @returns {Point|null} */
function pointPerso(p) {
  if (!pointValide(p)) return null;
  const base = (p.label || 'Domicile').trim();
  const commune = communeDe(p.address);
  return {
    lat: Number(p.lat), lng: Number(p.lng),
    label: commune && !base.includes(commune) ? `${base} (${commune})` : base,
    address: p.address ?? null, source: 'perso',
  };
}

/**
 * @param {{ siege: any, membre?: { depart_point?: any, retour_point?: any }|null, exception?: { depart?: string|null, retour?: string|null }|null }} p
 * @returns {{ depart: Point|null, retour: Point|null }}
 */
export function resoudreExtremites({ siege, membre = null, exception = null }) {
  const agence = pointAgence(siege);
  const un = (choix, perso) => {
    if (choix === 'agence') return agence ?? pointPerso(perso);
    return pointPerso(perso) ?? agence;
  };
  return {
    depart: un(exception?.depart ?? null, membre?.depart_point),
    retour: un(exception?.retour ?? null, membre?.retour_point),
  };
}

/**
 * Points effectifs d'une journée du moteur (`journee.depart/retour` posés par
 * chargerJournees), siège en repli.
 * @param {{ depart?: any, retour?: any }|null} journee
 * @param {{ lat: number, lng: number }|null} depot
 * @returns {{ depart: any, retour: any, depotKey: string, retourKey: string }}
 */
export function pointsDeJournee(journee, depot) {
  const depart = journee?.depart ?? depot ?? null;
  const retour = journee?.retour ?? depart;
  const depotKey = cleCoord(depart) ?? '';
  return { depart, retour, depotKey, retourKey: cleCoord(retour) ?? depotKey };
}
```

- [ ] **Step 4 :** tests → PASS. Ajouter `'extremites'` à `NOMS` de `scripts/sync-tournee-engine.mjs`.
- [ ] **Step 5 : commit** `feat(tournee): résolveur départ / retour`.

---

### Task 3 : Moteur — `retourKey` distinct du départ

**Files :**
- Modify : `src/lib/tournee/sequence.js` (`simuler`, `diagnostiquerJournee`, `sequencerTournee`), `src/lib/tournee/creneaux.js` (`tenterDecalage`, `chargeExistante`, `intervalles`, `placerCandidat`, `classerParCreneaux`, `placerPlusieurs`, `finDeJournee`), `src/lib/tournee/plein.js` (`evaluerRemplissage`, `verdictJournee`), `src/lib/tournee/proposer-contrat.js`, `src/lib/tournee/auto-rdv.js` (`contexteSequencement`, `placerParSequencement`, `creneauxPourContrat`)
- Test : `scripts/tournee/sequence.test.mjs`, `creneaux.test.mjs`, `plein.test.mjs`, `proposer-contrat.test.mjs`

**Interfaces :**
- Consomme : `pointsDeJournee` (Task 2).
- Produit : tout contexte qui acceptait `depotKey` accepte `retourKey` (optionnel, défaut `depotKey`). `verdictJournee`, `placerParSequencement`, `creneauxPourContrat`, `proposerPourContrat` calculent `pointsDeJournee(journee, depot)` par journée.

Règle de remplacement (appliquer partout, sans exception) :
- trajets **vers** la fin de journée : `trajet(position, depotKey)` → `trajet(position, retourKey)` (sequence `simuler` retour, `diagnostiquerJournee` retour, `chargeExistante` dernier tronçon, `finDeJournee`, `tenterDecalage` branche « pas de suivant » `amplitude.fin - trajetOu(trajet, apres.key, retourKey)`, `intervalles` `keyApres: apres ? apres.key : retourKey`, `proposer-contrat` `keyApres` repli `retourKey`).
- trajets **depuis** le début : inchangés sur `depotKey`.
- déstructurer `retourKey = depotKey` en tête de chaque fonction qui reçoit `depotKey`, et le transmettre dans les appels internes (`placerCandidat` → `chargeExistante`, `intervalles`, `tenterDecalage` ; `classerParCreneaux`/`placerPlusieurs` → `placerCandidat` ; `sequencerTournee` ctx → `simuler`/`diagnostiquerJournee` ; `evaluerRemplissage` → `diagnostiquerJournee`).
- fonctions `{ journee, depot }` : remplacer `cleCoord(depot)` par `const { depart, depotKey, retourKey } = pointsDeJournee(journee, depot)`, et `construireArretsExistants(rdvs, depot, …)` / `…PourConsolidation` par `(rdvs, depart, …)`. Dans `proposerPourContrat`, faire ce calcul **dans la boucle** sur `journees` (point par journée).
- JSDoc : documenter `retourKey` (« clé du point de retour ; défaut = depotKey »).

- [ ] **Step 1 : tests départ ≠ retour (échouent)** — ajouter :

```js
// scripts/tournee/sequence.test.mjs
test('retour vers retourKey distinct du départ', () => {
  const t = (a, b) => (a === b ? 0 : ({ 'D|A': 10, 'A|R': 50, 'A|D': 5 })[`${a}|${b}`] ?? 99);
  const r = sequencerTournee({ depotKey: 'D', retourKey: 'R', arrets: [{ id: 'a', key: 'A', dureeMinutes: 60 }],
    trajet: t, amplitude: { debut: 480, fin: 1080 }, budgetMinutes: 600 });
  assert.equal(r.chargeMinutes, 10 + 60 + 50);
  assert.equal(r.finMinutes, 480 + 10 + 60 + 50);
});
test('sans retourKey : comportement inchangé', () => {
  const t = (a, b) => (a === b ? 0 : ({ 'D|A': 10, 'A|D': 5 })[`${a}|${b}`] ?? 99);
  const r = sequencerTournee({ depotKey: 'D', arrets: [{ id: 'a', key: 'A', dureeMinutes: 60 }],
    trajet: t, amplitude: { debut: 480, fin: 1080 }, budgetMinutes: 600 });
  assert.equal(r.chargeMinutes, 75);
});
```

```js
// scripts/tournee/creneaux.test.mjs
test('chargeExistante et finDeJournee : dernier tronçon vers retourKey', () => {
  const t = (a, b) => (a === b ? 0 : ({ 'D|A': 10, 'A|R': 40, 'A|D': 5 })[`${a}|${b}`] ?? 99);
  const arrets = [{ id: 'a', key: 'A', dureeMinutes: 60, fenetre: { debut: 540, fin: 540 } }];
  assert.equal(chargeExistante(arrets, { trajet: t, depotKey: 'D', retourKey: 'R' }), 60 + 10 + 40);
  assert.equal(finDeJournee(arrets, { trajet: t, depotKey: 'D', retourKey: 'R' }), 600 + 40);
});
test('placerCandidat : le dernier intervalle mesure le retour vers retourKey', () => {
  // Candidat C proche du départ, très loin du retour : la journée déborde.
  const t = (a, b) => (a === b ? 0 : ({ 'D|C': 5, 'C|R': 300, 'C|D': 5 })[`${a}|${b}`] ?? 99);
  const base = { arrets: [], candidat: { id: 'c', key: 'C', dureeMinutes: 60 }, trajet: t,
    depotKey: 'D', amplitude: { debut: 480, fin: 1080 }, budgetMinutes: 600 };
  assert.equal(placerCandidat(base).faisable, true);
  assert.equal(placerCandidat({ ...base, retourKey: 'R' }).faisable, false);
});
```

```js
// scripts/tournee/plein.test.mjs
test('verdictJournee lit journee.depart / journee.retour', () => {
  const journee = { date: '2026-10-20', amplitude: { debut: 480, fin: 1080 }, budgetMinutes: 480,
    depart: { lat: 43.0, lng: 1.0 }, retour: { lat: 44.0, lng: 2.0 },
    rdvs: [{ id: 'r', lat: 43.0, lng: 1.0, duration_minutes: 60, scheduled_start: '09:00', appointment_type: 'maintenance' }] };
  const vus = [];
  const trajet = (a, b) => { vus.push(`${a}|${b}`); return 10; };
  verdictJournee({ journee, depot: { lat: 45, lng: 3 }, reglages: { reste_utile_min_minutes: 75 }, trajet });
  assert.ok(vus.some((k) => k.endsWith('|44.000,2.000')), 'retour vers journee.retour');
  assert.ok(!vus.some((k) => k.includes('45.000,3.000')), 'siège ignoré quand la journée porte ses points');
});
```
(Adapter le format de clé à `cleCoord` réel — vérifier dans `geo.js` le séparateur et le nombre de décimales avant d'écrire l'assertion.)

```js
// scripts/tournee/proposer-contrat.test.mjs — journée portant son départ
test('proposerPourContrat utilise le départ de chaque journée', () => {
  // Reprendre le fixture existant du fichier (contrat, technicien compétent, journée amorcée) et poser
  // journee.depart au point du contrat : trajetAllerMinutes doit valoir trajet(départ→contrat) = 0.
});
```
Écrire ce dernier test en réutilisant concrètement le fixture le plus simple déjà présent dans `proposer-contrat.test.mjs` (copier ses objets `contrat`, `techniciens`, `journees`, `reglages`, `trajet`), en ajoutant `depart` sur la journée et en assertant `creneaux[0].trajetAllerMinutes`.

- [ ] **Step 2 :** `node --test scripts/tournee/*.test.mjs` → nouveaux tests FAIL, anciens PASS.
- [ ] **Step 3 :** appliquer la règle de remplacement dans les 5 fichiers.
- [ ] **Step 4 :** `node --test scripts/tournee/*.test.mjs` → tout PASS (y compris `purete.test.mjs`).
- [ ] **Step 5 : commit** `feat(tournee): retour distinct du départ dans le moteur`.

---

### Task 4 : `chargerJournees` attache départ / retour

**Files :** Modify `src/lib/tournee/loaders.js` ; Test `scripts/tournee/loaders.test.mjs`

**Interfaces :**
- Consomme : `resoudreExtremites` (Task 2).
- Produit : `chargerJournees({ …, siege = null })` ; chaque `Journee` a `depart: Point|null`, `retour: Point|null` (JSDoc `@property`). SELECT membres + `depart_point, retour_point`. Lecture `majordhome_team_member_day_endpoints` `.eq('org_id', mdhOrgId).gte('date', …).lte('date', …)`, `{ error }` → retour `error`.

- [ ] **Step 1 : test** — dans `loaders.test.mjs`, étendre le faux client existant pour servir `majordhome_team_member_day_endpoints` ; asserter : membre avec `depart_point` ⇒ `journee.depart.source === 'perso'` ; exception `retour:'agence'` à la date ⇒ `journee.retour.source === 'agence'` ; sans `siege` ni point ⇒ `depart === null`.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : implémentation** — ajouter `siege = null` aux paramètres ; `depart_point, retour_point` au SELECT ; après les compétences :

```js
  const { data: exceptions, error: exErr } = membreIds.length
    ? await client.from('majordhome_team_member_day_endpoints')
        .select('team_member_id, date, depart, retour')
        .eq('org_id', orgId).gte('date', iso(debut)).lte('date', iso(fin))
    : { data: [], error: null };
  if (exErr) return { data: [], techniciens: [], error: exErr };
  const exceptionPar = new Map((exceptions || []).map((e) => [`${e.team_member_id}|${e.date}`, e]));
```
et dans `journees.push({...})` : `...resoudreExtremites({ siege, membre: m, exception: exceptionPar.get(\`${m.id}|${date}\`) ?? null }),`.
- [ ] **Step 4 :** PASS. **Step 5 : commit** `feat(tournee): journées porteuses de leur départ / retour`.

---

### Task 5 : Appelants navigateur du moteur

**Files :** Modify `src/shared/services/tournees.service.js` (`getJourneesHorizon`, `proposerPourJournee`), `src/shared/hooks/useTournees.js` (l. ~252 et ~304), `src/apps/artisan/components/tournees/RemplirJourneePanel.jsx`, `useJourneePose.js`, `useConsolidationJournee.js`

- [ ] `getJourneesHorizon` : `chargerJournees({ …, siege: getOrgHeadquarters(settings) })`.
- [ ] `proposerPourJournee` : après le test `!depot`, `const { depart, retour, depotKey, retourKey } = pointsDeJournee(journee, depot);` ; `construireArretsExistants(journee.rdvs, depart)` ; barycentre avec `depart` ; `noyau = [depart, ...(retourKey !== depotKey ? [retour] : []), ...arrets]` ; `ctx` avec `depotKey, retourKey`.
- [ ] `useTournees.js` : `verdictJournee` reçoit déjà `journee` → rien à changer hors le siège (vérifier que `j` est bien la journée chargée).
- [ ] `RemplirJourneePanel` : `construireArretsExistants(journeeAjustee?.rdvs, pointsDeJournee(journeeAjustee, depot).depart)`.
- [ ] `useJourneePose` : dans `contexte` (l. ~106) `const { depotKey, retourKey } = pointsDeJournee(journee, depot)` ; idem pour toute construction d'arrêts / noyau de matrice dans ce hook (l. ~206).
- [ ] `useConsolidationJournee` : `const { depart, depotKey, retourKey } = pointsDeJournee(journee, depot)` ; `construireArretsPourConsolidation(rdvs, depart, …)` ; ctx `depotKey, retourKey`.
- [ ] `grep -rn "cleCoord(depot)" src` → plus aucun résultat hors `extremites.js`.
- [ ] `npx vite build` OK. **Commit** `feat(tournees): écrans du moteur sur départ / retour de la journée`.

---

### Task 6 : Edges

**Files :** Modify `supabase/functions/slots-propose/index.ts`, `tournees-figer/index.ts`, `_shared/autoRdvContexte.ts`, `auto-rdv-cron/index.ts` (+ `auto-rdv`, `agent-creneaux` si elles construisent arrêts/noyau hors contexte) ; régénérer `_shared/tournee/*`.

- [ ] `npm run sync:tournee-engine`.
- [ ] Dans chaque appel `chargerJournees(...)` : passer `siege: depot` (le `siegeDepuis(settings)` local).
- [ ] Partout où une edge construit des arrêts ou un noyau de matrice pour une journée : `const { depart, retour, depotKey, retourKey } = pointsDeJournee(j, depot)` (import depuis `../_shared/tournee/extremites.js` ou `./tournee/extremites.js`), arrêts sur `depart`, noyau `[depart, retour?, ...arrets]` dédoublonné par clé, `depotKey/retourKey` dans les ctx.
- [ ] `deno check` de chaque edge touchée (si Deno absent localement : contrôle par `deploy_edge_function`, qui type-check au bundling).
- [ ] `node --test scripts/tournee/sync-engine.test.mjs` PASS.
- [ ] Déployer `slots-propose`, `tournees-figer`, `auto-rdv`, `auto-rdv-cron`, `agent-creneaux` (même `verify_jwt` que `supabase/config.toml`, fichiers `_shared` inclus avec noms relatifs `../_shared/...`).
- [ ] **Commit** `feat(edges): départ / retour du technicien dans les edges du moteur`.

---

### Task 7 : Feuille de route

**Files :** Modify `src/lib/feuilleDeRoute.js`, `scripts/feuille-de-route.test.mjs`, `src/shared/hooks/useFeuilleDeRoute.js`, `src/apps/artisan/components/planning/FeuilleDeRouteSection.jsx`, `FeuilleDeRoutePDF.jsx` ; Create `src/shared/services/dayEndpoints.service.js`, `src/shared/hooks/useDayEndpoints.js` ; Modify `src/shared/hooks/cacheKeys.js`

**Interfaces — produit :**
- `pointsItineraire(depart, arrets, retour = depart)`, `lienGoogleMapsTournee(depart, arrets, retour = depart)`, `urlCarteStatique({ points, … })` (dernier point = retour, pastille « home » au retour s'il diffère du départ), `buildFeuilleDeRoute({ depart, retour, depot, … })` → `departLabel`, `retourLabel` (`depot` seul = compat : départ = retour = depot ; `depotLabel` conservé = `departLabel`).
- `dayEndpointsService.get({ mdhOrgId, teamMemberId, date })` → `{ data: {depart, retour}|null, error }` ; `dayEndpointsService.set({ teamMemberId, date, depart, retour })` → `{ data, error }` (RPC).
- `useDayEndpoint({ orgId, teamMemberId, date })` → `{ exception, isLoading, setException(next) }` ; mutation `unwrapResult`, invalide `appointmentKeys.dayRoute(orgId, date)`, `dayEndpointKeys.all(orgId)` et la famille de clés des journées de tournée (`tourneeKeys` — vérifier le nom réel dans `cacheKeys.js`).
- `dayEndpointKeys = { all: (orgId) => ['day-endpoints', orgId], byDay: (orgId, memberId, date) => ['day-endpoints', orgId, memberId, date] }`.

- [ ] **Step 1 : tests modèle (échouent)** dans `feuille-de-route.test.mjs` : `pointsItineraire(D, arrets, R)` finit sur R ; `lienGoogleMapsTournee(D, arrets, R)` a `origin=D` et `destination=R` ; `buildFeuilleDeRoute({ depart: {label:'Domicile (Bouloc)'}, retour: {label:'Gaillac'} })` → `departLabel`/`retourLabel` ; compat `depot` seul → deux libellés égaux.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter (les tronçons restent « un par paire de points », le dernier est le retour).
- [ ] **Step 4 :** service + hook + cache keys. Service : lecture `supabase.from('majordhome_team_member_day_endpoints').select('depart, retour').eq('org_id', mdhOrgId).eq('team_member_id', id).eq('date', date).maybeSingle()` ; écriture `supabase.rpc('team_member_set_day_endpoints', { p_team_member_id, p_date, p_depart, p_retour })` ; `withErrorHandling`.
- [ ] **Step 5 : `useFeuilleDeRoute`** : `useTeamMembers` (hook existant, `appointmentKeys.teamMembers`) → `membre = teamMembers.find((tm) => memberIds.includes(tm.id))` ; `useDayEndpoint` sur ce membre ; `const { depart, retour } = resoudreExtremites({ siege: getOrgHeadquarters(settings), membre, exception })` ; `points = pointsItineraire(depart, arrets, retour)` ; exposer `depart, retour, membre, exception, setException, peutChoisir` (`peutChoisir = isTeamLeaderOrAbove && !!membre`) ; `sansDepot: !depart`.
- [ ] **Step 6 : `FeuilleDeRouteSection`** : remplacer les deux lignes « Départ · … » / « Arrivée · … » par un composant local `ExtremiteChoix({ libelle, point, perso, valeur, onChange, editable })` : texte simple si `!editable || !perso` ; sinon deux boutons segmentés « Agence » / libellé perso, actif = `point.source` ; clic → `setException({ ...exception, [cote]: choix === sourceParDefaut ? null : choix })` où `sourceParDefaut` = `'perso'` si le membre a ce point, sinon `'agence'` ; try/catch + `toast.error('Impossible d’enregistrer le point de départ')`.
- [ ] **Step 7 : PDF** : `Départ : {model.departLabel}` / `Arrivée : {model.retourLabel}`. `Planning.jsx` (impression) passe déjà par le hook : vérifier.
- [ ] **Step 8 :** `node --test scripts/feuille-de-route.test.mjs` PASS, `npx vite build` OK. **Commit** `feat(planning): feuille de route — départ / retour du technicien, exception du jour`.

---

### Task 8 : Fiche membre — section « Départ / Retour »

**Files :** Create `src/apps/artisan/pages/settings/team/EndpointsForm.jsx` ; Modify `MemberModal.jsx`, `src/apps/artisan/pages/settings/TeamManagement.jsx`, `src/shared/services/appointments.service.js` (`setTeamMemberRoutingSettings`), `src/shared/hooks/useAppointments.js` (`useSetTeamMemberRouting` : patch cache avec `depart_point`/`retour_point`).

**Interfaces :**
- `setTeamMemberRoutingSettings(id, { dailyWorkMinutes, includeInRouting, departPoint, retourPoint, resetDepart, resetRetour })` → RPC avec `p_depart_point`, `p_retour_point`, `p_reset_depart`, `p_reset_retour` (défauts null/false).
- `EndpointsForm({ teamMember, canEdit, onSave(patch), isSaving })` ; `patch` ∈ `{ departPoint }|{ resetDepart: true }|{ retourPoint }|{ resetRetour: true }`.
- `MemberModal` prop `onEndpointsChange(teamMemberId, patch)` ; `TeamManagement.handleEndpointsChange` → `setRoutingSettings({ teamMemberId, ...patch })` + toast.

- [ ] Lire `AddressSearch.jsx` (props exactes, forme du résultat : `{ label/address, lat, lng }`) avant d'écrire `EndpointsForm`.
- [ ] `EndpointsForm` : deux lignes (Départ, Retour) ; chacune un `SelectInput` « Agence » / « Autre adresse » ; « Autre adresse » affiche `AddressSearch` + champ libellé (défaut « Domicile ») ; enregistrement à la sélection d'une adresse (`{ label, address, lat, lng }`) ; repasser à « Agence » → `reset*` ; ligne Retour : bouton « Même adresse que le départ » (visible si départ perso) → `onSave({ retourPoint: teamMember.depart_point })` ; lecture seule si `!canEdit` (libellé résolu).
- [ ] Insérer `<Section title="Départ / Retour" help="Point de départ et d’arrivée de ses journées (feuille de route, tournées). Par défaut : l’agence. Une exception par jour se pose depuis la feuille de route.">` sous « Budget journalier ».
- [ ] Erreur 22023 → message FR via `routingSettingsErrorMessage` (étendre si besoin : « Adresse sans coordonnées »).
- [ ] `npx vite build` OK ; `npm run lint` sans nouveau warning. **Commit** `feat(settings): départ / retour dans la fiche membre`.

---

### Task 9 : Vérification et livraison

- [ ] `node --test scripts/tournee/*.test.mjs` PASS.
- [ ] `npm run audit:quality` PASS.
- [ ] `npx vite build` OK.
- [ ] Prod : écrire un point de départ test sur un technicien via la RPC n'est pas fait par l'agent (pas d'écriture de données réelles) ; vérifier la lecture : `SELECT depart_point, retour_point FROM public.majordhome_team_members LIMIT 1` (service_role) sans erreur ; `SELECT count(*) FROM public.majordhome_team_member_day_endpoints`.
- [ ] Edges : `list_edge_functions` → nouvelles versions des 5 ; un appel `tournees-figer` n'est pas forcé (cron horaire) — lire ses logs après le prochain passage.
- [ ] `git pull --rebase --autostash`, `git push origin main`, suivi Vercel jusqu'à READY.
- [ ] Note de fin : proposition CLAUDE.md (spec §9) + suivi droits (spec §7).
