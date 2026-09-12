# Planification d'entretien machine-usable — Plan d'implémentation (tranche 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis la fiche d'un contrat d'entretien, obtenir en un clic les 4 créneaux les moins coûteux (technicien compétent, trajets réels, RDV déjà posés), calculés côté serveur par un outil que Hermes/Vapi pourront appeler demain sans réécriture ; et garantir que toute adresse saisie est localisable (BAN).

**Architecture:** Le moteur Tournées pur (`src/lib/tournee`) gagne un module `proposerPourContrat` (question inverse de l'onglet Tournées) et deux modules **injectables** (`loaders.js`, `trajets-core.js`) qui portent le chargement des données et de la matrice Mapbox sans dépendre de Vite/React — les services frontend deviennent des wrappers, et l'edge function `slots-propose` importe des **copies synchronisées** de ces modules. Le CTA de `ContractModal` appelle l'edge et pose le RDV par le chemin existant (`ensureEntretienCard` + `scheduleEntretien`).

**Tech Stack:** React 18 / Vite, supabase-js, Supabase edge (Deno), PostgreSQL (migrations SQL), Mapbox Matrix API, BAN (`api-adresse.data.gouv.fr`), tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md`

**Écarts assumés par rapport à la spec (décidés à la lecture du code, 2026-09-12) :**
- Compétences : on **réutilise la colonne existante `majordhome.team_members.specialties text[]`** (vide, exposée par la vue) au lieu de créer `skills`. Pas de CHECK sur les valeurs : les chips de l'UI viennent des catégories réellement présentes dans `majordhome_pricing_equipment_types` de l'org.
- `address_precision` : colonne sur `clients` **seulement** ; écrite par une RPC `client_set_location` (pas d'extension de la vue `majordhome_clients`, dont la définition n'est pas versionnée dans le repo). Les leads reçoivent le composant BAN pour la qualité du texte ; leur géocodage reste `geocodeAndAssignLead` (zone + commercial), inchangé.
- Trigger `reset_geocode_on_address_change` : on **garde** sa condition (les coordonnées BAN sont écrites par un 2ᵉ UPDATE, pattern déjà en place) ; on lui ajoute seulement `NEW.address_precision := NULL`.
- SMS de confirmation après la pose : **hors tranche 1** (aucun gabarit ni onglet Settings SMS n'existe ; règle « pas de config sans UI »). Signalé en tâche de suite.

## Global Constraints

- Toute mutation Supabase filtre explicitement par `org_id` (défense en profondeur), même sous service_role.
- Toute RPC SECURITY DEFINER : `SET search_path` explicite, `REVOKE EXECUTE … FROM PUBLIC, anon` (PUBLIC obligatoire), garde d'autorisation **positive** (`IS DISTINCT FROM` / `IS NOT TRUE`), `auth.uid() IS NULL → refuser` en première instruction.
- Modules `src/lib/tournee/*` : **aucun import React/Supabase/alias** (`@…`), imports relatifs entre frères uniquement — ils doivent tourner sous Node, Vite et Deno.
- Edge `verify_jwt:true` → `requireOrgMembership(req, { orgId })` du helper `_shared/auth.ts` ; `supabase/config.toml` mis à jour.
- Toujours destructurer `{ error }` sur les mutations ; jamais `throw` vers le caller depuis un service (`{ data, error }`).
- `logger` (`@lib/logger`) dans le code app ; `console.*` interdit ; 0 nouveau warning ESLint (`npm run lint:errors` doit rester vert).
- Org : `coreOrgId` (core.organizations, ex. `3c68193e-…`) pour contracts/clients/travel_cache ; org **majordhome** (`getMajordhomeOrgId`) pour team_members/appointments.
- Pas de composant > 500 LOC : les nouveaux morceaux d'UI vont dans leur propre fichier.
- Commits par pathspec (sessions concurrentes sur `main`), message conventionnel, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/tournee/proposer-contrat.js` (créer) | Module pur : contrat → créneaux classés / nouvelles journées / motifs |
| `scripts/tournee/proposer-contrat.test.mjs` (créer) | Tests du module pur |
| `src/lib/tournee/loaders.js` (créer) | Chargement injectable (client supabase passé en paramètre) : journées de l'horizon, contrat à proposer |
| `scripts/tournee/loaders.test.mjs` (créer) | Tests avec faux client |
| `src/lib/tournee/trajets-core.js` (créer) | `creerChargeurMatrice({ client, coreOrgId, token, fetchImpl, logger })` — logique de `trajets.service.js` rendue injectable |
| `scripts/tournee/trajets-core.test.mjs` (créer) | Tests cache-first / Mapbox / repli |
| `src/shared/services/trajets.service.js` (modifier) | Devient un wrapper de `trajets-core.js` |
| `src/shared/services/tournees.service.js` (modifier) | `getJourneesHorizon` → wrapper de `loaders.js` ; ajoute `proposerPourContrat` (appel edge) |
| `scripts/sync-tournee-engine.mjs` + `scripts/tournee/sync-engine.test.mjs` (créer) | Copie `src/lib/tournee/*.js` + `sectorClustering.js` vers `supabase/functions/_shared/tournee/` ; test d'égalité |
| `supabase/functions/_shared/tournee/*.js` (générés) | Copies pour Deno |
| `supabase/functions/slots-propose/index.ts` (créer) + `supabase/config.toml` | L'outil serveur |
| `supabase/migrations/20260912_1_team_member_specialties_rpc.sql` (créer) | RPC routage étendue à `p_specialties` |
| `src/shared/services/appointments.service.js`, `src/shared/hooks/useAppointments.js` (modifier) | Paramètre `specialties` |
| `src/apps/artisan/pages/settings/team/SpecialtiesEditor.jsx` (créer), `TeamManagement.jsx` (modifier) | Chips de compétences |
| `supabase/migrations/20260912_2_clients_address_precision.sql` (créer) | Colonne + trigger + RPC `client_set_location` + sweep RPC avec précision |
| `src/shared/services/geocoding.service.js` (modifier) | `suggestAddresses`, `geocodeCommune`, `setClientLocation` |
| `src/apps/artisan/components/shared/BanAddressInput.jsx` (créer) | Autocomplétion BAN |
| `src/apps/artisan/components/clients/ClientModalTabs.jsx`, `ClientModal.jsx`, `src/apps/artisan/components/pipeline/LeadFormSections.jsx` (modifier) | Intégration |
| `supabase/functions/geocode-sweep/index.ts` (modifier) | Étage 2 commune + précision |
| `src/shared/hooks/cacheKeys.js`, `src/shared/hooks/useTournees.js` (modifier) | `tourneeKeys.creneauxContrat`, `useCreneauxProposes` |
| `src/apps/artisan/components/entretiens/CreneauxProposesPanel.jsx` (créer), `ContractModal.jsx` (modifier) | CTA + panneau |

---

### Task 1 : `proposerPourContrat` — module pur

**Files:**
- Create: `src/lib/tournee/proposer-contrat.js`
- Modify: `src/lib/tournee/creneaux.js` (`placerCandidat` gagne un paramètre optionnel `fenetreArrivee`)
- Test: `scripts/tournee/proposer-contrat.test.mjs`, `scripts/tournee/creneaux.test.mjs` (2 cas ajoutés)

**Interfaces:**
- Consumes: `placerCandidat`, `chargeExistante` (`./creneaux.js`), `construireArretsExistants` (`./arrets.js`), `cleCoord` (`./geo.js`).
- Modifie: `placerCandidat({ …, fenetreArrivee?: { min?: number, max?: number } })` — borne l'heure d'ARRIVÉE (minutes depuis minuit) ; absent = comportement actuel, bit à bit.
- Produces: `proposerPourContrat({ contrat, journees, techniciens, depot, reglages, contraintes, trajet, aujourdhui, maxResults }) → { creneaux, nouvellesJournees, raisonsRejet, techniciensEligibles }` et `techniciensEligibles(contrat, techniciens)`.

- [ ] **Step 1 : écrire les tests (ils échouent : module absent)**

```js
// scripts/tournee/proposer-contrat.test.mjs
// Question inverse de l'onglet Tournées : pour CE contrat, quelles journées ?
// Run : node --test scripts/tournee/proposer-contrat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposerPourContrat, techniciensEligibles } from '../../src/lib/tournee/proposer-contrat.js';

const DEPOT = { lat: 43.900, lng: 1.900 };            // clé "43.900,1.900"
const REGLAGES = {
  horizon_ferme_jours: 15, horizon_ouverture_jours: 45,
  pause_minutes: 30, pause_fenetre: [12, 14],
};
const AUJOURDHUI = '2026-09-14'; // lundi
const ANTOINE = { id: 'antoine', nom: 'Antoine', specialties: ['climatisation', 'poele'] };
const LUDOVIC = { id: 'ludovic', nom: 'Ludovic', specialties: ['poele'] };
const POLYVALENT = { id: 'poly', nom: 'Poly', specialties: [] };

/** Journée d'un technicien : rdvs = [{id, lat, lng, duration_minutes, scheduled_start, client_name, city}] */
const journee = (date, technicienId, rdvs = []) => ({
  date, technicienId, technicienNom: technicienId, couleur: null,
  amplitude: { debut: 480, fin: 1080 }, budgetMinutes: 480,
  rdvs, chargeMinutes: rdvs.reduce((s, r) => s + r.duration_minutes, 0),
  estAmorcee: rdvs.length > 0,
});
const rdv = (id, heure, lat, lng, duree = 90) => ({
  id, lat, lng, duration_minutes: duree, scheduled_start: heure, client_name: id.toUpperCase(), city: 'GAILLAC', appointment_type: 'maintenance',
});
/** Trajet : 10 min entre points distincts, sauf paires listées. */
const trajetAvec = (special = {}) => (a, b) => (a === b ? 0 : (special[`${a}|${b}`] ?? 10));

const CONTRAT = { id: 'c1', dureeMinutes: 60, lat: 43.600, lng: 2.240, categories: ['climatisation'] }; // Castres

test('compétence : seul un technicien couvrant toutes les catégories est éligible ; vide = polyvalent', () => {
  assert.deepEqual(techniciensEligibles(CONTRAT, [ANTOINE, LUDOVIC, POLYVALENT]).map((t) => t.id), ['antoine', 'poly']);
  const multi = { ...CONTRAT, categories: ['climatisation', 'chaudiere_gaz'] };
  assert.deepEqual(techniciensEligibles(multi, [ANTOINE, LUDOVIC, POLYVALENT]).map((t) => t.id), ['poly']);
});

test('classement par coût : la journée où la tournée passe déjà à côté gagne, pas la plus proche dans le temps', () => {
  const journees = [
    journee('2026-09-15', 'antoine', [rdv('a', '08:00', 43.900, 1.900)]),            // loin de Castres (trajets 10 min forfait mais pas voisin)
    journee('2026-09-17', 'antoine', [rdv('b', '08:00', 43.600, 2.240)]),            // même clé que le contrat → trajet 0
  ];
  const { creneaux } = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.equal(creneaux[0].date, '2026-09-17');
  assert.ok(creneaux[0].coutMinutes < creneaux[1].coutMinutes);
  assert.equal(creneaux[0].technicianId, 'antoine');
  assert.equal(creneaux[0].avant.id, 'b');            // inséré après B
  assert.equal(creneaux[0].apres, null);              // puis retour dépôt
});

test('au-delà de l horizon ferme, seules les journées amorcées sont proposées ; les vides deviennent des nouvellesJournees si rien ne rentre', () => {
  const journees = [
    journee('2026-10-12', 'antoine', []),                                        // vide, hors horizon ferme
    journee('2026-10-13', 'antoine', [rdv('x', '08:00', 43.600, 2.240, 600)]),  // amorcée mais pleine (budget)
  ];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.equal(r.creneaux.length, 0);
  assert.deepEqual(r.nouvellesJournees, [{ date: '2026-10-12', technicianId: 'antoine' }]);
  assert.equal(r.raisonsRejet.horizon, 1);
  assert.ok(r.raisonsRejet.budget >= 1);
});

test('contrainte periode=matin : arrivée avant 12 h, sinon la journée est écartée', () => {
  const journees = [journee('2026-09-16', 'antoine', [rdv('m', '08:00', 43.600, 2.240, 230)])]; // libre à partir de 11:50
  const matin = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, contraintes: { periode: 'matin' },
  });
  assert.equal(matin.creneaux.length, 1);
  assert.ok(matin.creneaux[0].debutMinutes < 720);
  const apresMidi = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, contraintes: { periode: 'apres_midi' },
  });
  assert.ok(apresMidi.creneaux[0].debutMinutes >= 720);
});

