// Tests wizardState.js — état pur du wizard Thermique (Task 11 plan 4).
// Chaque action : cas nominal + immutabilité (Object.freeze profond du state d'entrée —
// les modules ESM sont en mode strict, toute mutation d'un objet gelé lève TypeError).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialWizardState, wizardReducer, toStudyInput,
  draftKey, loadDraft, saveDraft, clearDraft,
} from '../../src/apps/thermique/lib/wizardState.js';
import { buildThermiqueConfig } from '../../src/apps/thermique/lib/thermiqueConfig.js';

const CONFIG = { prix_kwh: 0.25 };
const CFG = buildThermiqueConfig(null);

function deepFreeze(obj) {
  Object.freeze(obj);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return obj;
}

/** État initial gelé en profondeur — le harnais d'immutabilité de tous les tests d'action. */
const frozen = () => deepFreeze(initialWizardState(CONFIG));

const GAILLAC = { nom: 'Gaillac', insee: '810099', dept: '81', cp: '81600', altitude: 134, dju: 1943 };

test('initialWizardState : shape verrouillé (= input jsonb) + prix kWh depuis config', () => {
  const s = initialWizardState(CONFIG);
  assert.equal(s.step, 1);
  assert.equal(s.studyId, null);
  assert.deepEqual(s.contexte, {
    titre: '', clientId: null, leadId: null, commune: null, dept: null, altitude: null,
    dju: null, djuFallback: false, annee: null, typeVentilation: 'vmc-sf-auto',
    isolation: 'non-isole', combleIsolation: 'isole', sousSolAvecOuvertures: false, relance: false,
  });
  assert.deepEqual(s.dessin, {
    nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
    niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }], pieces: [], ouvertures: [],
  });
  assert.deepEqual(s.compositions, {
    familles: {
      murs: { mode: 'defaut', u: null }, plancherBas: { mode: 'defaut', u: null },
      plafondToiture: { mode: 'defaut', u: null },
      fenetre: { u: 2.8 }, porteFenetre: { u: 2.8 }, porte: { u: 3.5 },
    },
    exceptions: { parois: {}, ouvertures: {} },
  });
  assert.deepEqual(s.pac, { regime: 45, mode: null, pacId: null, points: [], scopManuel: null, prixKwh: 0.25 });
  assert.equal(s.savedResults, null);
  // Deux appels → objets indépendants (aucune référence partagée mutable)
  const s2 = initialWizardState(CONFIG);
  assert.notEqual(s.contexte, s2.contexte);
  assert.notEqual(s.dessin.niveaux, s2.dessin.niveaux);
  assert.notEqual(s.compositions.familles.murs, s2.compositions.familles.murs);
});

test('LOAD : remplace l’état entier (copie de surface, pas la même référence)', () => {
  const loaded = { ...initialWizardState(CONFIG), step: 3 };
  const s = wizardReducer(frozen(), { type: 'LOAD', state: deepFreeze(loaded) });
  assert.equal(s.step, 3);
  assert.notEqual(s, loaded);
  assert.deepEqual(s, loaded);
});

test('SET_STEP : change step sans toucher au reste', () => {
  const before = frozen();
  const s = wizardReducer(before, { type: 'SET_STEP', step: 2 });
  assert.equal(s.step, 2);
  assert.equal(s.contexte, before.contexte); // les branches non touchées gardent leur référence
  assert.equal(before.step, 1);
});

test('PATCH_CONTEXTE : merge partiel du contexte', () => {
  const before = frozen();
  const s = wizardReducer(before, { type: 'PATCH_CONTEXTE', patch: { titre: 'Maison T4', annee: 1982 } });
  assert.equal(s.contexte.titre, 'Maison T4');
  assert.equal(s.contexte.annee, 1982);
  assert.equal(s.contexte.typeVentilation, 'vmc-sf-auto'); // le reste survit
  assert.equal(s.dessin, before.dessin);
});

