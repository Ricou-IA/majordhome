# Auto-RDV — Tranche 2 « Proposer et poser » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page publique `/rdv/:token` où le client d'un contrat dû choisit une demi-journée calculée en direct sur le planning, et une RPC atomique qui pose le rendez-vous ; un bouton « Copier le lien » sur la carte Kanban pour tester et poser par téléphone avant tout envoi de mail.

**Architecture:** Un module PUR `src/lib/tournee/auto-rdv.js` décide de l'offre (journées proposables du mois, demi-journées, placement par `placerCandidat` borné à la demi-journée, empreinte de journée) ; une edge `auto-rdv` (`verify_jwt:false`) porte trois actions : `sign` (JWT + membership → lien signé HMAC), `slots` (jeton → créneaux calculés à l'instant), `book` (jeton → recalcul du placement puis RPC) ; la RPC `auto_rdv_poser` (service_role only) crée ou réutilise la carte d'entretien, pose le RDV en souplesse demi-journée, le technicien, l'étiquette de secteur, **tout ou rien**, en refusant si l'empreinte de la journée a changé. La page React est hors `ProtectedRoute`, brandée par les settings de l'org du contrat renvoyés par l'edge.

**Tech Stack:** React 18 + React Router 6 (route publique), Supabase edge Deno (`_shared/auth.ts`, `_shared/tournee/*`), PostgreSQL (RPC SECURITY DEFINER), `node --test`, harnais `scripts/migration-rehearsal/`, CLI `supabase functions deploy --use-api`.

**Spec:** `docs/superpowers/specs/2026-09-29-auto-rdv-entretien-mensuel-design.md` (§ 4.2, § 8, § 12 tranche 2). Tranche 1 livrée : `docs/superpowers/plans/2026-09-29-auto-rdv-tranche1-voir.md`.

## Global Constraints

