// node --test scripts/assistant-pieces.test.mjs — règles pures de l'assistant « Trouver une pièce ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODES, STATUTS, DEMANDE_MAX, messageErreurAssistant, controlerDemande, appareilConnu,
  construireConsigne, lireReponse, lienSur, verdictRun, DUREE_MAX_RECHERCHE_MIN,
  lireReponseLancement, lireReponseSuivi,
} from '../src/lib/assistantPieces.js';
import * as regles from '../src/lib/assistantPieces.js';

// Lue par l'espace de noms : une fonction absente fait échouer son seul test, pas le chargement du fichier.
const cheminPlaqueValide = (...a) => regles.cheminPlaqueValide(...a);

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

test('controlerDemande : nom de famille découpé en mots, prénom ignoré, société en champ entier', () => {
  const base = { nom: null, prenom: null, societe: null, telephone: null, telephone2: null, email: null };
  // Nom de famille : chaque mot de 3 lettres et plus (hors civilités et liaisons) suffit à refuser.
  assert.equal(controlerDemande('gimenez', { ...base, nom: 'Giménez' }), 'donnee_client');
  assert.equal(controlerDemande('poêle de Durand', { ...base, nom: 'Martin Durand' }), 'donnee_client');
  assert.equal(controlerDemande('dupont', { ...base, nom: 'M. et Mme Dupont' }), 'donnee_client');
  assert.equal(controlerDemande('et', { ...base, nom: 'M. et Mme Dupont' }), null);
  assert.equal(controlerDemande('mme', { ...base, nom: 'M. et Mme Dupont' }), null);
  assert.equal(controlerDemande('saint-martin', { ...base, nom: 'Saint Martin' }), 'donnee_client');
  assert.equal(controlerDemande('petit ventilateur', { ...base, nom: 'Petit' }), 'donnee_client');
  // Un nom de 2 lettres ne fait jamais refuser sur ce mot.
  assert.equal(controlerDemande('joint de la porte le plus fin', { ...base, nom: 'Le' }), null);
  assert.equal(controlerDemande('ly sonde ly', { ...base, nom: 'Ly' }), null);
  // Le prénom seul n'identifie personne, et c'est souvent un mot du métier.
  assert.equal(controlerDemande('pierre réfractaire', { ...base, nom: 'Durand', prenom: 'Pierre' }), null);
  // Société : comparée en champ entier.
  assert.equal(controlerDemande('chauffage', { ...base, societe: 'SARL Chauffage Dupuis' }), null);
  assert.equal(controlerDemande('sarl chauffage dupuis', { ...base, societe: 'SARL Chauffage Dupuis' }), 'donnee_client');
});

test('controlerDemande : téléphones, plusieurs numéros par champ', () => {
  const base = { nom: null, prenom: null, societe: null, telephone: null, telephone2: null, email: null };
  assert.equal(controlerDemande('0612345678', { ...base, telephone: '+33 6 12 34 56 78' }), 'donnee_client');
  const deux = { ...base, telephone2: '05 63 11 22 33 / 06 12 34 56 78' };
  assert.equal(controlerDemande('05.63.11.22.33', deux), 'donnee_client');
  assert.equal(controlerDemande('06 12 34 56 78', deux), 'donnee_client');
  assert.equal(controlerDemande('joint 300 mm', deux), null);
});

