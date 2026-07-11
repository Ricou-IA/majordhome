// scripts/dossier-docs.test.mjs
// Tests du modèle pur de la notice descriptive (src/apps/solaire/lib/dossierDocs.js).
// Run : node --test scripts/dossier-docs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNoticeModel, compassLabel, parseAddressFR } from '../src/apps/solaire/lib/dossierDocs.js';

const CONFIG = { panel_power_wc: 500 };

const SIMULATION = {
  client_name: 'Eric Pudebat',
  client_address: '12 rue de la République 81600 Gaillac',
  inputs: { roof: { surfaceM2: 80 }, selectedKwc: 6 },
  results: { selectedKwc: 6, recommendedKwc: 4.5 },
};

const DOSSIER = {
  cadastre: {
    commune_insee: '81099',
    nom_com: 'Gaillac',
    parcelles: [
      { idu: '81099000BS0632', prefixe: '000', section: 'BS', numero: '0632', superficie_m2: 4308 },
      { idu: '81099000BS0633', prefixe: '000', section: 'BS', numero: '0633', superficie_m2: 120 },
    ],
  },
  abf: {
    secteur_protege: true,
    protections: [{ suptype: 'ac1', nom: 'PDA de Gaillac', type: 'Périmètre des abords' }],
    source: 'gpu',
    checked_at: '2026-07-11T10:00:00.000Z',
  },
  material: { module_marque: 'DualSun', module_modele: 'Flash 500', module_aspect: 'full_black' },
  roof_geometry: {
    source: 'drawn_pans',
    pans: [
      { pitchDeg: 32, azimuthCompass: 180, slopeAreaM2: 45.2 },
      { pitchDeg: 30, azimuthCompass: 90, slopeAreaM2: 34.8 },
    ],
  },
};

test('compassLabel — azimut compas → point cardinal (8 points)', () => {
  assert.equal(compassLabel(180), 'S');
  assert.equal(compassLabel(90), 'E');
  assert.equal(compassLabel(0), 'N');
  assert.equal(compassLabel(315), 'NO');
  assert.equal(compassLabel(null), '—');
});

test('buildNoticeModel — modèle complet (client, terrain, projet, pans, insertion ABF)', () => {
  const m = buildNoticeModel({ dossier: DOSSIER, simulation: SIMULATION, config: CONFIG });
  assert.equal(m.client.name, 'Eric Pudebat');
  assert.equal(m.terrain.adresse, '12 rue de la République 81600 Gaillac');
  assert.equal(m.terrain.commune, 'Gaillac (81099)');
  assert.deepEqual(m.terrain.parcelles.map((p) => p.ref), ['BS 0632', 'BS 0633']);
  assert.equal(m.terrain.superficieTotaleM2, 4428);
  // projet : kWc sélectionné, nb modules depuis la puissance unitaire
  assert.equal(m.projet.kwc, 6);
  assert.equal(m.projet.panels, 12); // 6000 Wc / 500 Wc
  assert.equal(m.projet.materiel, 'DualSun Flash 500');
  assert.match(m.projet.aspectLabel, /noir uniforme/i);
  assert.equal(m.projet.pans.length, 2);
  assert.equal(m.projet.pans[0].orientation, 'S');
  assert.equal(m.projet.pans[0].pitchDeg, 32);
  // description partagée avec le CERFA
  assert.match(m.projet.description, /12 modules photovolta/);
  assert.match(m.projet.description, /surimposition/);
  // insertion : paragraphe renforcé ABF avec le nom de la protection
  assert.equal(m.insertion.abfProtege, true);
  assert.match(m.insertion.paragraphs.join(' '), /PDA de Gaillac/);
  assert.match(m.insertion.paragraphs.join(' '), /noir uniforme|full black/i);
});

test('parseAddressFR — formats BAN courants → { numero, voie, code_postal, localite }', () => {
  assert.deepEqual(parseAddressFR('12 rue de la République 81600 Gaillac'), {
    numero: '12', voie: 'rue de la République', lieudit: '', code_postal: '81600', localite: 'Gaillac',
  });
  assert.deepEqual(parseAddressFR('4 bis Chemin des Vignes 81150 Marssac-sur-Tarn'), {
    numero: '4 bis', voie: 'Chemin des Vignes', lieudit: '', code_postal: '81150', localite: 'Marssac-sur-Tarn',
  });
  // numéro avec lettre accolée (7b, 12B) : le n° ne doit PAS être avalé par la voie
  assert.deepEqual(parseAddressFR('7b Route des Bardis 31320 Rebigue'), {
    numero: '7b', voie: 'Route des Bardis', lieudit: '', code_postal: '31320', localite: 'Rebigue',
  });
  assert.deepEqual(parseAddressFR('12B Avenue Foch 31000 Toulouse'), {
    numero: '12B', voie: 'Avenue Foch', lieudit: '', code_postal: '31000', localite: 'Toulouse',
  });
  // « bis » accolé sans espace
  assert.deepEqual(parseAddressFR('7bis Rue du Pont 81000 Albi'), {
    numero: '7bis', voie: 'Rue du Pont', lieudit: '', code_postal: '81000', localite: 'Albi',
  });
  // sans numéro : tout dans la voie, CP/ville extraits
  assert.deepEqual(parseAddressFR('Lieu-dit Les Fargues 81300 Graulhet'), {
    numero: '', voie: 'Lieu-dit Les Fargues', lieudit: '', code_postal: '81300', localite: 'Graulhet',
  });
  // sans CP : best effort, tout en voie (éditable dans la modale)
  assert.deepEqual(parseAddressFR('Position GPS'), {
    numero: '', voie: 'Position GPS', lieudit: '', code_postal: '', localite: '',
  });
  assert.deepEqual(parseAddressFR(''), { numero: '', voie: '', lieudit: '', code_postal: '', localite: '' });
});

test('buildNoticeModel — sans matériel ni ABF ni pans → fallbacks propres, jamais undefined', () => {
  const m = buildNoticeModel({
    dossier: { cadastre: null, abf: null, material: null, roof_geometry: null },
    simulation: { ...SIMULATION, results: { selectedKwc: null, recommendedKwc: 4.5 } },
    config: CONFIG,
  });
  assert.equal(m.projet.kwc, 4.5); // fallback recommandé
  assert.equal(m.projet.panels, 9);
  assert.equal(m.projet.materiel, 'Modules photovoltaïques');
  assert.equal(m.projet.pans, null);
  assert.deepEqual(m.terrain.parcelles, []);
  assert.equal(m.terrain.superficieTotaleM2, null);
  assert.equal(m.insertion.abfProtege, false);
  assert.doesNotMatch(JSON.stringify(m), /undefined/);
});