test('SET_COMMUNE : pose commune + dept + altitude + dju + djuFallback d’un coup', () => {
  const before = wizardReducer(frozen(), { type: 'PATCH_CONTEXTE', patch: { titre: 'Étude' } });
  const s = wizardReducer(deepFreeze(before), { type: 'SET_COMMUNE', commune: GAILLAC, dju: 1943, djuFallback: false });
  assert.deepEqual(s.contexte.commune, GAILLAC);
  assert.equal(s.contexte.dept, '81');
  assert.equal(s.contexte.altitude, 134);
  assert.equal(s.contexte.dju, 1943);
  assert.equal(s.contexte.djuFallback, false);
  assert.equal(s.contexte.titre, 'Étude'); // les autres champs contexte survivent
  // Commune sans DJU → fallback départemental fourni par le caller
  const s2 = wizardReducer(deepFreeze(s), {
    type: 'SET_COMMUNE', commune: { ...GAILLAC, nom: 'Ailleurs', dju: null }, dju: 2000, djuFallback: true,
  });
  assert.equal(s2.contexte.dju, 2000);
  assert.equal(s2.contexte.djuFallback, true);
});

test('SET_DESSIN : remplace le dessin entier', () => {
  const before = frozen();
  const dessin = { ...before.dessin, nord: 90, plancherBasType: 'sous-sol' };
  const s = wizardReducer(before, { type: 'SET_DESSIN', dessin: deepFreeze(dessin) });
  assert.equal(s.dessin.nord, 90);
  assert.equal(s.dessin.plancherBasType, 'sous-sol');
  assert.equal(s.contexte, before.contexte);
});

test('PATCH_COMPOSITIONS : merge des familles, exceptions intactes', () => {
  const withException = wizardReducer(frozen(), { type: 'SET_EXCEPTION_PAROI', cle: 'p1:murs', u: 0.3 });
  const s = wizardReducer(deepFreeze(withException), {
    type: 'PATCH_COMPOSITIONS', patch: { murs: { mode: 'valeur', u: 0.42 }, fenetre: { u: 1.4 } },
  });
  assert.deepEqual(s.compositions.familles.murs, { mode: 'valeur', u: 0.42 });
  assert.equal(s.compositions.familles.fenetre.u, 1.4);
  assert.deepEqual(s.compositions.familles.porte, { u: 3.5 });          // famille non patchée survit
  assert.deepEqual(s.compositions.exceptions.parois, { 'p1:murs': { u: 0.3 } }); // exceptions intactes
});

test('SET_EXCEPTION_PAROI : pose { u }, null retire la clé', () => {
  const s1 = wizardReducer(frozen(), { type: 'SET_EXCEPTION_PAROI', cle: 'p1:murs', u: 0.3 });
  assert.deepEqual(s1.compositions.exceptions.parois, { 'p1:murs': { u: 0.3 } });
  const s2 = wizardReducer(deepFreeze(s1), { type: 'SET_EXCEPTION_PAROI', cle: 'p2:plancherBas', u: 0.5 });
  assert.deepEqual(s2.compositions.exceptions.parois, { 'p1:murs': { u: 0.3 }, 'p2:plancherBas': { u: 0.5 } });
  const s3 = wizardReducer(deepFreeze(s2), { type: 'SET_EXCEPTION_PAROI', cle: 'p1:murs', u: null });
  assert.deepEqual(s3.compositions.exceptions.parois, { 'p2:plancherBas': { u: 0.5 } });
  assert.equal(s3.compositions.familles, s2.compositions.familles); // familles non touchées
});

test('SET_EXCEPTION_OUVERTURE : pose { u }, null retire la clé', () => {
  const s1 = wizardReducer(frozen(), { type: 'SET_EXCEPTION_OUVERTURE', ouvertureId: 'o1', u: 1.2 });
  assert.deepEqual(s1.compositions.exceptions.ouvertures, { o1: { u: 1.2 } });
  const s2 = wizardReducer(deepFreeze(s1), { type: 'SET_EXCEPTION_OUVERTURE', ouvertureId: 'o1', u: null });
  assert.deepEqual(s2.compositions.exceptions.ouvertures, {});
  assert.deepEqual(s2.compositions.exceptions.parois, {}); // parois intactes
});

test('PATCH_PAC : merge partiel', () => {
  const before = frozen();
  const s = wizardReducer(before, { type: 'PATCH_PAC', patch: { regime: 35, pacId: 'pac-7' } });
  assert.equal(s.pac.regime, 35);
  assert.equal(s.pac.pacId, 'pac-7');
  assert.equal(s.pac.prixKwh, 0.25); // le reste survit
});

test('SET_STUDY_ID : pose studyId sans toucher au reste', () => {
  const before = frozen();
  const s = wizardReducer(before, { type: 'SET_STUDY_ID', studyId: 'etude-42' });
  assert.equal(s.studyId, 'etude-42');
  assert.equal(s.contexte, before.contexte); // les branches non touchées gardent leur référence
  assert.equal(s.pac, before.pac);
  assert.equal(before.studyId, null);
});