test('contraintes technicianId / joursSemaineExclus / datesExclues / dateFrom-dateTo', () => {
  const journees = [
    journee('2026-09-16', 'antoine', []), // mercredi
    journee('2026-09-17', 'antoine', []), // jeudi
    journee('2026-09-17', 'poly', []),
  ];
  const base = { contrat: CONTRAT, journees, techniciens: [ANTOINE, POLYVALENT], depot: DEPOT, reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI };
  const sansMercredi = proposerPourContrat({ ...base, contraintes: { joursSemaineExclus: [3] } });
  assert.ok(sansMercredi.creneaux.every((c) => c.date !== '2026-09-16'));
  const seulementPoly = proposerPourContrat({ ...base, contraintes: { technicianId: 'poly' } });
  assert.ok(seulementPoly.creneaux.every((c) => c.technicianId === 'poly'));
  const fenetre = proposerPourContrat({ ...base, contraintes: { dateFrom: '2026-09-17', dateTo: '2026-09-17', datesExclues: [] } });
  assert.ok(fenetre.creneaux.every((c) => c.date === '2026-09-17'));
  assert.equal(proposerPourContrat({ ...base, contraintes: { datesExclues: ['2026-09-16', '2026-09-17'] } }).creneaux.length, 0);
});

test('maxResults borne la liste ; estime est propagé tel quel', () => {
  const journees = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21'].map((d) => journee(d, 'antoine', []));
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, maxResults: 4, estime: true,
  });
  assert.equal(r.creneaux.length, 4);
  assert.ok(r.creneaux.every((c) => c.estime === true));
});

test('contrat sans coordonnées → aucun créneau, motif position, jamais une exception', () => {
  const r = proposerPourContrat({
    contrat: { ...CONTRAT, lat: null, lng: null }, journees: [journee('2026-09-15', 'antoine', [])],
    techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.equal(r.creneaux.length, 0);
  assert.equal(r.raisonsRejet.position, 1);
});
```

- [ ] **Step 2 : lancer — doit échouer (`Cannot find module`)**

Run: `node --test scripts/tournee/proposer-contrat.test.mjs`

- [ ] **Step 3 : implémenter**

```js
// src/lib/tournee/proposer-contrat.js
// ============================================================================
// Question INVERSE de l'onglet Tournées : pour CE contrat, quelles journées ?
// Module PUR (Node, Vite, Deno). Testé : node --test scripts/tournee/proposer-contrat.test.mjs
//
// L'onglet répond « pour cette journée, quels contrats ? » (proposerPourJournee).
// Ici on itère sur jours × techniciens éligibles et on demande au même moteur
// (placerCandidat) où le contrat se glisse, puis on classe par minutes ajoutées.
// Rien n'est recalculé ailleurs : le créneau porte de quoi s'expliquer
// (avant/après, trajets) — l'écran et l'agent l'affichent, personne ne refait
// le calcul.
// ============================================================================
import { placerCandidat, chargeExistante } from './creneaux.js';
import { construireArretsExistants } from './arrets.js';
import { cleCoord } from './geo.js';

const MIDI = 12 * 60;

/**
 * Techniciens éligibles pour un contrat : compétence = toutes les catégories
 * d'équipement du contrat ⊆ `specialties`. Liste vide = polyvalent (choix
 * assumé : rien ne casse au déploiement, la restriction se pose dans Settings).
 */
export function techniciensEligibles(contrat, techniciens) {
  const categories = (contrat?.categories || []).filter(Boolean);
  return (techniciens || []).filter((t) => {
    const sp = t.specialties || [];
    if (sp.length === 0) return true;
    return categories.every((c) => sp.includes(c));
  });
}

const joursEntre = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const jourSemaine = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function journeeRetenue(j, { aujourdhui, reglages, contraintes, raisons }) {
  const ecart = joursEntre(aujourdhui, j.date);
  if (ecart < 0) return false;
  if (contraintes.dateFrom && j.date < contraintes.dateFrom) { raisons.contrainte += 1; return false; }
  if (contraintes.dateTo && j.date > contraintes.dateTo) { raisons.contrainte += 1; return false; }
  if ((contraintes.datesExclues || []).includes(j.date)) { raisons.contrainte += 1; return false; }
  if ((contraintes.joursSemaineExclus || []).includes(jourSemaine(j.date))) { raisons.contrainte += 1; return false; }
  // Au-delà de l'horizon ferme, on n'ouvre pas de journée vide (même règle que
  // l'onglet) : une journée non amorcée y est une « nouvelle journée », pas un créneau.
  if (ecart > reglages.horizon_ferme_jours && !j.estAmorcee) { raisons.horizon += 1; return false; }
  return true;
}

/** Contrainte de période → fenêtre d'ARRIVÉE (l'heure annoncée au client), pas une amplitude tronquée. */
function fenetreArriveePour(contraintes) {
  if (contraintes.periode === 'matin') return { max: MIDI - 1 };
  if (contraintes.periode === 'apres_midi') return { min: MIDI };
  return undefined;
}

/**
 * @param {object} p
 * @param {{ id, dureeMinutes: number, lat, lng, categories: string[] }} p.contrat
 * @param {Array} p.journees   cf. loaders.js::chargerJournees (une par technicien × date)
 * @param {Array<{ id, nom, specialties: string[] }>} p.techniciens
 * @param {{ lat, lng }} p.depot
 * @param {object} p.reglages  construireReglages(settings) — horizon_ferme_jours, horizon_ouverture_jours, pause_*
 * @param {{ technicianId?, dateFrom?, dateTo?, periode?: 'matin'|'apres_midi', joursSemaineExclus?: number[], datesExclues?: string[] }} [p.contraintes]
 * @param {(a: string, b: string) => number} p.trajet
 * @param {string} p.aujourdhui  YYYY-MM-DD
 * @param {number} [p.maxResults=4]
 * @param {boolean} [p.estime=false]  au moins un trajet est estimé (vol d'oiseau)
 */
export function proposerPourContrat({
  contrat, journees, techniciens, depot, reglages, contraintes = {}, trajet, aujourdhui, maxResults = 4, estime = false,
}) {
  const raisons = { competence: 0, horizon: 0, contrainte: 0, creneau: 0, budget: 0, pause: 0, position: 0 };
  const eligibles = techniciensEligibles(contrat, techniciens)
    .filter((t) => !contraintes.technicianId || t.id === contraintes.technicianId);
  raisons.competence = (techniciens || []).length - techniciensEligibles(contrat, techniciens).length;
  const eligibleIds = new Set(eligibles.map((t) => t.id));

  const candidat = { id: contrat.id, key: cleCoord(contrat), dureeMinutes: contrat.dureeMinutes || 0 };
  const depotKey = cleCoord(depot);
  const pause = { minutes: reglages.pause_minutes, fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60] };

  const creneaux = [];
  const vides = [];
  for (const j of journees || []) {
    if (!eligibleIds.has(j.technicienId)) continue;
    const ecart = joursEntre(aujourdhui, j.date);
    if (ecart > reglages.horizon_ferme_jours && !j.estAmorcee && ecart <= (reglages.horizon_ouverture_jours ?? 45)
        && (j.rdvs || []).length === 0) {
      vides.push({ date: j.date, technicianId: j.technicienId });
    }
    if (!journeeRetenue(j, { aujourdhui, reglages, contraintes, raisons })) continue;

    const arrets = construireArretsExistants(j.rdvs, depot);
    const chargeDeja = chargeExistante(arrets, { trajet, depotKey });
    const place = placerCandidat({
      arrets, candidat, trajet, depotKey,
      amplitude: j.amplitude, fenetreArrivee: fenetreArriveePour(contraintes),
      budgetMinutes: j.budgetMinutes, pause, chargeDeja,
    });
    if (!place.faisable) { raisons[place.raison] = (raisons[place.raison] || 0) + 1; continue; }

    const parId = new Map((j.rdvs || []).map((r) => [r.id, r]));
    const voisin = (id, champ) => {
      if (!id) return null;
      const r = parId.get(id);
      const debut = r?.scheduled_start ? Number(r.scheduled_start.slice(0, 2)) * 60 + Number(r.scheduled_start.slice(3, 5)) : null;
      return {
        id, label: r?.client_name || id, ville: r?.city || null,
        [champ]: debut == null ? null : (champ === 'finMinutes' ? debut + (r.duration_minutes || 0) : debut),
      };
    };
    creneaux.push({
      date: j.date,
      technicianId: j.technicienId,
      technicianNom: j.technicienNom,
      couleur: j.couleur ?? null,
      debutMinutes: place.arriveeMinutes,
      finMinutes: place.departMinutes,
      coutMinutes: place.coutMinutes,
      detourMinutes: place.detourMinutes,
      attenteMinutes: place.attenteMinutes,
      avant: voisin(place.avantId, 'finMinutes'),
      apres: voisin(place.apresId, 'debutMinutes'),
      estime,
    });
  }

  creneaux.sort((a, b) => a.coutMinutes - b.coutMinutes || a.date.localeCompare(b.date) || a.debutMinutes - b.debutMinutes);
  const retenus = creneaux.slice(0, maxResults);
  const nouvellesJournees = retenus.length === 0
    ? vides.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3)
    : [];
  return { creneaux: retenus, nouvellesJournees, raisonsRejet: raisons, techniciensEligibles: [...eligibleIds] };
}
```

⚠️ Avant de figer : relire `placerCandidat` (creneaux.js) — `avantId`/`apresId` sont les ids des arrêts voisins, `arriveeMinutes`/`departMinutes` les heures. Si le test 2 échoue sur `avant.id`, c'est ce mapping qu'il faut corriger, pas le test.

- [ ] **Step 3b : `placerCandidat` — fenêtre d'arrivée optionnelle (creneaux.js)**

Dans `placerCandidat`, ajouter `fenetreArrivee` à la signature destructurée, puis, juste après la construction de `arrivees` (bloc « Trois arrivées essayées ») :

```js
    // Fenêtre d'arrivée (contrainte « plutôt le matin / l'après-midi ») : on
    // essaie aussi le bord de la fenêtre, et on ne retient que les arrivées
    // qui y tiennent. Sans fenêtre : strictement le comportement d'avant.
    if (fenetreArrivee?.min != null) arrivees.push(Math.max(auPlusTot, fenetreArrivee.min));
    const dansFenetre = (a) => (fenetreArrivee?.min == null || a >= fenetreArrivee.min)
      && (fenetreArrivee?.max == null || a <= fenetreArrivee.max);
    // Jamais arriver avant d'être parti, et pas deux fois la même position.
    const departsPossibles = [...new Set(arrivees.filter((a) => a >= auPlusTot && dansFenetre(a)))];
    if (departsPossibles.length === 0) noterRaison('creneau');
