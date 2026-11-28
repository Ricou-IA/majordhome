// scripts/aspirateur/ecran.test.mjs — règles d'affichage de l'aspirateur (src/lib/aspirateur/ecran.js).
// Run : node --test scripts/aspirateur/ecran.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reglagesAspirateur, configAvecAspirateur, etatDuBloc, grouperPropositions, libelleProposition } from '../../src/lib/aspirateur/ecran.js';

const reglages = { naturePrix: 'net_ht', marques: [] };
const site = 'https://pro.invicta-group.fr/';

test('réglages lus et fusionnés sans perdre les autres clés', () => {
  assert.deepEqual(reglagesAspirateur(null), { naturePrix: null, marques: [] });
  assert.deepEqual(reglagesAspirateur({ aspirateur: { nature_prix: 'net_ht', marques: ['Deville', 3] } }), { naturePrix: 'net_ht', marques: ['Deville'] });
  assert.deepEqual(reglagesAspirateur({ aspirateur: { nature_prix: 'autre' } }), { naturePrix: null, marques: [] });
  const fusion = configAvecAspirateur({ pieces: { remise_pct: 30 }, aspirateur: { remise_pct: 10 } }, { naturePrix: 'public_ttc', marques: [' Deville ', ''] });
  assert.deepEqual(fusion, { pieces: { remise_pct: 30 }, aspirateur: { remise_pct: 10, nature_prix: 'public_ttc', marques: ['Deville'] } });
});

test('bloc : site absent ou nature des prix absente ⇒ bouton qui explique', () => {
  assert.equal(etatDuBloc({ etat: { connue: false }, travail: null, reglages, siteUrl: '' }).bouton.raison, 'Renseignez d’abord l’adresse du site sur la fiche');
  assert.equal(etatDuBloc({ etat: { connue: false }, travail: null, reglages: { naturePrix: null, marques: [] }, siteUrl: site }).bouton.raison, 'Indiquez d’abord la nature des prix lus sur le site');
});

test('bloc : état inconnu (lecture en cours ou en échec) ⇒ aucun lancement', () => {
  const b = etatDuBloc({ etat: undefined, travail: null, reglages, siteUrl: site });
  assert.equal(b.bouton.actif, false);
});

test('bloc : recette connue, site jamais exploré, en cours, à confirmer, échec', () => {
  assert.equal(etatDuBloc({ etat: { connue: true }, travail: null, reglages, siteUrl: site }).libelle, 'Recette connue');
  assert.match(etatDuBloc({ etat: { connue: false }, travail: null, reglages, siteUrl: site }).libelle, /jamais exploré/);
  const enCours = etatDuBloc({ etat: { connue: false }, travail: { genre: 'apprentissage', statut: 'en_cours' }, reglages, siteUrl: site });
  assert.equal(enCours.libelle, 'Apprentissage du site en cours');
  assert.equal(enCours.bouton.actif, false);
  const aConfirmer = etatDuBloc({ etat: { connue: false }, travail: { genre: 'apprentissage', statut: 'attente_confirmation' }, reglages, siteUrl: site });
  assert.equal(aConfirmer.libelle, 'Recette à confirmer');
  assert.equal(aConfirmer.confirmer, true);
  const echec = etatDuBloc({ etat: { connue: true }, travail: { genre: 'aspiration', statut: 'echec', code_erreur: 'site_protege' }, reglages, siteUrl: site });
  assert.equal(echec.erreur, 'Le site bloque les robots : aspiration impossible');
  assert.equal(echec.bouton.actif, true);
});

test('propositions groupées par référence dans l’ordre d’arrivée, nom pris du nouvel article', () => {
  const g = grouperPropositions([
    { id: 1, reference: 'B', genre: 'caracteristique' },
    { id: 2, reference: 'A', genre: 'nouvel_article', valeur: { nom: 'Toron' } },
    { id: 3, reference: 'B', genre: 'document' },
    { id: 4, reference: 'A', genre: 'prix_achat' },
  ]);
  assert.deepEqual(g.map((x) => [x.reference, x.nom, x.lignes.map((l) => l.id)]), [['B', 'B', [1, 3]], ['A', 'Toron', [2, 4]]]);
});

test('libellés des propositions', () => {
  const champs = [{ key: 'etas_pct', label: 'Etas', unit: '%', type: 'number' }, { key: 'flamme_verte', label: 'Flamme Verte', type: 'boolean' }];
  assert.equal(libelleProposition({ genre: 'caracteristique', cle: 'etas_pct', valeur: 67, ancienne_valeur: null }, champs), 'Etas : 67 % (vide jusqu’ici)');
  assert.equal(libelleProposition({ genre: 'caracteristique', cle: 'etas_pct', valeur: 67.5, ancienne_valeur: 66 }, champs), 'Etas : 67,5 % (remplace 66 %)');
  assert.equal(libelleProposition({ genre: 'caracteristique', cle: 'flamme_verte', valeur: true, ancienne_valeur: null }, champs), 'Flamme Verte : oui (vide jusqu’ici)');
  assert.equal(libelleProposition({ genre: 'caracteristique', cle: 'inconnue', valeur: 'x', ancienne_valeur: null }, champs), 'inconnue : x (vide jusqu’ici)');
  assert.equal(libelleProposition({ genre: 'nouvel_article', valeur: { nom: 'Toron', marque: 'Deville' } }, champs), 'Nouvel article : Toron · Deville');
  assert.equal(libelleProposition({ genre: 'document', cle: 'fiche_technique' }, champs), 'Document : Fiche technique');
  assert.equal(libelleProposition({ genre: 'photo' }, champs), 'Photo de l’appareil');
  assert.equal(libelleProposition({ genre: 'prix_achat', valeur: { achat_ht: 700, public_ht: 1000 }, ancienne_valeur: 790 }, champs), 'Prix d’achat : 700,00 € HT (remplace 790,00 €)');
  assert.equal(libelleProposition({ genre: 'prix_achat', valeur: { achat_ht: null, public_ht: 1000 }, ancienne_valeur: null }, champs), 'Prix public : 1 000,00 € HT');
});