- Moteur `src/lib/tournee/` : modules purs, imports relatifs `.js`, JSDoc sur toute signature exportée ; après modification : `npm run sync:tournee-engine` puis redéployer `slots-propose`, `tournees-figer` **et** `auto-rdv`.
- **Horizon = mois en cours, borne dure** (décision Eric § 2.6) : aucune journée hors `[aujourd'hui + delai_min_jours, dernier jour du mois]` n'est jamais proposée ni posée.
- **Demi-journée = `reglages.demi_journee`** (`matin: [8, 12]`, `apres_midi: [13, 18]`), pas midi en dur ; l'arrivée ET le départ du contrat tiennent dans la demi-journée.
- Une journée proposable = non figée, dans le mois, d'un technicien compétent « par la machine », et **porteuse d'un secteur** : étiquette `journees_secteur.grand_secteur` OU secteur déduit des entretiens déjà posés (`deduireSecteur`). Une journée vide sans étiquette n'est pas proposée (l'étiquetage machine des journées vides = tranche 3).
- RPC `auto_rdv_poser` : SECURITY DEFINER, `SET search_path = majordhome, public`, `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, `GRANT TO service_role`. L'org est dérivée du contrat, jamais du payload.
- Jeton : `rdv.<contract_id>.<exp>.<sig>`, HMAC-SHA256 avec `MDH_AUTO_RDV_SECRET` (posé en prod le 2026-09-29), comparaison timing-safe, `exp` = dernier jour du mois 23:59:59 Europe/Paris, ou du mois suivant s'il reste moins de 7 jours (lien copié par téléphone en fin de mois).
- Edge `auto-rdv` : `verify_jwt:false` (à inscrire dans `supabase/config.toml`), CORS via `buildCorsHeaders`, erreurs via `sanitizeError`, limite 60 requêtes / jeton / heure (Map en mémoire), toute écriture lit `{ error }`.
- La page ne montre jamais : autres clients, adresses, nom de famille du technicien, identifiants d'org. L'URL ne porte que le jeton.
- Écart assumé par rapport à la spec § 12 : `etiquetage.js` (choix des journées vides à étiqueter) glisse en tranche 3 avec le cron qui le consomme — aucun appelant en tranche 2.
- Pas de preview navigateur : preuve = tests Node, `deno check`, harnais de migration, `npx vite build`, `npm run lint:errors`, puis test de bout en bout par Eric depuis « Copier le lien ».

---

## Fichiers

| Action | Fichier | Responsabilité |
|---|---|---|
| Créer | `src/lib/tournee/auto-rdv.js` | offre : `bornesMois`, `demiJournees`, `journeesProposables`, `empreinteJournee`, `creneauxPourContrat`, `placerDansDemiJournee` |
| Créer | `scripts/tournee/auto-rdv.test.mjs` | tests du module |
| Modifier | `scripts/sync-tournee-engine.mjs:21` | ajoute `'auto-rdv'` à `NOMS` |
| Créer | `supabase/migrations/20260930_2_auto_rdv_poser.sql` | RPC `auto_rdv_poser` |
| Créer | `scripts/migration-rehearsal/assert-auto-rdv.sql` | assertions |
| Créer | `supabase/functions/auto-rdv/index.ts` | edge : sign / slots / book |
| Modifier | `supabase/config.toml` | `[functions.auto-rdv] verify_jwt = false` |
| Créer | `src/shared/services/autoRdv.service.js` | `signerLien({ orgId, contractId })` (edge action `sign`) |
| Créer | `src/pages/PriseRdv.jsx` | page publique `/rdv/:token` |
| Modifier | `src/App.jsx` | route publique |
| Modifier | `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` | bouton « Copier le lien » en `a_planifier` |
| Modifier | `docs/MODULE_TOURNEES.md` | section auto-RDV |

---

### Task 1 : module pur `auto-rdv.js`

**Files:**
- Create: `src/lib/tournee/auto-rdv.js`
- Test: `scripts/tournee/auto-rdv.test.mjs`
- Modify: `scripts/sync-tournee-engine.mjs:21`

**Interfaces (Produces):**
- `bornesMois(aujourdhui: 'YYYY-MM-DD', { delaiMinJours = 2 }) => { debut: 'YYYY-MM-DD', fin: 'YYYY-MM-DD' }` — `debut` = aujourd'hui + délai, `fin` = dernier jour du mois d'`aujourdhui`. Si `debut > fin` → `{ debut, fin: debut }` inversé ⇒ aucune journée (le mois est fini).
- `demiJournees(reglages) => [{ code: 'matin', debut, fin }, { code: 'apres_midi', debut, fin }]` en minutes depuis minuit, depuis `reglages.demi_journee`.
- `empreinteJournee(rdvs) => string` — `id@HH:MM` triés par id, joints par `,` ; RDV `cancelled`/`no_show` exclus. **Même formule que la RPC.**
- `journeesProposables({ journees, etiquettes, bornes }) => Array<{ journee, secteur, figee: false }>` — garde les journées `bornes.debut ≤ date ≤ bornes.fin`, non figées (`etiquette.figee_at`), avec secteur (étiquette sinon `deduireSecteur(rdvs)`).
- `placerDansDemiJournee({ arrets, candidat, demi, ctx }) => { faisable, raison, arriveeMinutes, departMinutes, coutMinutes }` — `placerCandidat` avec `fenetreArrivee = { min: demi.debut, max: demi.fin - candidat.dureeMinutes }`, puis refus `demi_journee` si `departMinutes > demi.fin`, refus `decalage` si `decalages.length > 0`.
- `creneauxPourContrat({ contrat, proposables, depot, reglages, trajet, secteurContrat = null, maxCreneaux = 6 }) => { creneaux, refus }` — pour chaque journée × demi : arrêts existants (`construireArretsExistants(rdvs, null, { souplesse: true, flexDefaut, amplitude, demiJournee })`), `ctx = { trajet, depotKey: cleCoord(depot), amplitude, budgetMinutes: budget + depassement, pause: { minutes, fenetre: [h*60…] }, trajetMaxMinutes }` ; créneau = `{ id: `${date}|${technicienId}|${demi}`, date, demi, technicienId, technicienNom, secteur, propre, debutMinutes, finMinutes, coutMinutes, empreinte }` ; tri : `propre` d'abord, puis date, puis demi (matin avant après-midi), puis coût ; tronqué à `maxCreneaux`. `refus` = compteur par raison.

- [ ] **Step 1 : tests** (`scripts/tournee/auto-rdv.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bornesMois, demiJournees, empreinteJournee, journeesProposables, placerDansDemiJournee, creneauxPourContrat,
} from '../../src/lib/tournee/auto-rdv.js';
import { REGLAGES_DEFAUT } from '../../src/lib/tournee/reglages.js';

const reglages = { ...REGLAGES_DEFAUT };
const trajet0 = () => 10; // 10 min entre tout point