```
(remplace la ligne `const departsPossibles = [...new Set(arrivees.filter((a) => a >= auPlusTot))];`). Mettre à jour le JSDoc (`@param {{min?: number, max?: number}} [params.fenetreArrivee]`).

Deux tests à ajouter dans `scripts/tournee/creneaux.test.mjs` (mêmes helpers que le fichier) :

```js
test('fenetreArrivee.max : le candidat n est placé que si son arrivée tient avant la borne', () => {
  const arrets = [arret('a', 480, 230)]; // libre à 11:50
  const ok = placerCandidat({ arrets, candidat: { id: 'c', key: 'c', dureeMinutes: 60 }, trajet: uniforme(0), depotKey: DEPOT, amplitude: AMPLITUDE, budgetMinutes: 480, fenetreArrivee: { max: 719 } });
  assert.equal(ok.faisable, true); assert.ok(ok.arriveeMinutes <= 719);
  const ko = placerCandidat({ arrets: [arret('a', 480, 300)], candidat: { id: 'c', key: 'c', dureeMinutes: 60 }, trajet: uniforme(0), depotKey: DEPOT, amplitude: AMPLITUDE, budgetMinutes: 480, fenetreArrivee: { max: 719 } });
  assert.equal(ko.faisable, false); assert.equal(ko.raison, 'creneau');
});
test('fenetreArrivee.min : arrivée repoussée à la borne, même si le trou commence avant', () => {
  const r = placerCandidat({ arrets: [arret('a', 480, 230)], candidat: { id: 'c', key: 'c', dureeMinutes: 60 }, trajet: uniforme(0), depotKey: DEPOT, amplitude: AMPLITUDE, budgetMinutes: 480, fenetreArrivee: { min: 720 } });
  assert.equal(r.faisable, true); assert.ok(r.arriveeMinutes >= 720);
});
```

- [ ] **Step 4 : lancer les tests — tout vert (y compris ceux du moteur existant)**

Run: `node --test scripts/tournee/proposer-contrat.test.mjs && node --test "scripts/tournee/*.test.mjs"`

- [ ] **Step 5 : lint + commit**

```bash
npx eslint src/lib/tournee/proposer-contrat.js src/lib/tournee/creneaux.js scripts/tournee/proposer-contrat.test.mjs scripts/tournee/creneaux.test.mjs
git add src/lib/tournee/proposer-contrat.js src/lib/tournee/creneaux.js scripts/tournee/proposer-contrat.test.mjs scripts/tournee/creneaux.test.mjs
git commit -m "feat(tournees): proposerPourContrat — la question inverse de l'onglet Tournées (module pur)"
```

---

### Task 2 : `trajets-core.js` — matrice Mapbox injectable

**Files:**
- Create: `src/lib/tournee/trajets-core.js`
- Modify: `src/shared/services/trajets.service.js` (devient un wrapper)
- Test: `scripts/tournee/trajets-core.test.mjs`

**Interfaces:**
- Produces: `creerChargeurMatrice({ client, coreOrgId, token, fetchImpl = fetch, logger = console })` → `async ({ noyau, candidats }) => { data: Map, estime: boolean, error: null }` — **même contrat de sortie** que `trajetsService.chargerMatrice`.
- `trajetsService.chargerMatrice({ coreOrgId, noyau, candidats })` conserve sa signature (appelé par `tournees.service.js` et `useJourneePose`).

- [ ] **Step 1 : test avec faux client + faux fetch**

```js
// scripts/tournee/trajets-core.test.mjs
// Run : node --test scripts/tournee/trajets-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerChargeurMatrice } from '../../src/lib/tournee/trajets-core.js';

/** Faux client supabase : `from('majordhome_travel_cache')` → select chaîné + upsert enregistrant. */
function fauxClient(lignesCache = []) {
  const upserts = [];
  const client = {
    upserts,
    from(table) {
      assert.equal(table, 'majordhome_travel_cache');
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; },
        then(resolve) { resolve({ data: lignesCache, error: null }); },
        upsert(rows) { upserts.push(...rows); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  };
  return client;
}
const A = { lat: 43.9, lng: 1.9 };   // "43.900,1.900"
const B = { lat: 43.6, lng: 2.24 };  // "43.600,2.240"
const silencieux = { error() {}, warn() {} };

test('cache chaud : aucun appel réseau, paires servies depuis le cache', async () => {
  let appels = 0;
  const charger = creerChargeurMatrice({
    client: fauxClient([
      { from_key: '43.900,1.900', to_key: '43.600,2.240', minutes: 35 },
      { from_key: '43.600,2.240', to_key: '43.900,1.900', minutes: 33 },
    ]),
    coreOrgId: 'org', token: 'tok', fetchImpl: async () => { appels += 1; throw new Error('non attendu'); }, logger: silencieux,
  });
  const { data, estime } = await charger({ noyau: [A], candidats: [B] });
  assert.equal(appels, 0);
  assert.equal(estime, false);
  assert.equal(data.get('43.900,1.900|43.600,2.240'), 35);
});

test('cache froid : Mapbox appelé, paires écrites dans le cache', async () => {
  const client = fauxClient([]);
  const charger = creerChargeurMatrice({
    client, coreOrgId: 'org', token: 'tok', logger: silencieux,
    fetchImpl: async () => ({ ok: true, json: async () => ({ durations: [[0, 2100], [1980, 0]] }) }),
  });
  const { data, estime } = await charger({ noyau: [A], candidats: [B] });
  assert.equal(estime, false);
  assert.equal(data.get('43.900,1.900|43.600,2.240'), 35);
  assert.ok(client.upserts.some((r) => r.from_key === '43.900,1.900' && r.to_key === '43.600,2.240' && r.minutes === 35 && r.org_id === 'org'));
});

test('Mapbox KO ou token absent : repli vol d oiseau, estime=true, jamais une exception', async () => {
  const charger = creerChargeurMatrice({
    client: fauxClient([]), coreOrgId: 'org', token: '', fetchImpl: async () => { throw new Error('boom'); }, logger: silencieux,
  });
  const { data, estime, error } = await charger({ noyau: [A], candidats: [B] });
  assert.equal(error, null);
  assert.equal(estime, true);
  assert.ok(data.get('43.900,1.900|43.600,2.240') > 0);
});
```

- [ ] **Step 2 : lancer — échec (module absent)**

Run: `node --test scripts/tournee/trajets-core.test.mjs`

- [ ] **Step 3 : créer `trajets-core.js` en DÉPLAÇANT le code de `trajets.service.js`**

Copier intégralement `fetchMatrixLot` et le corps de `chargerMatrice` (étapes 1 à 5, y compris le bloc de commentaires) depuis `src/shared/services/trajets.service.js` dans `src/lib/tournee/trajets-core.js`, avec ces substitutions et rien d'autre :
- `supabase` → `client` (paramètre de fabrique) ; `MAPBOX_CONFIG.accessToken` → `token` ; `fetch(` → `fetchImpl(` ; `logger.` → `log.` (paramètre, défaut `console`) ;
- imports : `import { cleCoord, haversineKm } from './geo.js'; import { estimerParVolDOiseau } from './matrice.js';` (plus aucun alias `@…`) ;
- `MAX_COORDS_MAPBOX` conservé (valeur actuelle du service) ;
- signature exportée :

```js
/**
 * Fabrique un chargeur de matrice : même algorithme que trajets.service.js
 * (cache travel_cache d'abord, Mapbox Matrix ensuite, vol d'oiseau en repli),
 * mais SANS dépendre du client Vite ni de MAPBOX_CONFIG — pour tourner à
 * l'identique dans le navigateur (trajets.service.js) et dans l'edge
 * slots-propose (Deno). Une seule implémentation du calcul de trajets.
 */
export function creerChargeurMatrice({ client, coreOrgId, token, fetchImpl = globalThis.fetch, logger: log = console }) {
  async function fetchMatrixLot({ sourcesKeys, destinationsKeys, paires }) { /* … code déplacé … */ }
  return async function chargerMatrice({ noyau, candidats }) { /* … code déplacé, retourne { data: paires, estime, error: null } … */ };
}
```

Puis réduire `src/shared/services/trajets.service.js` à :

```js
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';
import { MAPBOX_CONFIG } from '@lib/mapbox';
import { creerChargeurMatrice } from '@/lib/tournee/trajets-core.js';

// Bloc de commentaires d'origine conservé (asymétrie d'org, noyau/candidats).
export const trajetsService = {
  chargerMatrice({ coreOrgId, noyau, candidats }) {
    const charger = creerChargeurMatrice({ client: supabase, coreOrgId, token: MAPBOX_CONFIG.accessToken, logger });
    return charger({ noyau, candidats });
  },
};
```

- [ ] **Step 4 : tests verts + les tests existants du moteur toujours verts**

Run: `node --test scripts/tournee/trajets-core.test.mjs && node --test "scripts/tournee/*.test.mjs"`

- [ ] **Step 5 : build + lint + commit**

```bash
npx vite build 2>&1 | tail -3
npm run lint:errors
git add src/lib/tournee/trajets-core.js src/shared/services/trajets.service.js scripts/tournee/trajets-core.test.mjs
git commit -m "refactor(tournees): matrice de trajets injectable (trajets-core.js), le service devient un wrapper"
```

---

### Task 3 : `loaders.js` — journées et contrat, injectables

**Files:**
- Create: `src/lib/tournee/loaders.js`
- Modify: `src/shared/services/tournees.service.js` (`getJourneesHorizon` → wrapper)
- Test: `scripts/tournee/loaders.test.mjs`

**Interfaces:**
- Produces:
  - `chargerJournees({ client, coreOrgId, mdhOrgId, joursApres = 45, maintenant = new Date(), logger })` → `{ data: Journee[], error }` — **même sortie** que `getJourneesHorizon` aujourd'hui, plus `specialties` sur chaque journée (`j.specialties`) et un tableau `techniciens` : retourne `{ data, techniciens: [{ id, nom, specialties, couleur }], error }`.
  - `chargerContrat({ client, coreOrgId, contractId })` → `{ data: { id, clientId, clientName, ville, lat, lng, dureeMinutes, categories: string[], typesNonRenseignes }, error }` (durée via `dureeContrat` + `construireFallbacks` sur le parc de l'org, exactement comme `getContratsDus`).

- [ ] **Step 1 : test avec faux client**

```js
// scripts/tournee/loaders.test.mjs
// Run : node --test scripts/tournee/loaders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerJournees, chargerContrat } from '../../src/lib/tournee/loaders.js';

/** Faux client : chaque table renvoie ses lignes quel que soit le filtre. */
function fauxClient(tables) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; },
        not() { return q; }, order() { return q; }, maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return q;
    },
  };
}
const LUNDI = new Date('2026-09-14T08:00:00Z');

