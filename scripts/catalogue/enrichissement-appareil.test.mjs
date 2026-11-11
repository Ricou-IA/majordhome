// Recherche web d'un appareil installé (src/lib/catalogue/enrichissementAppareil.js) — module PUR, copié pour l'edge
// equipment-model-enrich. Run : node --test scripts/catalogue/enrichissement-appareil.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirePromptAppareil, lireAppareils } from '../../src/lib/catalogue/enrichissementAppareil.js';

const CHAMPS = [
  { key: 'power_nominal_kw', label: 'Puissance nominale', unit: 'kW', type: 'number' },
  { key: 'efficiency_pct', label: 'Rendement', unit: '%', type: 'number' },
];

const appareil = (extra = {}) => ({
  brand: 'Edilkamin', model_name: 'Kelly', reference: '1234567', category: 'Poêle à granulés', en_vente: false,
  photo_url: 'https://www.edilkamin.com/kelly.jpg', notice_url: 'https://www.edilkamin.com/kelly.pdf', fiche_url: null,
  source_urls: ['https://www.edilkamin.com/kelly'], specs: { power_nominal_kw: '9,5 kW', efficiency_pct: 90 }, remarque: null, ...extra,
});

test('construirePromptAppareil : marque, modèle, type et chaque champ', () => {
  const p = construirePromptAppareil({ brand: 'EDILKAMIN', model: 'Kelly', typeLabel: 'Poêle à granulés' }, CHAMPS);
  for (const attendu of ['EDILKAMIN', 'Kelly', 'Poêle à granulés', 'power_nominal_kw', 'efficiency_pct', '"appareils"']) {
    assert.ok(p.includes(attendu), `prompt sans ${attendu}`);
  }
});

test('lireAppareils : bloc json, deux candidats, valeurs converties', () => {
  const texte = `Voici.\n\`\`\`json\n${JSON.stringify({ appareils: [appareil(), appareil({ model_name: 'Kelly 2' })] })}\n\`\`\``;
  const r = lireAppareils(texte, CHAMPS);
  assert.equal(r.erreur, undefined);
  assert.equal(r.appareils.length, 2);
  assert.equal(r.appareils[0].specs.power_nominal_kw, 9.5);
  assert.equal(r.appareils[0].en_vente, false);
  assert.deepEqual(r.appareils[0].source_urls, ['https://www.edilkamin.com/kelly']);
});

test('lireAppareils : URL non publique écartée, appareil sans nom écarté, 3 au plus', () => {
  const liste = [
    appareil({ photo_url: 'http://127.0.0.1/x.jpg', source_urls: ['http://localhost/a', 'https://ok.fr/b'] }),
    appareil({ model_name: '' }),
    appareil({ brand: null }),
    appareil({ model_name: 'A' }), appareil({ model_name: 'B' }), appareil({ model_name: 'C' }),
  ];
  const r = lireAppareils(JSON.stringify({ appareils: liste }), CHAMPS);
  assert.equal(r.appareils.length, 3);
  assert.equal(r.appareils[0].photo_url, null);
  assert.deepEqual(r.appareils[0].source_urls, ['https://ok.fr/b']);
  assert.deepEqual(r.appareils.map((a) => a.model_name), ['Kelly', 'A', 'B']);
});

test('lireAppareils : réponse illisible, aucun appareil', () => {
  assert.equal(lireAppareils('pas de json', CHAMPS).erreur, 'reponse_illisible');
  assert.equal(lireAppareils('{"appareils": []}', CHAMPS).erreur, 'aucun_appareil');
  assert.equal(lireAppareils('{"appareils": [{"brand": "X"}]}', CHAMPS).erreur, 'aucun_appareil');
});

test('lireAppareils : textes bornés à 200 caractères', () => {
  const r = lireAppareils(JSON.stringify({ appareils: [appareil({ model_name: 'K'.repeat(400) })] }), CHAMPS);
  assert.equal(r.appareils[0].model_name.length, 200);
});
