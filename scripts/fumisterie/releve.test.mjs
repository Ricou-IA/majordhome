// scripts/fumisterie/releve.test.mjs — validation du relevé contre les paramètres du gabarit G1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validerReleve, calculerMetre, champsAcorriger } from '../../src/lib/fumisterie/index.js';
import { messageChamp, titreChampsAcorriger } from '../../src/lib/fumisterie/messagesReleve.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';
import { ARTICLES, COMPOSANTS, MAPPING, GABARIT, CONFIGURATION, RELEVE } from './fixtures/g1-o150.mjs';

const base = { configuration: CONFIGURATION, gabarit: GABARIT, composants: COMPOSANTS, mapping: MAPPING, articles: ARTICLES, reglages: buildFumisterieConfig(null) };

test('relevé de la maquette : valide', () => {
  assert.deepEqual(validerReleve(GABARIT, RELEVE), { ok: true, erreurs: [] });
});
test('pente vidée → erreur nommée, et calculerMetre refuse de calculer (pas de 0 silencieux)', () => {
  const v = validerReleve(GABARIT, { ...RELEVE, pente: '' });
  assert.equal(v.ok, false);
  assert.equal(v.erreurs.length, 1);
  assert.match(v.erreurs[0], /Pente de toiture \(non renseigné\)/);
  assert.throws(() => calculerMetre({ ...base, releve: { ...RELEVE, pente: '' } }), /Relevé incomplet : Pente de toiture/);
});
test('pente 12° : valide (dans 0–60)', () => {
  assert.equal(validerReleve(GABARIT, { ...RELEVE, pente: 12 }).ok, true);
});
test('hors plage et choix invalide', () => {
  const v = validerReleve(GABARIT, { ...RELEVE, hBuse: 0.1, diametre: 155, finition: 'rouge' });
  assert.equal(v.erreurs.length, 3);
  assert.ok(v.erreurs.some((e) => /Hauteur de buse \(0,1 m hors plage 0,3–2 m\)/.test(e)));
  assert.ok(v.erreurs.some((e) => /Diamètre conduit/.test(e)));
  assert.ok(v.erreurs.some((e) => /Finition extérieure/.test(e)));
});
test('paramètres conditionnels : hsp2 masqué sans étage, decal masqué sans dévoiement → non exigés', () => {
  assert.equal(validerReleve(GABARIT, { ...RELEVE, nbEtages: 0, hsp2: '' }).ok, true);
  assert.equal(validerReleve(GABARIT, { ...RELEVE, angle: 0, decal: null }).ok, true);
  assert.equal(validerReleve(GABARIT, { ...RELEVE, nbEtages: 1, hsp2: '' }).ok, false);
});
test('gabarit absent → invalide (jamais de calcul sans paramètres à contrôler)', () => {
  assert.equal(validerReleve(null, RELEVE).ok, false);
});

test('champsAcorriger : un refus par champ, avec la plage et la valeur saisie', () => {
  assert.deepEqual(champsAcorriger(GABARIT, RELEVE), []);
  const [e] = champsAcorriger(GABARIT, { ...RELEVE, hBuse: 105 });
  assert.deepEqual({ cle: e.cle, code: e.code, min: e.min, max: e.max, valeur: e.valeur, unite: e.unite }, { cle: 'hBuse', code: 'hors_plage', min: 0.3, max: 2, valeur: 105, unite: 'm' });
  assert.equal(champsAcorriger(GABARIT, { ...RELEVE, pente: '' })[0].code, 'vide');
  assert.equal(champsAcorriger(GABARIT, { ...RELEVE, diametre: 999 })[0].code, 'choix');
  assert.equal(champsAcorriger(null, RELEVE).length, 0);
  // Les chaînes de validerReleve ne changent pas (même source).
  assert.match(validerReleve(GABARIT, { ...RELEVE, hBuse: 105 }).erreurs[0], /Hauteur de buse \(105 m hors plage 0,3–2 m\)/);
});
test('option absente du tronçon options : jamais à corriger', () => {
  const avecOptions = { ...GABARIT, troncons: [...GABARIT.troncons, { type: 'options', parametres: [{ cle: 'coquille', libelle: 'Coquille', choix: [0, 1] }] }] };
  assert.deepEqual(champsAcorriger(avecOptions, RELEVE), []);
});
test('messageChamp : phrases écrites sous le champ', () => {
  assert.equal(messageChamp({ libelle: 'Hauteur de buse', code: 'vide' }), 'Hauteur de buse : à renseigner.');
  assert.equal(messageChamp({ libelle: 'Hauteur de buse', code: 'hors_plage', min: 0.3, max: 2, valeur: 105, unite: 'm' }), 'Hauteur de buse : entre 0,3 et 2 m. Vous avez saisi 105 m.');
  assert.equal(messageChamp({ libelle: 'Diamètre', code: 'choix' }), 'Diamètre : choisissez une valeur.');
  assert.equal(messageChamp({ libelle: 'Pente', code: 'hors_plage', min: 0, max: null, valeur: -2, unite: '°' }), 'Pente : au moins 0 °. Vous avez saisi -2 °.');
  assert.equal(titreChampsAcorriger(1), '1 champ à corriger');
  assert.equal(titreChampsAcorriger(2), '2 champs à corriger');
});