test('chargerJournees : une journée par technicien × jour ouvré, RDV coordonnés via le client, specialties portées', async () => {
  const client = fauxClient({
    majordhome_team_members: [{ id: 't1', display_name: 'Antoine', calendar_color: '#f00', daily_work_minutes: 480, include_in_routing: true,
      specialties: ['climatisation'], default_availability: { monday: { active: true, start: '08:00', end: '18:00' }, tuesday: { active: false } } }],
    majordhome_appointments: [{ id: 'r1', client_id: 'c1', lead_id: null, scheduled_date: '2026-09-14', scheduled_start: '08:00', duration_minutes: 90, appointment_type: 'maintenance', client_name: 'DUPONT', address: null, city: 'GAILLAC', postal_code: '81600', status: 'confirmed' }],
    majordhome_clients: [{ id: 'c1', latitude: 43.9, longitude: 1.9 }],
    majordhome_leads: [],
    majordhome_appointment_technicians: [{ appointment_id: 'r1', technician_id: 't1' }],
  });
  const { data, techniciens, error } = await chargerJournees({ client, coreOrgId: 'core', mdhOrgId: 'mdh', joursApres: 1, maintenant: LUNDI });
  assert.equal(error, null);
  assert.equal(data.length, 1);                       // lundi oui, mardi inactif
  assert.equal(data[0].technicienId, 't1');
  assert.equal(data[0].rdvs[0].lat, 43.9);
  assert.equal(data[0].estAmorcee, true);
  assert.deepEqual(techniciens, [{ id: 't1', nom: 'Antoine', specialties: ['climatisation'], couleur: '#f00' }]);
});

test('chargerContrat : durée barémée + catégories + coordonnées du client', async () => {
  const client = fauxClient({
    majordhome_contracts: [{ id: 'k1', client_id: 'c1', client_name: 'DUPONT', client_city: 'CASTRES', client_postal_code: '81100', start_date: '2025-06-01' }],
    majordhome_pricing_equipment_types: [{ id: 'ty1', code: 'CLIM', category: 'climatisation', duration_base_minutes: 60, duration_per_extra_unit_minutes: 20, included_units: 1, unfavorable_months: [] }],
    majordhome_clients: [{ id: 'c1', latitude: 43.6, longitude: 2.24 }],
    majordhome_contract_equipments: [{ contract_id: 'k1', equipment_id: 'e1' }],
    majordhome_equipments: [{ id: 'e1', category: 'climatisation', unit_count: 2, equipment_type_id: 'ty1' }],
  });
  const { data, error } = await chargerContrat({ client, coreOrgId: 'core', contractId: 'k1' });
  assert.equal(error, null);
  assert.equal(data.dureeMinutes, 80);
  assert.deepEqual(data.categories, ['climatisation']);
  assert.equal(data.lat, 43.6);
});
```

- [ ] **Step 2 : lancer — échec**

Run: `node --test scripts/tournee/loaders.test.mjs`

- [ ] **Step 3 : créer `loaders.js`**

`chargerJournees` = corps actuel de `getJourneesHorizon` (l. 233-341 de `tournees.service.js`) **déplacé tel quel**, avec : `supabase` → `client` ; `getMajordhomeOrgId(coreOrgId)` → paramètre `mdhOrgId` ; `new Date()` → `maintenant` ; `logger` → paramètre `log` ; `.select(...)` des team_members enrichi de `specialties` ; ajout de `specialties: m.specialties || []` sur chaque journée ; retour `{ data: journees, techniciens: membres.map((m) => ({ id: m.id, nom: m.display_name, specialties: m.specialties || [], couleur: m.calendar_color })), error: null }`. Imports : `import { cleCoord } from './geo.js';` si nécessaire — rien d'autre.

`chargerContrat` = la logique de `getContratsDus` restreinte à UN contrat (lignes 102-113 pour types, 156-217 pour équipements/coords/durée), sans les filtres « dû / planifié » (le CTA décide lui-même quand il est pertinent) :

```js
export async function chargerContrat({ client, coreOrgId, contractId }) {
  const [{ data: contrat, error: cErr }, { data: types, error: tErr }] = await Promise.all([
    client.from('majordhome_contracts')
      .select('id, client_id, client_name, client_city, client_postal_code, start_date')
      .eq('org_id', coreOrgId).eq('id', contractId).maybeSingle(),
    client.from('majordhome_pricing_equipment_types')
      .select('id, code, category, duration_base_minutes, duration_per_extra_unit_minutes, included_units, unfavorable_months')
      .eq('org_id', coreOrgId),
  ]);
  if (cErr) return { data: null, error: cErr };
  if (tErr) return { data: null, error: tErr };
  if (!contrat) return { data: null, error: new Error('contrat_introuvable') };
  const [{ data: clients, error: clErr }, { data: liens, error: lErr }] = await Promise.all([
    client.from('majordhome_clients').select('id, latitude, longitude').eq('org_id', coreOrgId).in('id', [contrat.client_id].filter(Boolean)),
    client.from('majordhome_contract_equipments').select('contract_id, equipment_id').in('contract_id', [contractId]),
  ]);
  if (clErr) return { data: null, error: clErr };
  if (lErr) return { data: null, error: lErr };
  const equipIds = [...new Set((liens || []).map((l) => l.equipment_id))];
  const { data: equipements, error: eqErr } = equipIds.length
    ? await client.from('majordhome_equipments').select('id, category, unit_count, equipment_type_id').in('id', equipIds)
    : { data: [], error: null };
  if (eqErr) return { data: null, error: eqErr };
  const typesById = new Map((types || []).map((t) => [t.id, t]));
  const fallbacks = construireFallbacks(equipements || [], typesById, 90);
  const co = (clients || [])[0];
  return {
    data: {
      id: contrat.id, clientId: contrat.client_id, clientName: contrat.client_name, ville: contrat.client_city,
      lat: co?.latitude ?? null, lng: co?.longitude ?? null,
      dureeMinutes: dureeContrat(equipements || [], typesById, fallbacks),
      categories: [...new Set((equipements || []).map((e) => e.category).filter(Boolean))],
      typesNonRenseignes: (equipements || []).filter((e) => !e.equipment_type_id).length,
    },
    error: null,
  };
}
```

(`fallbacks` calculé sur les seuls équipements du contrat : identique à `getContratsDus` quand le parc est réduit à ce contrat ; documenter que l'onglet Tournées, lui, calcule sur le parc entier — écart accepté, à unifier si un test terrain montre un décalage de durée.)

Dans `tournees.service.js` : `getJourneesHorizon({ coreOrgId, joursApres })` devient `const mdhOrgId = await getMajordhomeOrgId(coreOrgId); const { data, error } = await chargerJournees({ client: supabase, coreOrgId, mdhOrgId, joursApres, logger }); return { data, error };` (l'appelant actuel n'attend que `data`/`error`). Supprimer le code déplacé et les imports devenus inutiles.

- [ ] **Step 4 : tests verts, build, lint**

Run: `node --test "scripts/tournee/*.test.mjs" && npx vite build 2>&1 | tail -2 && npm run lint:errors`

- [ ] **Step 5 : commit**

```bash
git add src/lib/tournee/loaders.js src/shared/services/tournees.service.js scripts/tournee/loaders.test.mjs
git commit -m "refactor(tournees): chargement des journées et d'un contrat injectable (loaders.js)"
```

---

### Task 4 : synchronisation du moteur vers Deno

**Files:**
- Create: `scripts/sync-tournee-engine.mjs`, `scripts/tournee/sync-engine.test.mjs`
- Modify: `package.json` (scripts `sync:tournee-engine`, `audit:quality`)
- Generated: `supabase/functions/_shared/tournee/*.js`

**Interfaces:**
- Produces: `supabase/functions/_shared/tournee/{arrets,creneaux,duree,eligibilite,geo,matrice,timeline,sequence,proposer-contrat,loaders,trajets-core,sectorClustering}.js`. Dans les copies, `geo.js` importe `'./sectorClustering.js'` (au lieu de `'../sectorClustering.js'`) — la SEULE réécriture faite par le script.

- [ ] **Step 1 : test**

```js
// scripts/tournee/sync-engine.test.mjs
// Les copies Deno du moteur doivent être identiques à la source (sinon l'edge calcule autre chose que l'écran).
// Run : node --test scripts/tournee/sync-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { FICHIERS, transformer } from '../sync-tournee-engine.mjs';

test('chaque copie _shared/tournee est à jour', () => {
  for (const { source, cible } of FICHIERS) {
    assert.ok(existsSync(cible), `copie manquante : ${cible} — lancer npm run sync:tournee-engine`);
    assert.equal(readFileSync(cible, 'utf8'), transformer(source, readFileSync(source, 'utf8')), `copie périmée : ${cible}`);
  }
});
```

- [ ] **Step 2 : script**

```js
// scripts/sync-tournee-engine.mjs
// Copie les modules PURS du moteur de tournées vers supabase/functions/_shared/tournee/
// pour que l'edge slots-propose exécute EXACTEMENT le code de l'écran.
// Source unique = src/lib. Ne jamais éditer les copies. Vérifié par sync-engine.test.mjs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(racine, 'src', 'lib', 'tournee');
const DST = path.join(racine, 'supabase', 'functions', '_shared', 'tournee');
const NOMS = ['arrets', 'creneaux', 'duree', 'eligibilite', 'geo', 'matrice', 'timeline', 'sequence', 'proposer-contrat', 'loaders', 'trajets-core'];

export const FICHIERS = [
  ...NOMS.map((n) => ({ source: path.join(SRC, `${n}.js`), cible: path.join(DST, `${n}.js`) })),
  { source: path.join(racine, 'src', 'lib', 'sectorClustering.js'), cible: path.join(DST, 'sectorClustering.js') },
];

/** Seule réécriture : geo.js importe sectorClustering depuis le même dossier. */
export function transformer(source, contenu) {
  const entete = `// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis ${path.relative(racine, source).replace(/\\/g, '/')} — ne pas éditer.\n`;
  return entete + contenu.replace("from '../sectorClustering.js'", "from './sectorClustering.js'");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(DST, { recursive: true });
  for (const { source, cible } of FICHIERS) writeFileSync(cible, transformer(source, readFileSync(source, 'utf8')));
  console.log(`${FICHIERS.length} fichiers synchronisés vers ${path.relative(racine, DST)}`);
}
```

`package.json` : `"sync:tournee-engine": "node scripts/sync-tournee-engine.mjs"` et `"audit:quality": "npm run lint:errors && npm run audit:dead-code && node --test scripts/tournee/sync-engine.test.mjs"`.

⚠️ `sectorClustering.js` doit être pur (vérifier `grep import src/lib/sectorClustering.js` : s'il importe un alias, copier seulement `haversineKm` dans `geo.js` et retirer sectorClustering des FICHIERS).

- [ ] **Step 3 : générer + tester**

Run: `npm run sync:tournee-engine && node --test scripts/tournee/sync-engine.test.mjs`

- [ ] **Step 4 : commit**

```bash
git add scripts/sync-tournee-engine.mjs scripts/tournee/sync-engine.test.mjs package.json supabase/functions/_shared/tournee
git commit -m "build(tournees): copies synchronisées du moteur pour Deno (_shared/tournee) + test d'égalité"
```

---

### Task 5 : compétences techniciens (RPC + service + UI)

**Files:**
- Create: `supabase/migrations/20260912_1_team_member_specialties_rpc.sql`, `src/apps/artisan/pages/settings/team/SpecialtiesEditor.jsx`
- Modify: `src/shared/services/appointments.service.js:618-636`, `src/shared/hooks/useAppointments.js:377-408`, `src/apps/artisan/pages/settings/TeamManagement.jsx` (colonne « Compétences »)

**Interfaces:**
- RPC `public.team_member_set_routing_settings(p_team_member_id uuid, p_daily_work_minutes int DEFAULT NULL, p_include_in_routing boolean DEFAULT NULL, p_specialties text[] DEFAULT NULL) RETURNS TABLE (daily_work_minutes int, include_in_routing boolean, specialties text[])`.
- `appointmentsService.setTeamMemberRoutingSettings(teamMemberId, { dailyWorkMinutes, includeInRouting, specialties })`.
- `useSetTeamMemberRouting(orgId).setRoutingSettings({ teamMemberId, specialties })`.

- [ ] **Step 1 : migration**

```sql
-- 20260912_1_team_member_specialties_rpc.sql
-- Compétences des techniciens = catégories d'équipement qu'ils entretiennent.
-- Réutilise la colonne existante majordhome.team_members.specialties (text[]).
-- Sémantique : '{}' = polyvalent (aucune restriction). Consommé par
-- proposerPourContrat (techniciensEligibles).
-- Signature ÉTENDUE d'une RPC existante : on DROP l'ancienne (PostgREST ne sait
-- pas choisir entre deux surcharges quand les paramètres ont des défauts).
DROP FUNCTION IF EXISTS public.team_member_set_routing_settings(uuid, integer, boolean);