test('CLEAR_SAVED_RESULTS : vide savedResults, le reste survit (références intactes)', () => {
  const study = {
    id: 'etude-1', engine_version: '1.0.0',
    input: { contexte: { titre: 'Maison' } }, results: { bilan: { total: 8000 } },
  };
  const loaded = wizardReducer(frozen(), { type: 'LOAD_STUDY', study: deepFreeze(study), config: CONFIG });
  assert.ok(loaded.savedResults); // pré-condition : l'étude rouverte porte des résultats figés
  const s = wizardReducer(deepFreeze(loaded), { type: 'CLEAR_SAVED_RESULTS' });
  assert.equal(s.savedResults, null);
  assert.equal(s.studyId, 'etude-1');   // l'id reste : le save suivant fait UPDATE
  assert.equal(s.contexte, loaded.contexte);
  assert.equal(s.dessin, loaded.dessin);
});

test('LOAD_STUDY : hydrate depuis input, savedResults depuis results + engine_version, step 4', () => {
  const study = {
    id: 'etude-1',
    engine_version: 3,
    input: {
      contexte: { titre: 'Maison T4', dept: '81', altitude: 134, dju: 1943 },
      dessin: {
        nord: 90, plancherBasType: 'sous-sol', toitureType: 'rampant',
        niveaux: [{ id: 'n1', nom: 'RDC', hauteur: 260 }], pieces: [{ id: 'p1' }], ouvertures: [],
      },
      compositions: {
        familles: { murs: { mode: 'valeur', u: 0.4 } },
        exceptions: { parois: { 'p1:murs': { u: 0.3 } }, ouvertures: {} },
      },
      pac: { regime: 35, pacId: 'pac-7' },
    },
    results: { bilan: { total: 8000 } },
  };
  const s = wizardReducer(frozen(), { type: 'LOAD_STUDY', study: deepFreeze(study), config: CONFIG });
  assert.equal(s.step, 4);
  assert.equal(s.studyId, 'etude-1');
  assert.equal(s.contexte.titre, 'Maison T4');
  assert.equal(s.contexte.dept, '81');
  assert.equal(s.contexte.typeVentilation, 'vmc-sf-auto'); // champ absent de input → défaut
  assert.deepEqual(s.dessin, study.input.dessin);
  assert.deepEqual(s.compositions.familles.murs, { mode: 'valeur', u: 0.4 });
  assert.equal(s.compositions.familles.fenetre.u, 2.8);    // famille absente → défaut
  assert.deepEqual(s.compositions.exceptions.parois, { 'p1:murs': { u: 0.3 } });
  assert.equal(s.pac.regime, 35);
  assert.equal(s.pac.prixKwh, 0.25);                        // absent de input.pac → défaut config
  assert.deepEqual(s.savedResults, { results: { bilan: { total: 8000 } }, engineVersion: 3 });
});

test('LOAD_STUDY : étude sans results (brouillon) → savedResults null', () => {
  const study = { id: 'etude-2', engine_version: 3, input: { contexte: { titre: 'Brouillon' } }, results: null };
  const s = wizardReducer(frozen(), { type: 'LOAD_STUDY', study: deepFreeze(study), config: CONFIG });
  assert.equal(s.studyId, 'etude-2');
  assert.equal(s.savedResults, null);
  assert.equal(s.step, 4);
  assert.deepEqual(s.dessin, initialWizardState(CONFIG).dessin); // input partiel → défauts
});

test('RESET : retour à l’état initial', () => {
  const dirty = wizardReducer(frozen(), { type: 'PATCH_CONTEXTE', patch: { titre: 'x' } });
  const s = wizardReducer(deepFreeze({ ...dirty, step: 3 }), { type: 'RESET', config: CONFIG });
  assert.deepEqual(s, initialWizardState(CONFIG));
});

test('action inconnue : même référence d’état', () => {
  const before = frozen();
  assert.equal(wizardReducer(before, { type: 'NOPE' }), before);
});

test('toStudyInput : strip step/studyId/savedResults', () => {
  const state = frozen();
  const input = toStudyInput(state);
  assert.deepEqual(Object.keys(input).sort(), ['compositions', 'contexte', 'dessin', 'pac', 'saisie']);
  assert.equal(input.contexte, state.contexte); // pas de copie inutile (le state est immuable)
  assert.equal(input.dessin, state.dessin);
});