test('cheminPlaqueValide : seulement <org>/…/equipements/<équipement>-plaque.jpg', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const eq = '22222222-2222-4222-8222-222222222222';
  const autre = '33333333-3333-4333-8333-333333333333';
  assert.equal(cheminPlaqueValide(`${org}/${autre}/equipements/${eq}-plaque.jpg`, org, eq), true);
  assert.equal(cheminPlaqueValide(`${autre}/${autre}/equipements/${eq}-plaque.jpg`, org, eq), false); // autre org
  assert.equal(cheminPlaqueValide(`${org}/${autre}/equipements/${autre}-plaque.jpg`, org, eq), false); // autre équipement
  assert.equal(cheminPlaqueValide(`${org}/${autre}/2026/${autre}-plaque.jpg`, org, eq), false); // photo de certificat
  assert.equal(cheminPlaqueValide(`${org}/equipements/${eq}-plaque.jpg.exe`, org, eq), false);
  assert.equal(cheminPlaqueValide(`${org}/../${autre}/equipements/${eq}-plaque.jpg`, org, eq), false);
  assert.equal(cheminPlaqueValide(`${org}${eq}-plaque.jpg`, org, eq), false);
  for (const c of [null, undefined, '', 42]) assert.equal(cheminPlaqueValide(c, org, eq), false);
  assert.equal(cheminPlaqueValide(`/equipements/${eq}-plaque.jpg`, '', eq), false);
  assert.equal(cheminPlaqueValide(`${org}/x/equipements/-plaque.jpg`, org, ''), false);
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

test("lireReponseLancement : réponse HTTP du POST /v1/runs → run_id ou motif d'indisponibilité", () => {
  assert.deepEqual(lireReponseLancement(200, '{"run_id":"run_42","status":"started"}'), { runId: 'run_42', motif: null });
  assert.deepEqual(lireReponseLancement(202, '{"run_id":"  run_7 "}'), { runId: 'run_7', motif: null });
  assert.deepEqual(lireReponseLancement(null, null), { runId: null, motif: 'injoignable' }); // réseau ou délai
  assert.deepEqual(lireReponseLancement(200, null), { runId: null, motif: 'illisible' }); // corps coupé en lecture
  assert.deepEqual(lireReponseLancement(200, ''), { runId: null, motif: 'illisible' });
  assert.deepEqual(lireReponseLancement(200, '<html>oups'), { runId: null, motif: 'illisible' });
  assert.deepEqual(lireReponseLancement(200, '{"run_id":"run_1"'), { runId: null, motif: 'illisible' }); // tronqué
  assert.deepEqual(lireReponseLancement(200, '["run_1"]'), { runId: null, motif: 'illisible' });
  assert.deepEqual(lireReponseLancement(200, '{"status":"started"}'), { runId: null, motif: 'sans_run_id' });
  assert.deepEqual(lireReponseLancement(200, '{"run_id":"  "}'), { runId: null, motif: 'sans_run_id' });
  assert.deepEqual(lireReponseLancement(200, '{"run_id":42}'), { runId: null, motif: 'sans_run_id' });
  assert.deepEqual(lireReponseLancement(401, '{"error":"unauthorized"}'), { runId: null, motif: 'refuse' });
  assert.deepEqual(lireReponseLancement(429, ''), { runId: null, motif: 'occupe' });
  assert.deepEqual(lireReponseLancement(500, '{"run_id":"run_1"}'), { runId: null, motif: 'refuse' });
  assert.deepEqual(lireReponseLancement(503, null), { runId: null, motif: 'refuse' });
});

test('lireReponseSuivi : réponse HTTP du GET /v1/runs/{id} → run lu, inconnu ou panne passagère', () => {
  const run = '{"object":"run","run_id":"r","status":"completed","output":"texte","usage":{"total_tokens":12}}';
  assert.deepEqual(lireReponseSuivi(200, run), { issue: 'lu', etat: 'completed', texte: 'texte', usage: { total_tokens: 12 } });
  assert.deepEqual(lireReponseSuivi(200, '{"status":"running","output":null,"usage":null}'),
    { issue: 'lu', etat: 'running', texte: null, usage: null });
  assert.deepEqual(lireReponseSuivi(200, '{"status":"running","output":7,"usage":[1]}'),
    { issue: 'lu', etat: 'running', texte: null, usage: null });
  // 404 = run inconnu seulement si le corps est un objet JSON (le relais répond toujours en JSON) ; une page
  // d'erreur du reverse proxy, un corps vide ou coupé est une panne passagère, qui ne clôt pas la recherche.
  assert.deepEqual(lireReponseSuivi(404, '{}'), { issue: 'inconnu' });
  assert.deepEqual(lireReponseSuivi(404, '{"error":"x"}'), { issue: 'inconnu' });
  for (const [statut, corps] of [[null, null], [200, null], [200, ''], [200, 'pas du json'], [200, '{"status":"run'],
    [200, 'null'], [200, '"completed"'], [401, '{}'], [429, ''], [500, run], [502, null],
    [404, ''], [404, null], [404, '<html><body>404 page not found</body></html>'], [404, '404 page not found'],
    [404, '[]'], [404, 'null'], [404, '{"error"']]) {
    assert.deepEqual(lireReponseSuivi(statut, corps), { issue: 'passager' }, `${statut} ${corps}`);
  }
});
