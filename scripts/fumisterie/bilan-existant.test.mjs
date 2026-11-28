// Bilan du conduit existant et justification du dimensionnement (src/lib/fumisterie/bilanExistant.js) :
// constats facultatifs, non-conformités avec leur article, rien de supposé conforme quand une donnée manque.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bilanConduitExistant, justificationDimensionnement } from '../../src/lib/fumisterie/bilanExistant.js';
import { buildPlanModel } from '../../src/lib/fumisterie/planModel.js';
import { chargerTarif, calculerSurTarif, lireData } from './lib/tarifReel.mjs';

const TRAD = { appareil_etanche_requis: false, combustibles: ['bois_buches'] };
const GRANULES = { appareil_etanche_requis: true, combustibles: ['pellets'] };
const G4 = { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'plafond', hsp1: 2.5, hEntree: 1.5, lHoriz: 0.5, raccord: 'emaille_12', hConduit: 6, boisseau: 1, chapeau: 'standard', kit_air: 0 };
const codes = (b) => b.nonConformites.map((n) => n.code);

test('hors tubage et raccordement seul : pas de bilan', () => {
  assert.equal(bilanConduitExistant(G4, 'G1', TRAD), null);
  assert.equal(bilanConduitExistant(G4, 'G6', TRAD), null);
  assert.ok(bilanConduitExistant(G4, 'G5', TRAD));
});

test('aucun constat : tout est à vérifier, rien n\'est déclaré conforme', () => {
  const b = bilanConduitExistant(G4, 'G4', TRAD);
  assert.deepEqual(b.nonConformites, []);
  for (const x of ['Vacuité', 'Épaisseur', 'Distance', 'Nature', 'Section', 'État', 'Débouché']) assert.ok(b.aVerifier.some((t) => t.includes(x)), x);
  assert.deepEqual(b.constats, ['Hauteur : 6,00 m']);
});

test('Tableau 13 : briques de 8 cm non conformes, de 12 cm conformes ; métal sans épaisseur exigée', () => {
  assert.deepEqual(codes(bilanConduitExistant({ ...G4, existantNature: 'briques', existantEpaisseur: 8 }, 'G4', TRAD)), ['existant_epaisseur']);
  assert.deepEqual(codes(bilanConduitExistant({ ...G4, existantNature: 'briques', existantEpaisseur: 12 }, 'G4', TRAD)), []);
  const metal = bilanConduitExistant({ ...G4, existantNature: 'metal' }, 'G4', TRAD);
  assert.ok(!metal.aVerifier.some((t) => t.includes('Épaisseur')));
});

test('distance au combustible : < 4 cm refus, < 16 cm à calculer, ≥ 16 cm rien', () => {
  const a = bilanConduitExistant({ ...G4, existantDistanceCombustible: 3 }, 'G4', TRAD).nonConformites[0];
  assert.match(a.texte, /refusé/); assert.match(a.source, /15\.2\.2/);
  const b = bilanConduitExistant({ ...G4, existantDistanceCombustible: 10 }, 'G4', TRAD).nonConformites[0];
  assert.match(b.texte, /à calculer/);
  assert.deepEqual(codes(bilanConduitExistant({ ...G4, existantDistanceCombustible: 16 }, 'G4', TRAD)), []);
});

test('vacuité, état et débouché', () => {
  assert.deepEqual(codes(bilanConduitExistant({ ...G4, existantVacuite: 'non' }, 'G4', TRAD)), ['existant_vacuite']);
  assert.deepEqual(codes(bilanConduitExistant({ ...G4, existantEtat: 'a_reprendre' }, 'G4', TRAD)), ['existant_etat']);
  assert.ok(bilanConduitExistant({ ...G4, existantEtat: 'fissure' }, 'G4', TRAD).aVerifier.some((t) => /fumigène/.test(t)));
  assert.deepEqual(codes(bilanConduitExistant({ ...G4, existantDebouche: 'non_conforme' }, 'G4', TRAD)), ['existant_debouche']);
  const ok = bilanConduitExistant({ ...G4, existantVacuite: 'oui', existantEtat: 'bon', existantDebouche: 'conforme' }, 'G4', TRAD);
  assert.deepEqual(ok.nonConformites, []);
  assert.ok(ok.constats.some((t) => /ogive passée/.test(t)));
});

test('étanche granulés : section minimale du conduit existant selon le Ø (Cahier 3708)', () => {
  const r = { ...G4, diametre: 80, existantSectionA: 13, existantSectionB: 20 };
  assert.deepEqual(codes(bilanConduitExistant(r, 'G4K', GRANULES)), ['existant_section']);
  assert.deepEqual(codes(bilanConduitExistant({ ...r, existantSectionA: 15 }, 'G4K', GRANULES)), []);
  assert.deepEqual(codes(bilanConduitExistant(r, 'G4', TRAD)), []);
});

test('justification : notice par défaut, référence ajoutée, « non justifié » dit tel quel', () => {
  assert.deepEqual(justificationDimensionnement({}), { mode: 'notice', texte: 'Notice de l\'appareil' });
  assert.equal(justificationDimensionnement({ justification: 'logiciel', justificationReference: 'Cat-Draw 3.2' }).texte, 'Logiciel : Cat-Draw 3.2');
  assert.equal(justificationDimensionnement({ justification: 'non_justifie', justificationReference: 'x' }).texte, 'Non justifié');
});

test('fiche chantier d\'un G4 : le bilan et la justification sont imprimés, figés dans le résultat', async () => {
  const tarif = await chargerTarif();
  const releve = { ...G4, existantNature: 'briques', existantEpaisseur: 8, existantVacuite: 'oui', justification: 'abaque', justificationReference: 'Cahier 3590 Bois 10' };
  const resultat = calculerSurTarif(tarif, 'CFG-26', 'G4', releve);
  assert.ok(resultat.alertes.some((a) => a.code === 'existant_epaisseur' && a.niveau === 'warn'));
  assert.equal(resultat.justification, 'Abaque : Cahier 3590 Bois 10');
  const metre = { gabarit_code: 'G4', diametre: 150, finition: 'noir', created_at: '2026-11-28T09:00:00Z', releve, resultat };
  const m = buildPlanModel({ metre, configuration: { titre: 'Tubage' }, gabarit: lireData('gabarit-g4.json'), company: { name: 'Test' }, devis: null, variante: 'chantier' });
  assert.equal(m.chantier.justification, 'Abaque : Cahier 3590 Bois 10');
  assert.ok(m.chantier.bilan.nonConformites.some((n) => /Parois de 8 cm/.test(n.texte)));
  assert.ok(!m.chantier.alertes.some((t) => /Parois de 8 cm/.test(t)), 'non-conformité imprimée une seule fois (bilan)');
  const offre = buildPlanModel({ metre, configuration: null, gabarit: null, company: {}, devis: null, variante: 'offre' });
  assert.equal(offre.chantier, null);
});
