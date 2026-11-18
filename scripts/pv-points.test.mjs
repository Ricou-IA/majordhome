// Points du PV de réception : gabarits, déclaration de l'entreprise, confirmation du client.
// Lancer : node --test scripts/pv-points.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GABARITS_RECEPTION,
  LIBELLES_GABARIT,
  GARANTIES_RECEPTION,
  pointsDuGabarit,
  declarationComplete,
  figerDeclaration,
  figerPointsClient,
  memeDeclaration,
} from '../src/lib/pvPoints.js';

// ASCII imprimable, Latin-1 (160 a 255), apostrophe typographique et oe : ce que Helvetica rend.
const sureEnPdf = (texte) => texte.length > 0 && [...texte].every((c) => {
  const n = c.codePointAt(0);
  return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || n === 8217 || n === 339;
});

test('six gabarits, le générique en dernier', () => {
  assert.deepEqual([...GABARITS_RECEPTION], ['poele_granules', 'poele_buches', 'pac_air_air', 'pac_air_eau', 'chauffe_eau', 'generique']);
  for (const g of GABARITS_RECEPTION) assert.ok(LIBELLES_GABARIT[g]);
});

test('générique : les points communs seuls, dans l\'ordre', () => {
  const p = pointsDuGabarit('generique');
  assert.deepEqual(p.client.map((x) => x.cle), ['c_notice', 'c_demonstration', 'c_entretien']);
  assert.deepEqual(p.entreprise.map((x) => x.cle), ['e_mise_en_service', 'e_conforme_devis']);
});

test('poêle à granulés : communs puis propres', () => {
  const p = pointsDuGabarit('poele_granules');
  assert.deepEqual(p.client.map((x) => x.cle), ['c_notice', 'c_demonstration', 'c_entretien', 'c_combustible', 'c_amenee_air']);
  assert.deepEqual(p.entreprise.map((x) => x.cle), ['e_mise_en_service', 'e_conforme_devis', 'e_conduit', 'e_distances', 'e_reglages', 'e_differentiel']);
});

test('code inconnu, vide ou nul : générique', () => {
  for (const c of ['inconnu', '', null, undefined]) assert.equal(pointsDuGabarit(c).gabarit, 'generique');
});

test('clés uniques par gabarit, textes non vides et sûrs pour le PDF', () => {
  for (const g of GABARITS_RECEPTION) {
    const { client, entreprise } = pointsDuGabarit(g);
    const cles = [...client, ...entreprise].map((x) => x.cle);
    assert.equal(new Set(cles).size, cles.length);
    for (const x of [...client, ...entreprise]) assert.ok(sureEnPdf(x.texte), x.cle);
  }
  assert.equal(GARANTIES_RECEPTION.length, 3);
  for (const t of GARANTIES_RECEPTION) assert.ok(sureEnPdf(t), t);
});

test('déclaration : rien n\'est supposé', () => {
  assert.equal(declarationComplete('generique', {}), false);
  assert.equal(declarationComplete('generique', { e_mise_en_service: 'oui' }), false);
  assert.equal(declarationComplete('generique', { e_mise_en_service: 'oui', e_conforme_devis: 'sans_objet' }), true);
  assert.equal(declarationComplete('generique', { e_mise_en_service: 'oui', e_conforme_devis: 'peut-etre' }), false);
});

test('figer la déclaration : texte repris du module, clé étrangère refusée', () => {
  const r = figerDeclaration('generique', { e_mise_en_service: 'oui', e_conforme_devis: 'non' });
  assert.deepEqual(r.points[1], { cle: 'e_conforme_devis', texte: pointsDuGabarit('generique').entreprise[1].texte, reponse: 'non' });
  assert.deepEqual(figerDeclaration('generique', { e_mise_en_service: 'oui' }), { ok: false, code: 'declaration_incomplete' });
  assert.deepEqual(figerDeclaration('generique', { e_mise_en_service: 'oui', e_conforme_devis: 'oui', e_conduit: 'oui' }), { ok: false, code: 'point_inconnu' });
});

test('figer les points du client : non coché = non confirmé, clé étrangère refusée', () => {
  const r = figerPointsClient('generique', ['c_notice']);
  assert.deepEqual(r.points.map((p) => p.confirme), [true, false, false]);
  assert.deepEqual(figerPointsClient('generique', ['c_filtres']), { ok: false, code: 'point_inconnu' });
  assert.equal(figerPointsClient('generique', []).ok, true);
});

test('même déclaration : renvoyer sans rien changer ne prépare pas à nouveau', () => {
  const reponses = { e_mise_en_service: 'oui', e_conforme_devis: 'sans_objet' };
  const enregistres = figerDeclaration('generique', reponses).points;
  assert.equal(memeDeclaration('generique', reponses, enregistres), true);
  // Une réponse changée, un point en moins ou en trop : différent.
  assert.equal(memeDeclaration('generique', { ...reponses, e_conforme_devis: 'non' }, enregistres), false);
  assert.equal(memeDeclaration('generique', { e_mise_en_service: 'oui' }, enregistres), false);
  assert.equal(memeDeclaration('generique', { ...reponses, e_conduit: 'oui' }, enregistres), false);
  // Rien d'enregistré (pas encore préparé) ou enregistrement illisible : différent.
  assert.equal(memeDeclaration('generique', reponses, []), false);
  assert.equal(memeDeclaration('generique', reponses, null), false);
  assert.equal(memeDeclaration('generique', reponses, undefined), false);
  // Enregistrement d'un autre gabarit (points différents) : différent.
  const granules = { e_mise_en_service: 'oui', e_conforme_devis: 'oui', e_conduit: 'oui', e_distances: 'oui', e_reglages: 'oui', e_differentiel: 'oui' };
  assert.equal(memeDeclaration('generique', reponses, figerDeclaration('poele_granules', granules).points), false);
  // Texte enregistré qui n'est plus celui du module : le serveur l'écrirait autrement, donc différent.
  assert.equal(memeDeclaration('generique', reponses, enregistres.map((pt, i) => (i === 0 ? { ...pt, texte: 'ancien' } : pt))), false);
});