test('bornesMois : délai minimal et dernier jour du mois, jamais le mois suivant', () => {
  assert.deepEqual(bornesMois('2026-10-01', { delaiMinJours: 2 }), { debut: '2026-10-03', fin: '2026-10-31' });
  assert.deepEqual(bornesMois('2026-02-27', { delaiMinJours: 2 }), { debut: '2026-03-01', fin: '2026-03-01' }); // mois fini → vide
  assert.deepEqual(bornesMois('2026-10-30', { delaiMinJours: 2 }), { debut: '2026-11-01', fin: '2026-11-01' });
});

test('demiJournees lit reglages.demi_journee', () => {
  assert.deepEqual(demiJournees(reglages), [
    { code: 'matin', debut: 8 * 60, fin: 12 * 60 },
    { code: 'apres_midi', debut: 13 * 60, fin: 18 * 60 },
  ]);
});

test('empreinteJournee : ids triés + heure, annulés exclus', () => {
  const rdvs = [
    { id: 'b', scheduled_start: '14:00:00', status: 'scheduled' },
    { id: 'a', scheduled_start: '09:30', status: 'scheduled' },
    { id: 'c', scheduled_start: '11:00', status: 'cancelled' },
  ];
  assert.equal(empreinteJournee(rdvs), 'a@09:30,b@14:00');
  assert.equal(empreinteJournee([]), '');
});

const journee = (date, rdvs = [], extra = {}) => ({
  date, technicienId: 't1', technicienNom: 'Lucas Martin', couleur: '#123',
  amplitude: { debut: 8 * 60, fin: 18 * 60 }, budgetMinutes: 480, rdvs, ...extra,
});
const rdv = (id, start, secteur = 'Castres', type = 'maintenance') => ({
  id, scheduled_start: start, duration_minutes: 60, appointment_type: type, status: 'scheduled',
  grand_secteur: secteur, lat: 43.6, lng: 2.24, time_flex_minutes: 30, hour_confirmed_at: null, announced_start: start,
});

test('journeesProposables : bornes du mois, figées exclues, secteur étiquette ou déduit', () => {
  const journees = [
    journee('2026-10-02', [rdv('a', '09:00')]),           // avant le délai
    journee('2026-10-05', [rdv('b', '09:00')]),           // déduite Castres
    journee('2026-10-06', []),                            // vide, étiquetée machine
    journee('2026-10-07', []),                            // vide, sans étiquette → non proposée
    journee('2026-10-08', [rdv('c', '09:00')]),           // figée
    journee('2026-11-02', [rdv('d', '09:00')]),           // mois suivant
  ];
  const etiquettes = [
    { date: '2026-10-06', team_member_id: 't1', grand_secteur: 'Gaillac', origine: 'machine', figee_at: null },
    { date: '2026-10-08', team_member_id: 't1', grand_secteur: null, origine: 'deduite', figee_at: '2026-10-01T05:20:00Z' },
  ];
  const out = journeesProposables({ journees, etiquettes, bornes: { debut: '2026-10-03', fin: '2026-10-31' } });
  assert.deepEqual(out.map((p) => [p.journee.date, p.secteur]), [['2026-10-05', 'Castres'], ['2026-10-06', 'Gaillac']]);
});

test('placerDansDemiJournee : arrivée et départ dans la demi-journée, sans décaler personne', () => {
  const ctx = { trajet: trajet0, depotKey: '43.9,2.1', amplitude: { debut: 480, fin: 1080 }, budgetMinutes: 510, pause: { minutes: 30, fenetre: [720, 840] }, trajetMaxMinutes: 45 };
  const candidat = { id: 'k', key: '43.6,2.24', dureeMinutes: 120 };
  const matin = { code: 'matin', debut: 480, fin: 720 };
  const r = placerDansDemiJournee({ arrets: [], candidat, demi: matin, ctx });
  assert.equal(r.faisable, true);
  assert.ok(r.arriveeMinutes >= 480 && r.departMinutes <= 720, `${r.arriveeMinutes}-${r.departMinutes}`);
  // 4 h de travail ne tiennent pas dans un matin de 4 h avec 10 min de trajet
  const trop = placerDansDemiJournee({ arrets: [], candidat: { ...candidat, dureeMinutes: 240 }, demi: matin, ctx });
  assert.equal(trop.faisable, false);
});