test('toStudyInput : purge les exceptions orphelines (pièce/ouverture supprimées), garde les valides', () => {
  const base = initialWizardState(CONFIG);
  const state = deepFreeze({
    ...base,
    dessin: {
      ...base.dessin,
      pieces: [{ id: 'p-vivante', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20, polygone: [] }],
      ouvertures: [{ id: 'o-vivante', pieceId: 'p-vivante', segmentIndex: 0, type: 'fenetre', largeur: 120, hauteur: 130, position: 0 }],
    },
    compositions: {
      ...base.compositions,
      exceptions: {
        parois: { 'p-vivante:murs': { u: 0.5 }, 'p-morte:murs': { u: 0.4 }, 'p-morte:plancherBas': { u: 0.3 } },
        ouvertures: { 'o-vivante': { u: 1.1 }, 'o-morte': { u: 2.2 } },
      },
    },
  });
  const input = toStudyInput(state);
  assert.deepEqual(input.compositions.exceptions.parois, { 'p-vivante:murs': { u: 0.5 } });
  assert.deepEqual(input.compositions.exceptions.ouvertures, { 'o-vivante': { u: 1.1 } });
  // Immutabilité : le state d'entrée (gelé) n'est pas touché, ses exceptions non plus
  assert.equal(Object.keys(state.compositions.exceptions.parois).length, 3);
  // Les familles ne sont pas copiées inutilement
  assert.equal(input.compositions.familles, state.compositions.familles);
});

test('brouillon : round-trip via localStorage mocké, clé namespacée user', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    assert.equal(draftKey('u1'), 'thermal-draft:u1');
    assert.equal(loadDraft('u1'), null);
    const state = initialWizardState(CONFIG);
    saveDraft('u1', state);
    assert.deepEqual(loadDraft('u1'), JSON.parse(JSON.stringify(state)));
    assert.equal(loadDraft('u2'), null); // scope par user (convention P1.9)
    clearDraft('u1');
    assert.equal(loadDraft('u1'), null);
    // Draft corrompu → null, pas de crash
    store.set(draftKey('u3'), '{oops');
    assert.equal(loadDraft('u3'), null);
    // Storage qui lève (quota, sécurité) → no-op
    globalThis.localStorage = {
      getItem: () => { throw new Error('boom'); },
      setItem: () => { throw new Error('boom'); },
      removeItem: () => { throw new Error('boom'); },
    };
    assert.equal(loadDraft('u1'), null);
    assert.doesNotThrow(() => saveDraft('u1', state));
    assert.doesNotThrow(() => clearDraft('u1'));
  } finally {
    delete globalThis.localStorage;
  }
});

test('brouillon : localStorage indisponible (node nu) → null / no-op sans crash', () => {
  assert.equal('localStorage' in globalThis, false); // pré-condition du test
  assert.equal(loadDraft('u1'), null);
  assert.doesNotThrow(() => saveDraft('u1', { step: 1 }));
  assert.doesNotThrow(() => clearDraft('u1'));
});

test('initialWizardState : saisie paramétrique par défaut', () => {
  const s = initialWizardState(CFG);
  assert.equal(s.saisie.modeSaisie, 'parametrique');
  assert.equal(s.saisie.niveaux[0].rang, 0);
  assert.deepEqual(s.saisie.pieces, []);
});

test('SET_SAISIE remplace la saisie', () => {
  const s0 = initialWizardState(CFG);
  const saisie = { ...s0.saisie, pieces: [{ id: 'x', niveauId: 'rdc', chauffee: true }] };
  const s1 = wizardReducer(s0, { type: 'SET_SAISIE', saisie });
  assert.equal(s1.saisie.pieces.length, 1);
});

test('toStudyInput inclut saisie', () => {
  const s = initialWizardState(CFG);
  const input = toStudyInput(s);
  assert.ok(input.saisie);
  assert.equal(input.saisie.modeSaisie, 'parametrique');
});

test('#2 toStudyInput conserve les exceptions U d une pièce paramétrique (union dessin+saisie)', () => {
  const s0 = initialWizardState(CFG);
  const state = {
    ...s0,
    saisie: { ...s0.saisie, pieces: [{ id: 'sej', niveauId: 'rdc', chauffee: true, thetaInt: 20 }] },
    compositions: {
      ...s0.compositions,
      exceptions: { parois: { 'sej:murs': { u: 0.25 } }, ouvertures: {} },
    },
  };
  const input = toStudyInput(state);
  assert.deepEqual(input.compositions.exceptions.parois, { 'sej:murs': { u: 0.25 } });
});