CREATE OR REPLACE FUNCTION public.team_member_set_routing_settings(
  p_team_member_id      uuid,
  p_daily_work_minutes  integer DEFAULT NULL,
  p_include_in_routing  boolean DEFAULT NULL,
  p_specialties         text[]  DEFAULT NULL
)
RETURNS TABLE (daily_work_minutes integer, include_in_routing boolean, specialties text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id     uuid := auth.uid();
  v_core_org_id uuid;
  v_role        text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF p_daily_work_minutes IS NOT NULL
     AND (p_daily_work_minutes < 60 OR p_daily_work_minutes > 1440) THEN
    RAISE EXCEPTION 'Budget journalier hors bornes (60-1440 min): %', p_daily_work_minutes USING ERRCODE = '22023';
  END IF;
  SELECT o.core_org_id INTO v_core_org_id
  FROM majordhome.team_members tm JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;
  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE user_id = v_user_id AND org_id = v_core_org_id;
  IF v_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un org_admin peut modifier les reglages de tournee (role=%)', v_role USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE majordhome.team_members tm
     SET daily_work_minutes = COALESCE(p_daily_work_minutes, tm.daily_work_minutes),
         include_in_routing = COALESCE(p_include_in_routing, tm.include_in_routing),
         specialties        = COALESCE(p_specialties, tm.specialties),
         updated_at         = NOW()
   WHERE tm.id = p_team_member_id
  RETURNING tm.daily_work_minutes, tm.include_in_routing, tm.specialties;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[]) TO authenticated;
-- Vérification : SELECT has_function_privilege('anon', 'public.team_member_set_routing_settings(uuid, integer, boolean, text[])', 'EXECUTE'); -- doit être false
```

- [ ] **Step 2 : service + hook** — ajouter `specialties` au destructuring et `p_specialties: specialties ?? null` dans l'appel RPC ; dans le hook, `mutationFn: ({ teamMemberId, dailyWorkMinutes, includeInRouting, specialties }) => …setTeamMemberRoutingSettings(teamMemberId, { dailyWorkMinutes, includeInRouting, specialties })` ; le patch de cache existant (`setQueryData`) recopie déjà la ligne retournée — vérifier qu'il fusionne `...row` (sinon ajouter `specialties: row.specialties`).

- [ ] **Step 3 : `SpecialtiesEditor.jsx`**

```jsx
// src/apps/artisan/pages/settings/team/SpecialtiesEditor.jsx
// Chips de compétences d'un technicien (catégories d'équipement). Vide = polyvalent.
// Les catégories proposées sont celles réellement présentes dans la grille
// tarifaire de l'org (majordhome_pricing_equipment_types) — pas de liste en dur.
import { useMemo } from 'react';
import { usePricingData } from '@hooks/usePricing';

const LABELS = {
  climatisation: 'Clim', poele: 'Poêle', pac_air_air: 'PAC air/air', pac_air_eau: 'PAC air/eau',
  chaudiere_gaz: 'Chaudière gaz', chaudiere_fioul: 'Chaudière fioul', chaudiere_bois: 'Chaudière bois',
  chaudiere_granules: 'Chaudière granulés', vmc: 'VMC', chauffe_eau_thermo: 'Chauffe-eau thermo', ballon_ecs: 'Ballon ECS', autre: 'Autre',
};