test('creneauxPourContrat : secteur propre d’abord, matin avant après-midi, tronqué', () => {
  const contrat = { id: 'c1', dureeMinutes: 60, lat: 43.6, lng: 2.24 };
  const proposables = [
    { journee: journee('2026-10-06', [rdv('a', '09:00', 'Gaillac')]), secteur: 'Gaillac', figee: false },
    { journee: journee('2026-10-05', [rdv('b', '09:00', 'Castres')]), secteur: 'Castres', figee: false },
  ];
  const { creneaux } = creneauxPourContrat({ contrat, proposables, depot: { lat: 43.9, lng: 2.1 }, reglages, trajet: trajet0, secteurContrat: 'Gaillac', maxCreneaux: 3 });
  assert.equal(creneaux.length, 3);
  assert.deepEqual(creneaux.slice(0, 2).map((c) => [c.date, c.demi, c.propre]), [['2026-10-06', 'matin', true], ['2026-10-06', 'apres_midi', true]]);
  assert.equal(creneaux[2].date, '2026-10-05');
  assert.ok(creneaux.every((c) => typeof c.empreinte === 'string' && c.id.includes('|')));
});
```

- [ ] **Step 2 : `node --test scripts/tournee/auto-rdv.test.mjs`** → FAIL (module absent).
- [ ] **Step 3 : implémenter** `src/lib/tournee/auto-rdv.js` (imports relatifs : `./etat.js` (`deduireSecteur`), `./arrets.js` (`construireArretsExistants`, `TYPES_ADAPTABLES` inutile), `./creneaux.js` (`placerCandidat`), `./geo.js` (`cleCoord`)). Signatures et règles ci-dessus ; `bornesMois` calcule en UTC sur des chaînes ISO (jamais `new Date()` sans argument).
- [ ] **Step 4 : `'auto-rdv'` dans `NOMS`, `npm run sync:tournee-engine`, `node --test "scripts/tournee/*.test.mjs"`** → PASS.
- [ ] **Step 5 : commit** `feat(tournees): module pur de l'offre auto-RDV (journées proposables du mois, demi-journées, placement borné, empreinte)`

---

### Task 2 : migration `20260930_2` — RPC `auto_rdv_poser`

**Files:**
- Create: `supabase/migrations/20260930_2_auto_rdv_poser.sql`
- Create: `scripts/migration-rehearsal/assert-auto-rdv.sql`

**Interfaces (Produces):** `public.auto_rdv_poser(p_contract_id uuid, p_team_member_id uuid, p_date date, p_demi text, p_start time, p_end time, p_duration int, p_empreinte text, p_grand_secteur text, p_source text) returns jsonb` → `{ appointment_id, intervention_id, carte_creee }`. Exceptions : `invalid_args`, `contrat_introuvable`, `contrat_inactif`, `client_sans_projet`, `technicien_invalide`, `hors_mois` (date hors `[current_date, fin du mois]`), `journee_figee`, `journee_modifiee`, `deja_planifie` (la carte porte déjà un RDV à venir non annulé).

- [ ] **Step 1 : écrire la migration**

