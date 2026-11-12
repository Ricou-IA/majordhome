// node --test scripts/assistant-pieces.test.mjs — règles pures de l'assistant « Trouver une pièce ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODES, STATUTS, DEMANDE_MAX, messageErreurAssistant, controlerDemande, appareilConnu,
  construireConsigne, lireReponse, lienSur, verdictRun, DUREE_MAX_RECHERCHE_MIN,
} from '../src/lib/assistantPieces.js';

const client = { nom: 'Gimenez', prenom: 'Joël', societe: null, telephone: '0612345678', telephone2: null, email: 'j.g@exemple.fr' };

test('controlerDemande', () => {
  assert.equal(controlerDemande('  ', client), 'demande_vide');
  assert.equal(controlerDemande('x'.repeat(501), client), 'demande_trop_longue');
  assert.equal(controlerDemande('bougie pour M. GIMENEZ', client), 'donnee_client');
  assert.equal(controlerDemande('rappeler au 06 12.34 56-78', client), 'donnee_client');
  assert.equal(controlerDemande('+33 6 12 34 56 78', client), 'donnee_client');
  assert.equal(controlerDemande('écrire à J.G@exemple.fr', client), 'donnee_client');
  assert.equal(controlerDemande("bougie d'allumage", client), null);
  assert.equal(controlerDemande('joint de porte', { ...client, nom: 'Porte' }), 'donnee_client'); // mot entier = nom
  assert.equal(controlerDemande('transporteur', { ...client, nom: 'Port' }), null); // pas un mot entier
});

test('controlerDemande : client absent ou incomplet, bornes de longueur', () => {
  assert.equal(controlerDemande("bougie d'allumage", null), null);
  assert.equal(controlerDemande('  ', null), 'demande_vide');
  assert.equal(controlerDemande('x'.repeat(501), undefined), 'demande_trop_longue');
  assert.equal(controlerDemande("bougie d'allumage", {}), null);
  assert.equal(controlerDemande("bougie d'allumage", { nom: null, prenom: undefined, telephone: null }), null);
  assert.equal(DEMANDE_MAX, 500);
  assert.equal(controlerDemande('x'.repeat(500), client), null);
  assert.equal(controlerDemande('x'.repeat(501), client), 'demande_trop_longue');
});

test('appareilConnu', () => {
  assert.equal(appareilConnu({ type: 'Poêle à granulés', marque: 'À RENSEIGNER', modele: '', numero_serie: '', fiche: null, a_plaque: false }), false);
  assert.equal(appareilConnu({ type: 'Poêle', marque: 'FREEPOINT', modele: '', numero_serie: '', fiche: null, a_plaque: false }), true);
  assert.equal(appareilConnu({ type: 'Poêle', marque: '', modele: '', numero_serie: '', fiche: null, a_plaque: true }), true);
});

test('construireConsigne ne porte que appareil et demande', () => {
  const c = construireConsigne({ appareil: { type: 'Poêle à granulés', marque: 'FREEPOINT', modele: '', numero_serie: '2007106010006', fiche: null, a_plaque: false }, demande: "bougie d'allumage" });
  for (const m of ['FREEPOINT', '2007106010006', "bougie d'allumage", 'non renseigné', '```json']) assert.ok(c.includes(m));
  assert.ok(!/photo de la plaque/i.test(c));
});

test('construireConsigne : la plaque n’apparaît que si une URL est fournie', () => {
  const appareil = { type: 'Poêle', marque: 'FREEPOINT', modele: '', numero_serie: '', fiche: null, a_plaque: true };
  const avec = construireConsigne({ appareil, demande: 'joint', plaqueUrl: 'https://exemple.fr/plaque.jpg' });
  assert.ok(avec.includes('https://exemple.fr/plaque.jpg'));
  assert.ok(/plaque/i.test(avec));
  const sans = construireConsigne({ appareil, demande: 'joint' });
  assert.ok(!/plaque/i.test(sans));
});