export function SpecialtiesEditor({ value = [], onChange, disabled }) {
  const { equipmentTypes } = usePricingData();
  const categories = useMemo(
    () => [...new Set((equipmentTypes || []).map((t) => t.category).filter(Boolean))].sort(),
    [equipmentTypes],
  );
  const toggle = (cat) => onChange(value.includes(cat) ? value.filter((c) => c !== cat) : [...value, cat]);
  return (
    <div className="flex flex-wrap gap-1.5" title="Vide = polyvalent (toutes les catégories)">
      {categories.map((cat) => {
        const on = value.includes(cat);
        return (
          <button key={cat} type="button" disabled={disabled} onClick={() => toggle(cat)}
            className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${on
              ? 'bg-primary-600 text-white border-primary-600'
              : 'bg-white text-secondary-600 border-secondary-300 hover:border-primary-400'}`}>
            {LABELS[cat] || cat}
          </button>
        );
      })}
      {value.length === 0 && <span className="text-xs text-secondary-400 self-center">polyvalent</span>}
    </div>
  );
}
```

Vérifier le nom exact du hook/champ dans `src/shared/hooks/usePricing.js` (`usePricingData` expose-t-il `equipmentTypes` ? sinon adapter au nom réel).

- [ ] **Step 4 : `TeamManagement.jsx`** — ajouter une colonne « Compétences » à côté de « Tournées » (en-tête l. ~758 + cellule après le `RoutingToggle`, l. ~462) : `<SpecialtiesEditor value={teamMember.specialties || []} onChange={(next) => onSpecialtiesChange(teamMember.id, next)} disabled={isRoutingSaving} />` en édition (`canEditColor`), sinon la liste des libellés ; handler `onSpecialtiesChange = async (teamMemberId, specialties) => { const r = await setRoutingSettings({ teamMemberId, specialties }); if (r?.error) toast.error('Compétences non enregistrées'); }` câblé comme `onIncludeInRoutingChange` (l. ~668-680).

- [ ] **Step 5 : appliquer la migration, vérifier, build, commit**

Appliquer via le MCP Supabase (projet `ejqqqwudmizqisdkxohw`) `apply_migration` avec le fichier, puis vérifier : `SELECT has_function_privilege('anon','public.team_member_set_routing_settings(uuid, integer, boolean, text[])','EXECUTE')` → `false`. Si le MCP n'est pas autorisé sur l'org `confer-saas` : demander à Eric de basculer l'autorisation (une action), ne pas contourner.

```bash
npx vite build 2>&1 | tail -2 && npm run lint:errors
git add supabase/migrations/20260912_1_team_member_specialties_rpc.sql src/shared/services/appointments.service.js src/shared/hooks/useAppointments.js src/apps/artisan/pages/settings/team/SpecialtiesEditor.jsx src/apps/artisan/pages/settings/TeamManagement.jsx
git commit -m "feat(equipe): compétences des techniciens (catégories d'équipement) éditables dans Settings → Équipe"
```

---

### Task 6 : adresse BAN à la saisie + précision

**Files:**
- Create: `supabase/migrations/20260912_2_clients_address_precision.sql`, `src/apps/artisan/components/shared/BanAddressInput.jsx`
- Modify: `src/shared/services/geocoding.service.js` (3 fonctions), `src/apps/artisan/components/clients/ClientModalTabs.jsx:171-204`, `src/apps/artisan/components/clients/ClientModal.jsx:165-220`, `src/apps/artisan/components/pipeline/LeadFormSections.jsx:338-380`, `supabase/functions/geocode-sweep/index.ts:41-75`

**Interfaces:**
- `suggestAddresses(q, { postcode?, limit = 5 })` → `Array<{ label, name, postcode, city, citycode, lat, lng, type: 'housenumber'|'street'|'locality'|'municipality', score }>`.
- `geocodeCommune(postalCode, city)` → `{ lat, lng, label, postcode, city } | null` (réutilise `geocodeByPostalCode` + `q=city`).
- `setClientLocation({ clientId, lat, lng, precision })` → `{ error }` via RPC `client_set_location`.
- `BanAddressInput({ value: { address, postalCode, city }, onChange(next: { address, postalCode, city, location?: { lat, lng, precision } }), disabled })`.

- [ ] **Step 1 : migration**

```sql
-- 20260912_2_clients_address_precision.sql
-- Précision de la localisation d'un client (BAN) : housenumber | street | locality | municipality.
-- NULL = géocodé par l'ancien chemin, précision inconnue.
ALTER TABLE majordhome.clients
  ADD COLUMN IF NOT EXISTS address_precision text
  CHECK (address_precision IS NULL OR address_precision IN ('housenumber','street','locality','municipality'));

-- Le trigger existant remet les coordonnées à NULL quand l'adresse change ; la
-- précision suit le même sort (sinon une adresse retapée à la main garderait
-- « housenumber » alors qu'elle n'est plus localisée).
CREATE OR REPLACE FUNCTION majordhome.reset_geocode_on_address_change()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'majordhome', 'public', 'core', 'pg_temp'
AS $function$
BEGIN
  IF (
    COALESCE(NEW.address, '') IS DISTINCT FROM COALESCE(OLD.address, '') OR
    COALESCE(NEW.postal_code, '') IS DISTINCT FROM COALESCE(OLD.postal_code, '') OR
    COALESCE(NEW.city, '') IS DISTINCT FROM COALESCE(OLD.city, '')
  ) THEN
    NEW.latitude := NULL; NEW.longitude := NULL; NEW.geocoded_at := NULL;
    NEW.geocode_attempts := 0; NEW.address_precision := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Écriture des coordonnées choisies à la saisie (BAN). Membership positive.
CREATE OR REPLACE FUNCTION public.client_set_location(
  p_client_id uuid, p_lat numeric, p_lng numeric, p_precision text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE v_org uuid; v_member boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501'; END IF;
  SELECT org_id INTO v_org FROM majordhome.clients WHERE id = p_client_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Client % introuvable', p_client_id USING ERRCODE = 'P0002'; END IF;
  SELECT EXISTS (SELECT 1 FROM core.organization_members WHERE user_id = auth.uid() AND org_id = v_org) INTO v_member;
  IF v_member IS NOT TRUE THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_precision IS NOT NULL AND p_precision NOT IN ('housenumber','street','locality','municipality') THEN
    RAISE EXCEPTION 'precision invalide: %', p_precision USING ERRCODE = '22023';
  END IF;
  UPDATE majordhome.clients
     SET latitude = p_lat, longitude = p_lng, geocoded_at = now(), geocode_attempts = 0, address_precision = p_precision
   WHERE id = p_client_id AND org_id = v_org;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.client_set_location(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_set_location(uuid, numeric, numeric, text) TO authenticated;

-- Le balayage peut désormais poser la précision (étage commune).
CREATE OR REPLACE FUNCTION public.geocode_apply_client_coordinates(p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public
AS $function$
DECLARE r jsonb; n int := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    IF (r->>'lat') IS NOT NULL AND (r->>'lng') IS NOT NULL THEN
      UPDATE majordhome.clients
        SET latitude = (r->>'lat')::numeric, longitude = (r->>'lng')::numeric, geocoded_at = now(),
            geocode_attempts = COALESCE(geocode_attempts, 0) + 1,
            address_precision = COALESCE(r->>'precision', address_precision)
      WHERE id = (r->>'id')::uuid;
      n := n + 1;
    ELSE
      UPDATE majordhome.clients SET geocode_attempts = COALESCE(geocode_attempts, 0) + 1 WHERE id = (r->>'id')::uuid;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.geocode_apply_client_coordinates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geocode_apply_client_coordinates(jsonb) TO service_role;
```

- [ ] **Step 2 : `geocoding.service.js`** — ajouter, à côté de `geocodeAddress` :

```js
/** Suggestions BAN pour l'autocomplétion (type = housenumber | street | locality | municipality). */
export async function suggestAddresses(q, { postcode, limit = 5 } = {}) {
  const query = String(q || '').trim();
  if (query.length < 3) return [];
  const params = new URLSearchParams({ q: query, limit: String(limit), autocomplete: '1' });
  if (postcode && /^\d{5}$/.test(postcode)) params.set('postcode', postcode);
  try {
    const res = await fetch(`${API_BASE}/search/?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      return { label: p.label, name: p.name, postcode: p.postcode, city: p.city, citycode: p.citycode, lat, lng, type: p.type, score: p.score };
    });
  } catch (err) {
    logger.warn('[geocoding] suggestAddresses', err);
    return [];
  }
}

/** Centroïde d'une commune (précision « municipality ») — le filet quand l'adresse exacte n'existe pas. */
export async function geocodeCommune(postalCode, city) {
  const params = new URLSearchParams({ q: String(city || postalCode || '').trim(), type: 'municipality', limit: '1' });
  if (postalCode) params.set('postcode', postalCode);
  try {
    const res = await fetch(`${API_BASE}/search/?${params}`);
    if (!res.ok) return null;
    const f = (await res.json()).features?.[0];
    if (!f || (f.properties.score ?? 0) < 0.3) return null;
    const [lng, lat] = f.geometry.coordinates;
    return { lat, lng, label: f.properties.label, postcode: f.properties.postcode, city: f.properties.city };
  } catch (err) {
    logger.warn('[geocoding] geocodeCommune', err);
    return null;
  }
}

/** Coordonnées choisies à la saisie (BAN) — RPC membership-checked, jamais d'UPDATE direct. */
export async function setClientLocation({ clientId, lat, lng, precision }) {
  const { error } = await supabase.rpc('client_set_location', { p_client_id: clientId, p_lat: lat, p_lng: lng, p_precision: precision });
  if (error) logger.error('[geocoding] setClientLocation', error);
  return { error: error || null };
}
```

(`logger` importé de `@lib/logger` si le fichier ne l'a pas encore — remplacer les `console.*` rencontrés au passage uniquement dans les fonctions touchées.)

- [ ] **Step 3 : `BanAddressInput.jsx`**

```jsx
// src/apps/artisan/components/shared/BanAddressInput.jsx
// Saisie d'adresse avec suggestions BAN. Une suggestion choisie remplit adresse /
// CP / ville ET remonte `location` (lat, lng, précision). Si l'adresse exacte n'existe
// pas, l'utilisateur garde son texte et choisit la COMMUNE : location = centroïde,
// précision « municipality » — suffisant pour les tournées (décision 2026-09-12).
import { useEffect, useRef, useState } from 'react';
import { MapPin, Check } from 'lucide-react';
import { suggestAddresses, geocodeCommune } from '@services/geocoding.service';
import { useDebounce } from '@hooks/useDebounce';
import { TextInput, FormField } from '@/apps/artisan/components/FormFields';

const PRECISION_LABEL = { housenumber: 'adresse exacte', street: 'rue', locality: 'lieu-dit', municipality: 'commune' };

export function BanAddressInput({ value, onChange, disabled }) {
  const [saisie, setSaisie] = useState(value.address || '');
  const [suggestions, setSuggestions] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [location, setLocation] = useState(value.location || null);
  const debounced = useDebounce(saisie, 300);
  const boite = useRef(null);

  useEffect(() => { setSaisie(value.address || ''); }, [value.address]);
  useEffect(() => {
    let actif = true;
    if (!ouvert || debounced.trim().length < 3) { setSuggestions([]); return undefined; }
    suggestAddresses(debounced, { postcode: value.postalCode }).then((s) => { if (actif) setSuggestions(s); });
    return () => { actif = false; };
  }, [debounced, ouvert, value.postalCode]);
  useEffect(() => {
    const fermer = (e) => { if (boite.current && !boite.current.contains(e.target)) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, []);

  const choisir = (s) => {
    const loc = { lat: s.lat, lng: s.lng, precision: s.type };
    setLocation(loc); setOuvert(false);
    onChange({ address: s.type === 'municipality' ? saisie : s.name, postalCode: s.postcode, city: s.city, location: loc });
  };
  const choisirCommune = async () => {
    const c = await geocodeCommune(value.postalCode, value.city);
    if (!c) return;
    const loc = { lat: c.lat, lng: c.lng, precision: 'municipality' };
    setLocation(loc); setOuvert(false);
    onChange({ address: saisie, postalCode: c.postcode, city: c.city, location: loc });
  };
  const taper = (v) => { setSaisie(v); setLocation(null); setOuvert(true); onChange({ ...value, address: v, location: null }); };

  return (
    <div ref={boite} className="space-y-3">
      <FormField label="Adresse">
        <div className="relative">
          <TextInput value={saisie} onChange={taper} placeholder="12 rue des Lilas" disabled={disabled} onFocus={() => setOuvert(true)} />
          {ouvert && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full bg-white border border-secondary-200 rounded-md shadow-lg max-h-56 overflow-auto text-sm">
              {suggestions.map((s) => (
                <li key={`${s.citycode}-${s.label}`}>
                  <button type="button" className="w-full text-left px-3 py-2 hover:bg-secondary-50 flex items-center gap-2" onClick={() => choisir(s)}>
                    <MapPin className="w-3.5 h-3.5 text-secondary-400 shrink-0" />
                    <span className="truncate">{s.label}</span>
                    <span className="ml-auto text-xs text-secondary-400">{PRECISION_LABEL[s.type] || s.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Code postal">
          <TextInput value={value.postalCode || ''} onChange={(v) => { setLocation(null); onChange({ ...value, postalCode: v.replace(/\D/g, '').slice(0, 5), location: null }); }} placeholder="81100" disabled={disabled} />
        </FormField>
        <FormField label="Ville">
          <TextInput value={value.city || ''} onChange={(v) => { setLocation(null); onChange({ ...value, city: v, location: null }); }} placeholder="Castres" disabled={disabled} />
        </FormField>
      </div>
      <div className="flex items-center justify-between text-xs">
        {location ? (
          <span className="inline-flex items-center gap-1 text-green-700"><Check className="w-3.5 h-3.5" />Localisée ({PRECISION_LABEL[location.precision]})</span>
        ) : (
          <span className="text-amber-700">Adresse non localisée</span>
        )}
        {!location && (value.postalCode || value.city) && (
          <button type="button" disabled={disabled} onClick={choisirCommune} className="text-primary-700 hover:underline">
            Localiser à la commune
          </button>
        )}
      </div>
    </div>
  );
}
```

Vérifier que `TextInput` accepte `onFocus` (sinon l'ajouter au composant partagé en le propageant sur l'`<input>` — modification d'une ligne dans `FormFields.jsx`).

- [ ] **Step 4 : intégration `ClientModalTabs` + `ClientModal`**

`ClientModalTabs.jsx` : remplacer la section Adresse (l. 172-204) par
```jsx
<BanAddressInput
  value={{ address: formData.address, postalCode: formData.postalCode, city: formData.city, location: formData.location }}
  onChange={(next) => { updateField('address', next.address); updateField('postalCode', next.postalCode); updateField('city', next.city); updateField('location', next.location ?? null); }}
  disabled={isLocked}
/>
```
`ClientModal.jsx` : `location: null` dans l'état initial (l. 42) et dans le chargement (l. ~103) ; au save (création l. 184 et mise à jour l. 212) :
```js
const loc = formData.location;
if (loc && targetClientId) {
  const { error: locErr } = await setClientLocation({ clientId: targetClientId, lat: loc.lat, lng: loc.lng, precision: loc.precision });
  if (locErr) toast.error('Adresse enregistrée mais localisation non sauvegardée');
} else if (formData.postalCode && formData.city && projectId) {
  geocodeAndUpdateByProjectId(projectId, formData.address, formData.postalCode, formData.city).catch((err) => logger.warn('[ClientModal] Auto-geocode failed:', err));
}
```
(`targetClientId` = `newClient.id` en création, `client.id` en édition ; le géocodage après coup ne se lance que si aucune localisation BAN n'a été choisie.) Import `setClientLocation` depuis `@services/geocoding.service`.

- [ ] **Step 5 : `LeadFormSections.jsx`** — remplacer les 3 champs adresse/CP/ville (l. 338-380) par `<BanAddressInput value={{ address: form.address, postalCode: form.postal_code, city: form.city }} onChange={(next) => { setField('address', next.address); setField('postal_code', next.postalCode); setField('city', next.city); }} />` — pas de `location` côté lead (le géocodage + zone + commercial restent dans `geocodeAndAssignLead`). Garder le champ `address_complement` tel quel.

- [ ] **Step 6 : `geocode-sweep` étage 2** — dans `geocodeOne` (l. 49-75), quand `!f || score < SCORE_MIN` ET `c.postal_code` : appeler `${GOUV_SEARCH}?${new URLSearchParams({ q: c.city || c.postal_code, type: 'municipality', postcode: c.postal_code, limit: '1' })}` ; si une feature avec score ≥ 0.3 → `return { id: c.id, lat, lng, precision: 'municipality' }` ; sinon `{ id, lat: null, lng: null }`. Le chemin exact renvoie `precision: f.properties.type`. Étendre `ApplyRow` avec `precision?: string`. Déployer : `npx supabase functions deploy geocode-sweep --project-ref ejqqqwudmizqisdkxohw`.

- [ ] **Step 7 : appliquer la migration, vérifier, build, lint, commit**

Vérifications SQL après `apply_migration` :
`SELECT has_function_privilege('anon','public.client_set_location(uuid, numeric, numeric, text)','EXECUTE');` → false ;
`BEGIN; UPDATE majordhome.clients SET address = address || ' ' WHERE id = (SELECT id FROM majordhome.clients WHERE latitude IS NOT NULL LIMIT 1) RETURNING latitude, address_precision; ROLLBACK;` → `NULL, NULL` (le trigger remet bien à zéro).

```bash
npx vite build 2>&1 | tail -2 && npm run lint:errors
git add supabase/migrations/20260912_2_clients_address_precision.sql src/shared/services/geocoding.service.js src/apps/artisan/components/shared/BanAddressInput.jsx src/apps/artisan/components/clients/ClientModalTabs.jsx src/apps/artisan/components/clients/ClientModal.jsx src/apps/artisan/components/pipeline/LeadFormSections.jsx src/apps/artisan/components/FormFields.jsx supabase/functions/geocode-sweep/index.ts
git commit -m "feat(clients): adresse BAN à la saisie (suggestions, repli commune, précision) + étage commune du balayage"
```

---

### Task 7 : edge function `slots-propose`

**Files:**
- Create: `supabase/functions/slots-propose/index.ts`
- Modify: `supabase/config.toml` (bloc `[functions.slots-propose] verify_jwt = true`)

**Interfaces:**
- POST body `{ org_id, contract_id, constraints?: { technician_id?, date_from?, date_to?, periode?, jours_semaine_exclus?: number[], dates_exclues?: string[] }, max_results? }`.
- Réponse 200 `{ data: { contrat, creneaux: [...avec technicianNom, debut:'HH:MM', fin:'HH:MM', avant, apres, coutMinutes, estime], nouvellesJournees, raisonsRejet, techniciensEligibles, estime }, error: null }` ; erreurs 4xx `{ error: 'siege_non_configure'|'client_non_localise'|'contrat_introuvable'|'aucun_technicien' , detail? }`.
- Secret `MDH_MAPBOX_TOKEN` (env de l'edge). Absent → `estime:true` + `logger.error`, jamais une 500.

- [ ] **Step 1 : écrire l'edge**

```ts
// supabase/functions/slots-propose/index.ts
// ============================================================================
// slots-propose — pour UN contrat d'entretien, les créneaux les moins coûteux
// (technicien compétent, trajets réels, RDV déjà posés). Outil « machine-usable » :
// appelé par le CTA de ContractModal aujourd'hui, par le serveur MCP (Hermes/Vapi)
// demain. Exécute EXACTEMENT le moteur de l'écran (copies _shared/tournee,
// synchronisées et testées). verify_jwt:true + requireOrgMembership.
// Spec : docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md
// ============================================================================
import { requireOrgMembership, jsonResponse, sanitizeError, buildCorsHeaders } from "../_shared/auth.ts";
import { chargerJournees, chargerContrat } from "../_shared/tournee/loaders.js";
import { creerChargeurMatrice } from "../_shared/tournee/trajets-core.js";
import { proposerPourContrat } from "../_shared/tournee/proposer-contrat.js";
import { construireMatrice, trajetLocal } from "../_shared/tournee/matrice.js";
import { construireArretsExistants } from "../_shared/tournee/arrets.js";
import { cleCoord } from "../_shared/tournee/geo.js";

const REGLAGES_DEFAUT = {
  horizon_ferme_jours: 15, horizon_ouverture_jours: 45, tolerance_anniversaire_mois: 2,
  pause_minutes: 30, pause_fenetre: [12, 14], rayon_filtre_km: 25, fenetre_promise_minutes: 90,
  mois_creux: [11, 12, 1, 2, 3], max_candidats_tri: 20,
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  try {
    const body = await req.json().catch(() => ({}));
    const orgId = String(body.org_id || "");
    if (!orgId) return jsonResponse({ error: "org_id requis" }, 400, req);
    const auth = await requireOrgMembership(req, { orgId });
    if (!auth.ok) return auth.response;
    const admin = auth.supabase;
    const contractId = String(body.contract_id || "");
    if (!contractId) return jsonResponse({ error: "contract_id requis" }, 400, req);

    // Org majordhome (team_members/appointments) ≠ org core (contracts/clients/travel_cache).
    const { data: mdhOrg, error: orgErr } = await admin.from("majordhome_organizations").select("id").eq("core_org_id", orgId).maybeSingle();
    if (orgErr || !mdhOrg) return jsonResponse({ error: "org_majordhome_introuvable" }, 500, req);
    const { data: coreOrg, error: settingsErr } = await admin.schema("core").from("organizations").select("settings").eq("id", orgId).maybeSingle();
    if (settingsErr) return jsonResponse({ error: sanitizeError(settingsErr, "settings illisibles") }, 500, req);
    const settings = (coreOrg?.settings ?? {}) as Record<string, unknown>;
    const reglages = { ...REGLAGES_DEFAUT, ...((settings.tournees as object) || {}) };
    const centres = (settings.territoire_centers as Array<{ lat: number; lng: number }>) || [];
    const depot = centres[0] && Number.isFinite(centres[0].lat) && Number.isFinite(centres[0].lng) ? { lat: centres[0].lat, lng: centres[0].lng } : null;
    if (!depot) return jsonResponse({ error: "siege_non_configure" }, 422, req);

    const { data: contrat, error: cErr } = await chargerContrat({ client: admin, coreOrgId: orgId, contractId });
    if (cErr || !contrat) return jsonResponse({ error: "contrat_introuvable", detail: cErr?.message }, 404, req);
    if (contrat.lat == null || contrat.lng == null) return jsonResponse({ error: "client_non_localise" }, 422, req);

    const horizon = Math.max(reglages.horizon_ferme_jours, reglages.horizon_ouverture_jours ?? 45);
    const { data: journees, techniciens, error: jErr } = await chargerJournees({ client: admin, coreOrgId: orgId, mdhOrgId: mdhOrg.id, joursApres: horizon, logger: console });
    if (jErr) return jsonResponse({ error: sanitizeError(jErr, "journées illisibles") }, 500, req);
    if (!techniciens.length) return jsonResponse({ error: "aucun_technicien" }, 422, req);

    // Matrice : une passe par journée retenue (noyau = dépôt + arrêts de la journée, candidat = le contrat),
    // paires fusionnées dans un seul trajet(). Concurrence bornée (Mapbox : 60 req/min).
    const token = Deno.env.get("MDH_MAPBOX_TOKEN") || "";
    if (!token) console.error("[slots-propose] MDH_MAPBOX_TOKEN absent — trajets estimés");
    const charger = creerChargeurMatrice({ client: admin, coreOrgId: orgId, token, logger: console });
    const paires = new Map<string, number>();
    let estime = !token;
    const lots: typeof journees[] = [];
    for (let i = 0; i < journees.length; i += 4) lots.push(journees.slice(i, i + 4));
    for (const lot of lots) {
      const resultats = await Promise.all(lot.map((j) => {
        const arrets = construireArretsExistants(j.rdvs, depot);
        const noyau = [depot, ...arrets.filter((a) => a.key).map((a) => { const [lat, lng] = a.key.split(",").map(Number); return { lat, lng }; })];
        return charger({ noyau, candidats: [contrat] });
      }));
      for (const r of resultats) { if (r.estime) estime = true; for (const [k, v] of r.data) paires.set(k, v); }
    }
    const trajet = construireMatrice(paires, { repli: trajetLocal });

    const c = body.constraints || {};
    const resultat = proposerPourContrat({
      contrat, journees, techniciens, depot, reglages, trajet, estime,
      aujourdhui: new Date().toISOString().slice(0, 10),
      maxResults: Math.min(Math.max(Number(body.max_results) || 4, 1), 10),
      contraintes: {
        technicianId: c.technician_id || undefined, dateFrom: c.date_from || undefined, dateTo: c.date_to || undefined,
        periode: c.periode || undefined, joursSemaineExclus: c.jours_semaine_exclus || [], datesExclues: c.dates_exclues || [],
      },
    });
    return jsonResponse({
      data: {
        contrat: { id: contrat.id, clientName: contrat.clientName, ville: contrat.ville, dureeMinutes: contrat.dureeMinutes, categories: contrat.categories, typesNonRenseignes: contrat.typesNonRenseignes },
        creneaux: resultat.creneaux.map((k) => ({ ...k, debut: hhmm(k.debutMinutes), fin: hhmm(k.finMinutes) })),
        nouvellesJournees: resultat.nouvellesJournees,
        raisonsRejet: resultat.raisonsRejet,
        techniciensEligibles: resultat.techniciensEligibles,
        estime,
      },
      error: null,
    }, 200, req);
  } catch (err) {
    console.error("[slots-propose]", err);
    return jsonResponse({ error: sanitizeError(err, "erreur interne") }, 500, req);
  }
});
```

`supabase/config.toml` : ajouter
```toml
# Entretiens — créneaux optimisés pour un contrat (outil machine-usable, CTA + futur MCP)
[functions.slots-propose]
verify_jwt = true
```

Vérifier que `_shared/auth.ts` exporte bien `sanitizeError` et `buildCorsHeaders` (oui, cf. pvgis-proxy) et que `jsonResponse(body, status, req)` prend `req` en 3ᵉ argument.

- [ ] **Step 2 : secret Mapbox + déploiement**

```bash
npx supabase secrets set MDH_MAPBOX_TOKEN="$(grep '^VITE_MAPBOX_TOKEN=' .env | cut -d= -f2-)" --project-ref ejqqqwudmizqisdkxohw
npx supabase functions deploy slots-propose --project-ref ejqqqwudmizqisdkxohw
```
(la valeur du token ne transite jamais dans la conversation ; si le token `pk.` est restreint par URL, Mapbox répondra 403 → `estime:true` visible, et il faudra un token serveur non restreint — geste Eric.)

- [ ] **Step 3 : appel réel** — depuis un script Node éphémère (scratchpad) avec l'URL prod + un JWT utilisateur obtenu par `supabase.auth.signInWithPassword` **saisi par Eric** — ou plus simplement depuis l'app (Task 8) avec l'onglet Réseau. Critère : 200, 4 créneaux pour un contrat de Castres, `estime:false` si le token Mapbox est valide, `raisonsRejet` cohérent.

- [ ] **Step 4 : commit**

```bash
git add supabase/functions/slots-propose/index.ts supabase/config.toml
git commit -m "feat(edge): slots-propose — créneaux optimisés pour un contrat (outil machine-usable)"
```

---

### Task 8 : service + hook + CTA + panneau

**Files:**
- Modify: `src/shared/services/tournees.service.js` (`proposerPourContrat`), `src/shared/hooks/cacheKeys.js` (`tourneeKeys.creneauxContrat`), `src/shared/hooks/useTournees.js` (`useCreneauxProposes`), `src/apps/artisan/components/entretiens/ContractModal.jsx`
- Create: `src/apps/artisan/components/entretiens/CreneauxProposesPanel.jsx`

**Interfaces:**
- `tourneesService.proposerPourContrat({ coreOrgId, contractId, constraints, maxResults })` → `{ data, error }` (invoke edge).
- `tourneeKeys.creneauxContrat(orgId, contractId, constraints)` = `[...tourneeKeys.all(orgId), 'creneauxContrat', contractId, JSON.stringify(constraints || {})]`.
- `useCreneauxProposes({ orgId, contractId, constraints, enabled })` → `{ data, isLoading, error, refetch }` (staleTime 0 : un RDV posé entre-temps change la réponse).
- `CreneauxProposesPanel({ orgId, contractId, onChoisir(slot), onFermer })` — `slot` = `{ date, startTime, endTime, duration, technicianIds: [id], subject }` (forme de `useJourneePose`, consommée par `scheduleEntretien`).

- [ ] **Step 1 : service**

```js
  /**
   * Créneaux optimisés pour UN contrat — calcul côté serveur (edge slots-propose),
   * même moteur que l'onglet. `constraints` = { technician_id?, date_from?, date_to?,
   * periode?: 'matin'|'apres_midi', jours_semaine_exclus?, dates_exclues? }.
   */
  async proposerPourContrat({ coreOrgId, contractId, constraints = {}, maxResults = 4 }) {
    const { data, error } = await supabase.functions.invoke('slots-propose', {
      body: { org_id: coreOrgId, contract_id: contractId, constraints, max_results: maxResults },
    });
    if (error) {
      let detail = error.message;
      try { const payload = await error.context?.json?.(); if (payload?.error) detail = payload.error; } catch { /* corps non-JSON */ }
      logger.error('[tournees] proposerPourContrat', detail);
      return { data: null, error: new Error(detail) };
    }
    return { data: data?.data ?? null, error: null };
  },
```

- [ ] **Step 2 : cache key + hook**

```js
// cacheKeys.js (dans tourneeKeys)
  creneauxContrat: (orgId, contractId, constraints) => [...tourneeKeys.all(orgId), 'creneauxContrat', contractId, JSON.stringify(constraints || {})],
```
```js
// useTournees.js
export function useCreneauxProposes({ orgId, contractId, constraints = {}, enabled = true }) {
  return useQuery({
    queryKey: tourneeKeys.creneauxContrat(orgId, contractId, constraints),
    queryFn: async () => {
      const { data, error } = await tourneesService.proposerPourContrat({ coreOrgId: orgId, contractId, constraints });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!contractId && enabled,
    staleTime: 0,
    retry: false,
  });
}
```

- [ ] **Step 3 : panneau**

```jsx
// src/apps/artisan/components/entretiens/CreneauxProposesPanel.jsx
// Les 4 créneaux les moins coûteux pour un contrat, explicables (voisins, trajets).
// Aucune logique de calcul ici : tout vient de slots-propose.
import { Loader2, Route, CalendarPlus, AlertTriangle } from 'lucide-react';
import { useCreneauxProposes } from '@hooks/useTournees';
import { formatDateShortFR } from '@/lib/utils';
import { Button } from '@components/ui/button';

const MOTIFS = {
  competence: 'technicien(s) sans la compétence', horizon: 'journée(s) vide(s) hors horizon', contrainte: 'journée(s) exclue(s) par les contraintes',
  creneau: 'pas de trou assez grand', budget: 'journée pleine', pause: 'pause impossible', position: 'client non localisé',
};
const ERREURS = {
  siege_non_configure: 'Siège non configuré (Settings → Organisation → Territoire)',
  client_non_localise: 'Client non localisé : renseignez son adresse (BAN)',
  aucun_technicien: 'Aucun technicien inclus dans les tournées',
  contrat_introuvable: 'Contrat introuvable',
};

export function CreneauxProposesPanel({ orgId, contractId, clientName, onChoisir, onFermer }) {
  const { data, isLoading, error } = useCreneauxProposes({ orgId, contractId });

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-secondary-500 py-3"><Loader2 className="h-4 w-4 animate-spin" />Calcul des créneaux…</div>;
  if (error) return <p className="text-sm text-red-600 py-2">{ERREURS[error.message] || `Erreur : ${error.message}`}</p>;
  if (!data) return null;

  const { creneaux, nouvellesJournees, raisonsRejet, estime, contrat } = data;
  const motifs = Object.entries(raisonsRejet || {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${MOTIFS[k] || k}`);

  return (
    <div className="mt-3 space-y-2">
      {estime && <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Trajets estimés (Mapbox indisponible)</p>}
      {creneaux.length === 0 && (
        <p className="text-sm text-secondary-600">Aucun créneau dans une tournée existante{motifs.length ? ` — ${motifs.join(', ')}` : ''}.</p>
      )}
      {creneaux.map((k) => (
        <button key={`${k.date}-${k.technicianId}-${k.debut}`} type="button"
          className="w-full text-left rounded-md border border-secondary-200 hover:border-primary-400 hover:bg-primary-50 px-3 py-2"
          onClick={() => onChoisir({
            date: k.date, startTime: k.debut, endTime: k.fin, duration: k.finMinutes - k.debutMinutes,
            technicianIds: [k.technicianId], subject: `Entretien — ${clientName}`,
          })}>
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: k.couleur || '#94A3B8' }} />
            <span className="font-medium">{formatDateShortFR(k.date)} · {k.debut}</span>
            <span className="text-secondary-500">{k.technicianNom}</span>
            <span className="ml-auto text-xs text-secondary-500 inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />+{k.coutMinutes} min</span>
          </div>
          <div className="text-xs text-secondary-500 mt-0.5">
            {k.avant ? `après ${k.avant.label}${k.avant.ville ? ` (${k.avant.ville})` : ''}` : 'depuis le dépôt'}
            {' → '}
            {k.apres ? `avant ${k.apres.label}${k.apres.ville ? ` (${k.apres.ville})` : ''}` : 'retour dépôt'}
          </div>
        </button>
      ))}
      {nouvellesJournees.length > 0 && (
        <div className="text-sm text-secondary-700 rounded-md border border-dashed border-secondary-300 px-3 py-2">
          <p className="font-medium flex items-center gap-1"><CalendarPlus className="h-4 w-4" />Ouvrir une nouvelle journée</p>
          {nouvellesJournees.map((j) => (
            <button key={`${j.date}-${j.technicianId}`} type="button" className="block text-primary-700 hover:underline text-xs mt-1"
              onClick={() => onChoisir({ date: j.date, startTime: '08:00', endTime: null, duration: contrat.dureeMinutes, technicianIds: [j.technicianId], subject: `Entretien — ${clientName}`, nouvelleJournee: true })}>
              {formatDateShortFR(j.date)} — {j.technicianId === creneaux[0]?.technicianId ? creneaux[0].technicianNom : 'technicien'} (journée vide)
            </button>
          ))}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={onFermer}>Fermer</Button>
    </div>
  );
}
```
(Pour `nouvellesJournees`, remonter aussi `technicianNom` depuis l'edge — ajouter `technicianNom` dans `proposerPourContrat` en résolvant via `techniciens` — et afficher ce nom plutôt que l'astuce ci-dessus.)

- [ ] **Step 4 : `ContractModal`** —
  1. Extraire de `handlePlanifier` une fonction `preparerCarte()` qui fait `ensureEntretienCard` + construit `schedulingItem` et le retourne (utilisée par `handlePlanifier` et par le CTA).
  2. État `const [creneauxOuverts, setCreneauxOuverts] = useState(false);`.
  3. Sous le bouton « Planifier » (même condition `badgeStatus === 'a_planifier'`) : un bouton `variant="default"` « Trouver le créneau optimisé » (icône `Sparkles`) → `async () => { const item = await preparerCarte(); if (item) { setSchedulingItem(item); setCreneauxOuverts(true); } }`.
  4. `{creneauxOuverts && schedulingItem && <CreneauxProposesPanel orgId={organization?.id} contractId={contractId} clientName={contract.client_name} onChoisir={async (slot) => { if (slot.nouvelleJournee) { setCreneauxOuverts(false); setSchedulingOpen(true); return; } await handleConfirmScheduling([{ ...slot, endTime: slot.endTime }]); setCreneauxOuverts(false); }} onFermer={() => setCreneauxOuverts(false)} />}` — une « nouvelle journée » ouvre l'assistant classique pré-positionné (le choix d'heure reste humain).
  5. `handleConfirmScheduling` : ajouter `queryClient.invalidateQueries({ queryKey: tourneeKeys.all(orgId) })` (le classement change dès qu'un RDV est posé). Import `tourneeKeys`.
  6. Vérifier que `createAppointmentBatch` accepte `endTime` calculé si `null` : sinon calculer `endTime` = `startTime + duration` avec `computeEndTime` de `@/lib/utils` avant l'appel.

- [ ] **Step 5 : build, lint, vérification réelle, commit**

`npx vite build && npm run lint:errors`. Test réel par Eric (ou via le serveur de dev d'Eric) : ouvrir un contrat d'entretien « à planifier » d'un client de Castres → « Trouver le créneau optimisé » → 4 cartes cohérentes avec l'onglet Tournées → clic → RDV dans Planning + carte `planifie`. Coller la réponse JSON de l'edge dans le rapport de tâche.

```bash
git add src/shared/services/tournees.service.js src/shared/hooks/cacheKeys.js src/shared/hooks/useTournees.js src/apps/artisan/components/entretiens/CreneauxProposesPanel.jsx src/apps/artisan/components/entretiens/ContractModal.jsx
git commit -m "feat(entretiens): CTA « Trouver le créneau optimisé » — 4 créneaux explicables, pose par le chemin existant"
```

---

### Task 9 : vérification de bout en bout + documentation

- [ ] **Step 1 : tests + qualité** — `node --test "scripts/tournee/*.test.mjs" && npm run audit:quality && npx vite build`.
- [ ] **Step 2 : critères de succès de la spec (§4.6)** — cocher chacun avec la preuve (sortie de commande, JSON de l'edge, requête SQL) ; ce qui n'est pas vérifié est dit **non vérifié**, pas « fait ».
- [ ] **Step 3 : déploiement Mayer** — renseigner les compétences des techniciens dans Settings → Équipe (Antoine : clim + …, Ludovic : sans clim) — geste Eric, à lister dans le rapport.
- [ ] **Step 4 : proposition CLAUDE.md** — appender dans `.claude/proposed-updates.md` (PENDING) une section « Module Tournées / outils machine-usable » : moteur pur + copies `_shared/tournee` synchronisées (ne jamais éditer les copies, `npm run sync:tournee-engine`), edge `slots-propose`, compétences = `team_members.specialties` (vide = polyvalent), BAN à la saisie + `client_set_location`, gotcha `chat` Hermes. Pas d'édition directe de CLAUDE.md sans accord.
- [ ] **Step 5 : tâches de suite (spawn_task)** — (a) SMS de confirmation après pose (gabarit `confirmation_rdv` + onglet Settings SMS) ; (b) `settings.tournees` éditable dans `/settings` (dette connue, + `horizon_ouverture_jours`) ; (c) renommage profil Hermes `majordhome` → `mayer` ; (d) tranche 2 : RPC `entretien_book_slot` + `identify_client`.
- [ ] **Step 6 : revue par agent** (demandée par Eric) — dispatcher une revue de code sur la plage de commits de la tranche (superpowers:requesting-code-review), traiter les findings critiques, rapporter.