```sql
-- 20260930_2 — Auto-RDV tranche 2 : pose atomique d'un entretien choisi par le client (spec § 4.2)
CREATE OR REPLACE FUNCTION public.auto_rdv_poser(
  p_contract_id uuid, p_team_member_id uuid, p_date date, p_demi text,
  p_start time, p_end time, p_duration int, p_empreinte text, p_grand_secteur text, p_source text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
DECLARE
  v_ct        record;   -- contrat
  v_cl        record;   -- client
  v_core      uuid;
  v_mdh       uuid;
  v_tm        record;
  v_empreinte text;
  v_card      uuid;
  v_created   boolean := false;
  v_appt      uuid;
  v_now       timestamptz := now();
  v_announced time;
BEGIN
  IF p_contract_id IS NULL OR p_team_member_id IS NULL OR p_date IS NULL OR p_demi NOT IN ('matin', 'apres_midi')
     OR p_start IS NULL OR p_end IS NULL OR p_duration IS NULL OR p_duration <= 0 THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;
  -- Horizon = mois en cours, borne dure (décision Eric 2026-09-29).
  IF p_date < current_date OR p_date > (date_trunc('month', current_date) + interval '1 month - 1 day')::date THEN
    RAISE EXCEPTION 'hors_mois';
  END IF;

  SELECT c.id, c.org_id, c.client_id, c.status INTO v_ct FROM majordhome.contracts c WHERE c.id = p_contract_id;
  IF v_ct.id IS NULL THEN RAISE EXCEPTION 'contrat_introuvable'; END IF;
  IF v_ct.status <> 'active' THEN RAISE EXCEPTION 'contrat_inactif'; END IF;
  v_core := v_ct.org_id;
  SELECT o.id INTO v_mdh FROM majordhome.organizations o WHERE o.core_org_id = v_core;
  IF v_mdh IS NULL THEN RAISE EXCEPTION 'org_majordhome_introuvable'; END IF;

  SELECT cl.id, cl.project_id, cl.first_name, cl.last_name, cl.display_name, cl.phone, cl.email, cl.address, cl.city, cl.postal_code
    INTO v_cl FROM majordhome.clients cl WHERE cl.id = v_ct.client_id AND cl.org_id = v_core;
  IF v_cl.id IS NULL THEN RAISE EXCEPTION 'contrat_introuvable'; END IF;
  IF v_cl.project_id IS NULL THEN RAISE EXCEPTION 'client_sans_projet'; END IF;

  SELECT tm.id INTO v_tm FROM majordhome.team_members tm
   WHERE tm.id = p_team_member_id AND tm.org_id = v_mdh AND tm.is_active AND tm.include_in_routing AND tm.role = 'technician';
  IF v_tm.id IS NULL THEN RAISE EXCEPTION 'technicien_invalide'; END IF;

  IF EXISTS (SELECT 1 FROM majordhome.journees_secteur js
             WHERE js.org_id = v_core AND js.team_member_id = p_team_member_id AND js.date = p_date AND js.figee_at IS NOT NULL) THEN
    RAISE EXCEPTION 'journee_figee';
  END IF;

  -- Empreinte : même formule que auto-rdv.js::empreinteJournee (ids triés + HH:MM, annulés exclus).
  SELECT coalesce(string_agg(a.id::text || '@' || to_char(a.scheduled_start, 'HH24:MI'), ',' ORDER BY a.id::text), '')
    INTO v_empreinte
    FROM majordhome.appointments a
    JOIN majordhome.appointment_technicians at ON at.appointment_id = a.id AND at.technician_id = p_team_member_id
   WHERE a.org_id = v_mdh AND a.scheduled_date = p_date AND a.status NOT IN ('cancelled', 'no_show');
  IF v_empreinte IS DISTINCT FROM coalesce(p_empreinte, '') THEN RAISE EXCEPTION 'journee_modifiee'; END IF;

  -- Carte d'entretien : réutiliser la carte racine non terminale du client (même règle que ensureEntretienCard).
  SELECT i.id INTO v_card FROM majordhome.interventions i
   WHERE i.client_id = v_cl.id AND i.intervention_type = 'entretien' AND i.parent_id IS NULL
     AND i.workflow_status NOT IN ('realise', 'facture')
   ORDER BY i.created_at DESC LIMIT 1;
  IF v_card IS NOT NULL AND EXISTS (
    SELECT 1 FROM majordhome.appointments a
     WHERE a.intervention_id = v_card AND a.scheduled_date >= current_date AND a.status NOT IN ('cancelled', 'no_show')
  ) THEN RAISE EXCEPTION 'deja_planifie'; END IF;
  IF v_card IS NULL THEN
    INSERT INTO majordhome.interventions (project_id, client_id, contract_id, intervention_type, workflow_status, scheduled_date, status, tags)
    VALUES (v_cl.project_id, v_cl.id, v_ct.id, 'entretien', 'planifie', p_date, 'scheduled', ARRAY['Contrat'])
    RETURNING id INTO v_card;
    v_created := true;
  ELSE
    UPDATE majordhome.interventions SET workflow_status = 'planifie', scheduled_date = p_date, contract_id = coalesce(contract_id, v_ct.id), updated_at = v_now
     WHERE id = v_card;
  END IF;

  -- RDV en souplesse demi-journée : l'ancre annoncée = début de la demi-journée (toleranceDe s'en sert pour matin/après-midi).
  v_announced := CASE WHEN p_demi = 'matin' THEN p_start ELSE p_start END; -- l'heure exacte est provisoire ; l'ancre suffit à choisir la demi-journée
  INSERT INTO majordhome.appointments (
    org_id, appointment_type, subject, scheduled_date, scheduled_start, scheduled_end, duration_minutes,
    intervention_id, client_id, client_name, client_first_name, client_phone, client_email, address, city, postal_code,
    status, priority, internal_notes, time_flex_minutes, hour_confirmed_at, announced_start, grand_secteur
  ) VALUES (
    v_mdh, 'maintenance', 'Entretien', p_date, p_start, p_end, p_duration,
    v_card, v_cl.id, coalesce(v_cl.last_name, v_cl.display_name), v_cl.first_name, v_cl.phone, v_cl.email, v_cl.address, v_cl.city, v_cl.postal_code,
    'scheduled', 'normal', coalesce(p_source, 'auto_rdv'), 240, NULL, v_announced, p_grand_secteur
  ) RETURNING id INTO v_appt;
  INSERT INTO majordhome.appointment_technicians (appointment_id, technician_id, role) VALUES (v_appt, p_team_member_id, 'lead');

  INSERT INTO majordhome.journees_secteur (org_id, date, team_member_id, grand_secteur, origine)
  VALUES (v_core, p_date, p_team_member_id, p_grand_secteur, 'deduite')
  ON CONFLICT (org_id, team_member_id, date) DO UPDATE
    SET grand_secteur = coalesce(majordhome.journees_secteur.grand_secteur, EXCLUDED.grand_secteur), updated_at = v_now;

  RETURN jsonb_build_object('appointment_id', v_appt, 'intervention_id', v_card, 'carte_creee', v_created);
END $$;
REVOKE EXECUTE ON FUNCTION public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text) TO service_role;
COMMENT ON FUNCTION public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text) IS
  'Auto-RDV : pose atomique d''un entretien choisi par le client (edge auto-rdv). service_role only ; refuse si la journée a changé (empreinte), est figée, hors mois, ou si la carte porte déjà un RDV à venir.';
```

  ⚠️ Vérifier sur le harnais les noms exacts des colonnes/enums d'`interventions` (`status`, `tags`, `intervention_type`) et d'`appointments` (`priority`, `internal_notes`) ; le snapshot photographie `interventions` (structure) et `appointments` (colonnes listées) — étendre `snapshot.mjs` si une colonne manque.