test('lireReponse', () => {
  const ok = 'Texte.\n```json\n{"appareil":"a","pistes":[],"pieces":[],"offres":[{"vendeur":"V","reference":"R","prix_ttc":30,"disponibilite":"En stock","url":"https://v.fr/p","verifie":true}],"verifications":["x"]}\n```';
  assert.equal(lireReponse(ok).structure.offres[0].prix_ttc, 30);
  assert.equal(lireReponse('Réponse libre sans bloc.').structure, null);
  assert.equal(lireReponse('```json\n{"offres":"pas une liste"}\n```').structure, null);
  assert.equal(lireReponse('```json\n{cassé\n```').structure, null);
  assert.equal(lireReponse(ok).texte, ok);
});

test('lireReponse : ne jette jamais, prend le dernier bloc', () => {
  assert.deepEqual(lireReponse(null), { structure: null, texte: '' });
  assert.deepEqual(lireReponse(undefined), { structure: null, texte: '' });
  assert.deepEqual(lireReponse(42), { structure: null, texte: '' });
  const bloc = (appareil) => `\`\`\`json\n{"appareil":"${appareil}","pistes":[],"pieces":[],"offres":[],"verifications":[]}\n\`\`\``;
  assert.equal(lireReponse(`${bloc('premier')}\nPuis\n${bloc('dernier')}`).structure.appareil, 'dernier');
});

test('lienSur', () => {
  assert.deepEqual(lienSur('https://www.lacentraledupoele.com/produit/1'), { href: 'https://www.lacentraledupoele.com/produit/1', domaine: 'lacentraledupoele.com' });
  for (const u of ['http://v.fr/p', 'javascript:alert(1)', 'v.fr/p', '', null]) assert.equal(lienSur(u), null);
});

test('chaque code a un message distinct', () => {
  const vus = new Set(CODES.map(messageErreurAssistant));
  assert.equal(vus.size, CODES.length);
  for (const code of CODES) assert.ok(messageErreurAssistant(code).trim().length > 0);
  assert.deepEqual([...STATUTS], ['en_cours', 'terminee', 'echec']);
});

test('messageErreurAssistant : Error, code inconnu, service injoignable', () => {
  assert.equal(messageErreurAssistant(new Error('donnee_client')), messageErreurAssistant('donnee_client'));
  assert.equal(messageErreurAssistant('nimporte_quoi'), messageErreurAssistant('service_injoignable'));
  assert.ok(!CODES.map(messageErreurAssistant).includes(messageErreurAssistant('service_injoignable')));
  assert.ok(!/\d/.test(messageErreurAssistant('quota_atteint')));
});

test('verdictRun : état du run Hermes + âge de la ligne → issue de la recherche', () => {
  assert.equal(DUREE_MAX_RECHERCHE_MIN, 15);
  for (const etat of ['queued', 'started', 'running', 'stopping']) {
    assert.equal(verdictRun(etat, 1), 'en_cours');
    assert.equal(verdictRun(etat, 15), 'echec_delai'); // la limite d'âge clôt un run resté en route
  }
  assert.equal(verdictRun('completed', 2), 'terminee');
  assert.equal(verdictRun('completed', 60), 'terminee'); // une réponse arrivée l'emporte sur l'âge
  for (const etat of ['failed', 'cancelled', 'interrupted']) assert.equal(verdictRun(etat, 3), 'echec_recherche');
  // état inconnu (ou absent : Hermes injoignable) : encore en cours, jusqu'à la limite d'âge
  assert.equal(verdictRun('bizarre', 14.9), 'en_cours');
  assert.equal(verdictRun(undefined, 14.9), 'en_cours');
  assert.equal(verdictRun(null, 16), 'echec_delai');
  assert.equal(verdictRun('running', Number.NaN), 'echec_delai'); // âge illisible : on ferme, on ne boucle pas
});
