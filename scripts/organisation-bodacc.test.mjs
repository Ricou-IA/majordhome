// RCS et capital social lus dans les annonces légales (BODACC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireImmatriculation, formaterCapital, appliquerImmatriculation } from '../src/lib/organisation/bodacc.js';

// Annonces écrites à la main (société fictive), à la forme de l'API « annonces-commerciales ».
const personne = (extra = {}, siren = '100 288 224', greffe = 'Albi', code = 'RCS') => ({
  typePersonne: 'pm',
  numeroImmatriculation: { numeroIdentification: siren, codeRCS: code, nomGreffeImmat: greffe },
  denomination: 'ATELIER DU CHAUFFAGE',
  ...extra,
});
const annonce = (date, p, enTexte = true) => ({
  dateparution: date,
  listepersonnes: enTexte ? JSON.stringify({ personne: p }) : { personne: p },
});

test('greffe et capital : le greffe est celui de l’immatriculation, le capital celui de la dernière annonce qui le porte', () => {
  const r = lireImmatriculation({ results: [
    annonce('2026-07-09', personne()),                                                    // dépôt des comptes : pas de capital
    annonce('2025-03-02', personne({ capital: { montantCapital: '6000', devise: 'EUR' } })),
    annonce('2019-01-15', personne({ capital: { montantCapital: '1000', devise: 'EUR' } })),
  ] }, '100288224');
  assert.equal(r.greffe, 'Albi');
  assert.equal(r.rcs, '100 288 224 R.C.S. Albi');
  assert.deepEqual(r.capital, { montant: 6000, date: '2025-03-02' });
  assert.equal(r.annonces, 2, 'la lecture s’arrête dès que les deux sont trouvés');
});

test('les annonces sont relues de la plus récente à la plus ancienne, quel que soit l’ordre reçu', () => {
  const r = lireImmatriculation({ results: [
    annonce('2019-01-15', personne({ capital: { montantCapital: '1000', devise: 'EUR' } }, '100 288 224', 'Toulouse')),
    annonce('2025-03-02', personne({ capital: { montantCapital: '6000', devise: 'EUR' } })),
  ] }, '100 288 224');
  assert.equal(r.greffe, 'Albi', 'siège transféré : le greffe le plus récent');
  assert.equal(r.capital.montant, 6000);
});

test('une annonce qui cite une autre société ne compte pas', () => {
  const r = lireImmatriculation({ results: [
    annonce('2026-01-01', [personne({ capital: { montantCapital: '999', devise: 'EUR' } }, '999 999 999', 'Paris'), personne()]),
  ] }, '100288224');
  assert.equal(r.greffe, 'Albi');
  assert.equal(r.capital, null);
});

test('forme de la réponse : personnes en objet ou en texte, texte illisible ignoré', () => {
  const objet = lireImmatriculation({ results: [annonce('2026-01-01', personne(), false)] }, '100288224');
  assert.equal(objet.rcs, '100 288 224 R.C.S. Albi');
  const casse = lireImmatriculation({ results: [{ dateparution: '2026-01-01', listepersonnes: '{pas du json' }] }, '100288224');
  assert.deepEqual(casse, { greffe: null, rcs: null, capital: null, annonces: 0 });
});

test('rien n’est inventé : pas d’annonce, pas de RCS ; immatriculation hors registre du commerce, pas de RCS', () => {
  assert.deepEqual(lireImmatriculation({ results: [] }, '100288224'), { greffe: null, rcs: null, capital: null, annonces: 0 });
  assert.deepEqual(lireImmatriculation(null, '100288224'), { greffe: null, rcs: null, capital: null, annonces: 0 });
  assert.deepEqual(lireImmatriculation({ results: [annonce('2026-01-01', personne())] }, '12345'), { greffe: null, rcs: null, capital: null, annonces: 0 });
  const metiers = lireImmatriculation({ results: [annonce('2026-01-01', personne({}, '100 288 224', 'Albi', 'RM'))] }, '100288224');
  assert.equal(metiers.rcs, null, 'répertoire des métiers : ce n’est pas un RCS');
  const sansGreffe = lireImmatriculation({ results: [annonce('2026-01-01', personne({}, '100 288 224', ''))] }, '100288224');
  assert.equal(sansGreffe.rcs, null);
});

test('capital : euros seulement, montant positif, décimales lues', () => {
  const lire = (capital) => lireImmatriculation({ results: [annonce('2026-01-01', personne({ capital }))] }, '100288224').capital;
  assert.equal(lire({ montantCapital: '7500.50', devise: 'EUR' }).montant, 7500.5);
  assert.equal(lire({ montantCapital: '7500,50', devise: 'eur' }).montant, 7500.5);
  assert.equal(lire({ montantCapital: '1000', devise: 'USD' }), null);
  assert.equal(lire({ montantCapital: '0', devise: 'EUR' }), null);
  assert.equal(lire({ montantCapital: 'variable', devise: 'EUR' }), null);
});

test('formaterCapital : milliers séparés, centimes seulement s’il y en a', () => {
  assert.equal(formaterCapital(6000), '6 000');
  assert.equal(formaterCapital(10800000), '10 800 000');
  assert.equal(formaterCapital(500), '500');
  assert.equal(formaterCapital(7500.5), '7 500,50');
  assert.equal(formaterCapital(NaN), '');
});

test('report sur le formulaire : même entreprise, on ne remplit que ce qui est vide', () => {
  const lecture = { greffe: 'Albi', rcs: '100 288 224 R.C.S. Albi', capital: { montant: 6000, date: '2025-03-02' }, annonces: 2 };
  const vide = appliquerImmatriculation({ rcs: '', capital: '', brand_name: 'X' }, lecture);
  assert.equal(vide.form.rcs, '100 288 224 R.C.S. Albi');
  assert.equal(vide.form.capital, '6 000');
  assert.equal(vide.form.brand_name, 'X', 'les autres champs ne bougent pas');
  assert.match(vide.detail, /RCS \(100 288 224 R\.C\.S\. Albi\)/);
  assert.match(vide.detail, /capital social \(6 000 €, annonce du 02\/03\/2025\)/);

  const saisi = appliquerImmatriculation({ rcs: 'saisi à la main', capital: '8 000' }, lecture);
  assert.equal(saisi.form.rcs, 'saisi à la main');
  assert.equal(saisi.form.capital, '8 000');
  assert.equal(saisi.detail, '', 'rien à dire quand rien n’est touché');
});

test('report sur le formulaire : autre entreprise, RCS et capital remplacés — vidés si le BODACC ne les donne pas', () => {
  const rien = { greffe: null, rcs: null, capital: null, annonces: 0 };
  const r = appliquerImmatriculation({ rcs: '111 111 111 R.C.S. Paris', capital: '50 000' }, rien, { remplacer: true });
  assert.equal(r.form.rcs, '', 'jamais le RCS de l’entreprise précédente');
  assert.equal(r.form.capital, '');
  assert.equal(r.detail, 'Annonces légales : RCS et capital social non trouvés, à saisir.');

  const partiel = appliquerImmatriculation({ rcs: 'ancien', capital: 'ancien' }, { greffe: 'Albi', rcs: '100 288 224 R.C.S. Albi', capital: null, annonces: 1 }, { remplacer: true });
  assert.equal(partiel.form.rcs, '100 288 224 R.C.S. Albi');
  assert.equal(partiel.form.capital, '');
  assert.equal(partiel.detail, 'Annonces légales : RCS (100 288 224 R.C.S. Albi). capital social non trouvé, à saisir.');
});