- [ ] **Step 2 : `assert-auto-rdv.sql`** : privilèges (`anon`/`authenticated` sans EXECUTE, `service_role` avec), `invalid_args` sur `p_demi = 'soir'`, `hors_mois` sur `current_date + interval '2 month'`, `contrat_introuvable` sur un uuid nul.
- [ ] **Step 3 : répéter** (`snapshot.mjs` déjà pris ce soir ; `run.mjs --migration … --assert assert-auto-rdv.sql --assert assert-baseline.sql`) → OK ; appliquer via `apply_migration` ; auditer `has_function_privilege`.
- [ ] **Step 4 : commit** `feat(tournees): RPC auto_rdv_poser — pose atomique d'un entretien choisi par le client (migration 20260930_2)`

---

### Task 3 : edge `auto-rdv`

**Files:**
- Create: `supabase/functions/auto-rdv/index.ts`
- Modify: `supabase/config.toml` (`[functions.auto-rdv] verify_jwt = false`)

**Interfaces (Produces):**
- `POST` body `{ action: 'sign', org_id, contract_id }` + JWT → `requireOrgMembership(req, { orgId })` ; contrat ∈ org sinon 404 ; `200 { url: `${APP_URL}/rdv/${token}`, expires_at }`. `APP_URL` = env `MDH_APP_URL` sinon `https://majordhome.vercel.app`.
- `GET ?token=` → `200 { org: { name, phone, logo_url, accent_color }, client: { prenom }, contrat: { categories: string[], duree_minutes }, mois: { debut, fin }, creneaux: [{ id, date, demi, technicien, debut: 'HH:MM', fin: 'HH:MM', secteur, propre, empreinte, technicien_id }], deja: { date, demi, technicien } | null, estime }`. Erreurs : 400 `invalid_token`, 410 `token_expired`, 404 `contrat_introuvable`, 422 `siege_non_configure` / `client_non_localise`, 429 `too_many_requests`.
- `POST` body `{ action: 'book', token, creneau: { date, technicien_id, demi, empreinte } }` → recalcul du placement sur cette journée seule ; `409 { error: 'creneau_indisponible', raison }` si plus faisable ou empreinte différente ; RPC `auto_rdv_poser` ; `409 { error: 'journee_modifiee' | 'deja_planifie' | 'journee_figee' }` ; `200 { appointment_id, date, demi, technicien }`.
- `deja` : si la carte d'entretien racine du client porte un RDV à venir non annulé, la page l'affiche au lieu des créneaux (même règle que la RPC).

- [ ] **Step 1 : écrire l'edge** — squelette :

```ts
import { requireOrgMembership, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { chargerJournees, chargerContrat } from "../_shared/tournee/loaders.js";
import { creerChargeurMatrice } from "../_shared/tournee/trajets-core.js";
import { construireMatrice, trajetLocal } from "../_shared/tournee/matrice.js";
import { construireReglages } from "../_shared/tournee/reglages.js";
import { cleCoord } from "../_shared/tournee/geo.js";
import { bornesMois, journeesProposables, creneauxPourContrat, empreinteJournee, demiJournees, placerDansDemiJournee } from "../_shared/tournee/auto-rdv.js";
import { construireArretsExistants, minutesVersHeure } from "../_shared/tournee/arrets.js";

const SECRET = Deno.env.get("MDH_AUTO_RDV_SECRET") || "";
const APP_URL = Deno.env.get("MDH_APP_URL") || "https://majordhome.vercel.app";
const TIME_ZONE = "Europe/Paris";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// jeton = rdv.<contract_id>.<exp>.<sig> — HMAC-SHA256(secret, "rdv.<id>.<exp>"), base64url
async function signer(contractId: string, exp: number): Promise<string> { /* crypto.subtle HMAC, base64url */ }
async function verifier(token: string): Promise<{ ok: true; contractId: string; exp: number } | { ok: false; status: number; error: string }> { /* format, uuid, exp, timing-safe */ }
function expirationLien(now: Date): number { /* fin du mois Europe/Paris 23:59:59 ; si < 7 jours → fin du mois suivant */ }
// limite : Map<token, { n, depuis }> — 60 / heure
```

  Chargement commun (`slots` et `book`) : contrat (`chargerContrat`, `lat/lng` requis sinon 422), org core = `majordhome_contracts.org_id`, mdh org, `settings` (`.schema("core")`), `reglages`, `depot` (`territoire_centers`), `bornes = bornesMois(aujourdhuiParis, { delaiMinJours: reglages.auto_rdv?.delai_min_jours ?? 2 })`, `chargerJournees({ joursApres: jours jusqu'à bornes.fin })`, `majordhome_journees_secteur` du mois (org core), `secteurContrat` = dernier `grand_secteur` des RDV du client (`majordhome_appointments` par `client_id`, `order scheduled_date desc limit 1`) sinon null, `deja` = RDV à venir de la carte racine non terminale du client. Matrice : pour chaque journée proposable, noyau = dépôt + arrêts du jour, candidat = contrat, `creerChargeurMatrice` par lots de 4 comme `slots-propose`, fusion `construireMatrice(paires, { repli: trajetLocal })`.
  `book` : ne recharge que la journée ciblée (`journees.find`), vérifie `empreinteJournee(rdvs) === creneau.empreinte`, `placerDansDemiJournee`, puis `admin.rpc("auto_rdv_poser", { p_contract_id, p_team_member_id, p_date, p_demi, p_start: minutesVersHeure(arrivee), p_end: minutesVersHeure(arrivee + duree), p_duration: duree, p_empreinte, p_grand_secteur: secteur, p_source: "auto_rdv:" + (via === "operator" ? "operateur" : "client") })`. Les exceptions de la RPC remontent en `error.message` : mapper `journee_modifiee|deja_planifie|journee_figee|hors_mois` → 409, le reste → 500 `sanitizeError`.
- [ ] **Step 2 : `deno check supabase/functions/auto-rdv/index.ts`** → OK ; `config.toml` : `[functions.auto-rdv]\nverify_jwt = false`.
- [ ] **Step 3 : déployer** `npx supabase functions deploy auto-rdv --project-ref ejqqqwudmizqisdkxohw --use-api` ; redéployer `slots-propose` et `tournees-figer` (copies `_shared/tournee` ont gagné `auto-rdv.js`, sans changement des modules qu'elles importent — redéploiement de principe, règle du projet).
- [ ] **Step 4 : sonde** : `GET …/functions/v1/auto-rdv?token=abc` → 400 `invalid_token` ; `GET` avec un jeton forgé (signature fausse) → 401 `signature_mismatch`.
- [ ] **Step 5 : commit** `feat(auto-rdv): edge publique — lien signé, créneaux en direct, pose par RPC atomique`

---

### Task 4 : service front + bouton « Copier le lien »

**Files:**
- Create: `src/shared/services/autoRdv.service.js`
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (actions en `a_planifier`)

**Interfaces:**
- `autoRdvService.signerLien({ orgId, contractId }) => { data: { url, expires_at } | null, error }` via `supabase.functions.invoke('auto-rdv', { body: { action: 'sign', org_id, contract_id } })`.
- Bouton (icône `Link2`, titre « Copier le lien de prise de rendez-vous ») visible si `isTeamLeaderOrAbove` et `item.effective_contract_id || item.contract_id` ; clic → `signerLien` → `navigator.clipboard.writeText(url)` → `toast.success('Lien copié — valable jusqu’au …')` ; erreur → `toast.error`.

- [ ] **Step 1 : service + bouton** (suivre le pattern des autres boutons de la carte : `e.stopPropagation()`, état `busy`).
- [ ] **Step 2 : `npm run lint:errors`** → 0.
- [ ] **Step 3 : commit** `feat(entretiens): « Copier le lien » de prise de RDV sur la carte À planifier`

---

### Task 5 : page publique `/rdv/:token`

**Files:**
- Create: `src/pages/PriseRdv.jsx`
- Modify: `src/App.jsx` (route `/rdv/:token`, hors `ProtectedRoute`, à côté de `/reset-password`)

**Interfaces (Consumes):** edge `auto-rdv` (`GET ?token=`, `POST { action: 'book', token, creneau }`) via `fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-rdv…`)` avec l'en-tête `apikey: VITE_SUPABASE_ANON_KEY` (la passerelle ne l'exige pas, on le met par convention), **sans** Authorization.

- [ ] **Step 1 : page** — états : `chargement` · `erreur` (`token_expired` → « Ce lien a expiré » + téléphone ; autre → message + téléphone) · `deja` (« Votre entretien est prévu le … ») · `choix` (créneaux groupés par date, 2 boutons matin / après-midi quand disponibles, prénom du technicien, secteur non affiché) · `confirmation` (modale « Confirmer mardi 14 octobre, après-midi, avec Lucas ? ») · `pose` (succès : date + demi-journée + « l’heure exacte vous sera envoyée par SMS ») · `conflit` (409 → message « cette demi-journée vient de se remplir » + rechargement automatique des créneaux). En-tête : logo/nom de l'org, couleur d'accent en bordure ; pied : téléphone. Mobile d'abord (`max-w-md mx-auto p-4`), Tailwind seulement, aucune dépendance à `useAuth`.
- [ ] **Step 2 : route** dans `App.jsx` : `<Route path="/rdv/:token" element={<PriseRdv />} />` (lazy comme les autres pages publiques si elles le sont).
- [ ] **Step 3 : `npm run lint:errors && npx vite build`** → OK.
- [ ] **Step 4 : commit** `feat(auto-rdv): page publique de prise de rendez-vous d'entretien (/rdv/:token)`

---

### Task 6 : documentation, audit, test de bout en bout

- [ ] **Step 1 : `docs/MODULE_TOURNEES.md`** — section « Auto-RDV : lien signé, créneaux en direct, pose atomique » (jeton, actions de l'edge, règles de l'offre, RPC et ses refus, page).
- [ ] **Step 2 : `npm run audit:quality`** → vert.
- [ ] **Step 3 : commit** `docs(tournees): auto-RDV tranche 2`.
- [ ] **Step 4 : demander à Eric UN test** : Kanban « À planifier » → « Copier le lien » sur un contrat de test → ouvrir le lien en navigation privée → choisir une demi-journée → vérifier le RDV dans le Planning (puce de la journée, souplesse demi-journée) et la carte en « Planifié ».

---

## Self-review

- **Spec § 4.2** : jeton signé ✔ (Task 3), créneaux à l'instant ✔ (Task 1 + 3), max 6 ✔, secteur du contrat d'abord ✔, tri date/coût ✔, RPC tout ou rien avec empreinte ✔ (Task 2), confirmation par mail ✗ (tranche 3, avec les gabarits), « appelez-nous » si aucun créneau ✔ (Task 5), `outcome = no_slot` ✗ (table des invitations = tranche 3). Bouton « Copier le lien » ✔ (Task 4).
- **Placeholders** : les corps `signer` / `verifier` / `expirationLien` sont décrits en commentaire dans Task 3 ; l'implémentation reprend `mailing-unsubscribe` (base64url, `crypto.subtle`, `safeEqual`).
- **Cohérence** : `empreinteJournee` (JS) ↔ `string_agg(id@HH24:MI order by id)` (SQL) ; `demi` ∈ `matin|apres_midi` partout ; `auto_rdv_poser` signature identique Task 2 ↔ Task 3.
- **Écarts** : `etiquetage.js` en tranche 3 ; `announced_start` = heure d'arrivée calculée (provisoire) — suffit à `toleranceDe` pour choisir la demi-journée puisque cette heure est dans la demi-journée choisie.
